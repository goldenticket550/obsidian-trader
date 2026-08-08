create table public.trader_run_reports (
  id uuid primary key default gen_random_uuid(),
  scanned_at timestamptz not null,
  provider text not null,
  status text not null check (status in ('healthy','degraded','failing','unknown')),
  counts jsonb not null,
  created_at timestamptz not null default now()
);

create table public.core_signal_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete restrict default auth.uid(),
  dedup_key text not null unique,
  signal jsonb not null,
  state text not null default 'pending' check (state in ('pending','delivering','delivered','dead')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.trader_run_reports enable row level security;
alter table public.core_signal_outbox enable row level security;
create policy "users enqueue own core signals" on public.core_signal_outbox for insert to authenticated with check (user_id = auth.uid());
create policy "users read own core signals" on public.core_signal_outbox for select to authenticated using (user_id = auth.uid());

create or replace function public.claim_core_signal_outbox(p_limit integer default 20)
returns setof public.core_signal_outbox language plpgsql security definer set search_path=public,pg_catalog as $$
begin
  return query update public.core_signal_outbox o set state='delivering', attempts=attempts+1
  where o.id in (select id from public.core_signal_outbox where state='pending' and next_attempt_at<=now() order by created_at for update skip locked limit greatest(1,least(p_limit,100)))
  returning o.*;
end; $$;

create or replace function public.complete_core_signal_outbox(p_id uuid)
returns void language sql security definer set search_path=public,pg_catalog as $$
  update public.core_signal_outbox set state='delivered',delivered_at=now(),last_error=null where id=p_id;
$$;

create or replace function public.retry_core_signal_outbox(p_id uuid,p_error text,p_delay_seconds integer)
returns void language sql security definer set search_path=public,pg_catalog as $$
  update public.core_signal_outbox set state=case when attempts>=10 then 'dead' else 'pending' end,last_error=left(p_error,300),next_attempt_at=now()+make_interval(secs=>greatest(1,p_delay_seconds)) where id=p_id;
$$;

revoke all on function public.claim_core_signal_outbox(integer),public.complete_core_signal_outbox(uuid),public.retry_core_signal_outbox(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.claim_core_signal_outbox(integer),public.complete_core_signal_outbox(uuid),public.retry_core_signal_outbox(uuid,text,integer) to service_role;
