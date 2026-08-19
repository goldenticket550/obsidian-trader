begin;

create table if not exists public.attention_engine_memberships (
  engine_instance_id text not null references public.attention_engine_instances(engine_instance_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'viewer')),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (engine_instance_id, user_id)
);

create index if not exists attention_engine_memberships_user_idx
  on public.attention_engine_memberships (user_id, engine_instance_id);

alter table public.attention_engine_memberships enable row level security;

-- Security-definer helpers avoid recursive RLS evaluation between an engine instance
-- and its memberships. They expose authorization decisions only; neither mutates data.
create or replace function public.attention_engine_access_role(p_engine_instance_id text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when exists (
      select 1
      from public.attention_engine_instances i
      where i.engine_instance_id = p_engine_instance_id
        and i.user_id = auth.uid()
    ) then 'owner'
    else (
      select m.role
      from public.attention_engine_memberships m
      where m.engine_instance_id = p_engine_instance_id
        and m.user_id = auth.uid()
      limit 1
    )
  end
$$;

-- A user whose only attention role is viewer is read-only across the application.
-- Owner status takes precedence so the trader is not made read-only if an accidental
-- viewer membership is also present.
create or replace function public.is_attention_read_only_viewer()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    exists (
      select 1 from public.attention_engine_memberships m
      where m.user_id = auth.uid() and m.role = 'viewer'
    )
    and not exists (
      select 1 from public.attention_engine_instances i
      where i.user_id = auth.uid()
    )
    and not exists (
      select 1 from public.attention_engine_memberships m
      where m.user_id = auth.uid() and m.role = 'owner'
    )
$$;

revoke all on function public.attention_engine_access_role(text) from public, anon;
revoke all on function public.is_attention_read_only_viewer() from public, anon;
grant execute on function public.attention_engine_access_role(text) to authenticated;
grant execute on function public.is_attention_read_only_viewer() to authenticated;

-- Seed the canonical engine owner. Reruns preserve the original grant timestamp.
insert into public.attention_engine_memberships (
  engine_instance_id, user_id, role, granted_by
)
select
  i.engine_instance_id,
  'e0f59fc7-c0f8-48c4-ad5d-cc256cf26e68'::uuid,
  'owner',
  'e0f59fc7-c0f8-48c4-ad5d-cc256cf26e68'::uuid
from public.attention_engine_instances i
where i.engine_instance_id = 'attention-shadow-iex-static-v1'
  and i.user_id = 'e0f59fc7-c0f8-48c4-ad5d-cc256cf26e68'::uuid
on conflict (engine_instance_id, user_id) do update
set role = 'owner', granted_by = excluded.granted_by;

-- Policies are explicitly replaced so the migration is safe to execute again.
drop policy if exists "own attention runtime health" on public.attention_engine_instances;
drop policy if exists "attention members read runtime health" on public.attention_engine_instances;
create policy "attention members read runtime health"
  on public.attention_engine_instances for select to authenticated
  using (public.attention_engine_access_role(engine_instance_id) is not null);

drop policy if exists "own attention snapshot" on public.attention_live_snapshots;
drop policy if exists "attention members read snapshots" on public.attention_live_snapshots;
create policy "attention members read snapshots"
  on public.attention_live_snapshots for select to authenticated
  using (public.attention_engine_access_role(engine_instance_id) is not null);

drop policy if exists "own attention events" on public.attention_events;
drop policy if exists "attention members read events" on public.attention_events;
create policy "attention members read events"
  on public.attention_events for select to authenticated
  using (public.attention_engine_access_role(engine_instance_id) is not null);

drop policy if exists "attention members read own grant" on public.attention_engine_memberships;
create policy "attention members read own grant"
  on public.attention_engine_memberships for select to authenticated
  using (
    user_id = auth.uid()
    or public.attention_engine_access_role(engine_instance_id) = 'owner'
  );

-- Scanner reads are explicit. All scanner writes remain service-role only.
grant select on public.attention_engine_instances,
  public.attention_live_snapshots,
  public.attention_events,
  public.attention_engine_memberships to authenticated;
revoke all on public.attention_engine_instances,
  public.attention_live_snapshots,
  public.attention_events,
  public.attention_engine_memberships from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.attention_engine_instances,
     public.attention_live_snapshots,
     public.attention_events,
     public.attention_engine_memberships
  from authenticated;
grant all on public.attention_engine_memberships to service_role;

-- A viewer is globally read-only. These restrictive policies compose with each
-- table's existing user_id policy: owners keep their normal private-data writes,
-- while a viewer cannot insert, update, or delete even rows carrying their own uid.
-- The loop also covers label tables when/if migration 0008 is applied later.
do $viewer_read_only$
declare
  table_row record;
begin
  for table_row in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I',
      'attention viewers cannot select', table_row.schemaname, table_row.tablename);
    if table_row.tablename not in (
      'attention_engine_instances',
      'attention_live_snapshots',
      'attention_events',
      'attention_engine_memberships'
    ) then
      execute format('create policy %I on %I.%I as restrictive for select to authenticated using (not public.is_attention_read_only_viewer())',
        'attention viewers cannot select', table_row.schemaname, table_row.tablename);
    end if;

    execute format('drop policy if exists %I on %I.%I',
      'attention viewers cannot insert', table_row.schemaname, table_row.tablename);
    execute format('create policy %I on %I.%I as restrictive for insert to authenticated with check (not public.is_attention_read_only_viewer())',
      'attention viewers cannot insert', table_row.schemaname, table_row.tablename);

    execute format('drop policy if exists %I on %I.%I',
      'attention viewers cannot update', table_row.schemaname, table_row.tablename);
    execute format('create policy %I on %I.%I as restrictive for update to authenticated using (not public.is_attention_read_only_viewer()) with check (not public.is_attention_read_only_viewer())',
      'attention viewers cannot update', table_row.schemaname, table_row.tablename);

    execute format('drop policy if exists %I on %I.%I',
      'attention viewers cannot delete', table_row.schemaname, table_row.tablename);
    execute format('create policy %I on %I.%I as restrictive for delete to authenticated using (not public.is_attention_read_only_viewer())',
      'attention viewers cannot delete', table_row.schemaname, table_row.tablename);
  end loop;
end
$viewer_read_only$;

commit;
