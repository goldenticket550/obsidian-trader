begin;
create table if not exists public.attention_runtime_controls (
  engine_instance_id text primary key,
  version bigint not null default 1,
  attention_live_alerting_enabled boolean not null default false,
  legacy_alerting_enabled boolean not null default true,
  active_alert_engine text not null default 'legacy' check (active_alert_engine in ('legacy','attention')),
  reason text not null,
  config_identity text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  check (not attention_live_alerting_enabled or (active_alert_engine = 'attention' and not legacy_alerting_enabled))
);

create table if not exists public.attention_engine_instances (
  engine_instance_id text primary key,
  user_id uuid not null references auth.users(id),
  owner_run_id text,
  fencing_token bigint not null default 0,
  lease_expires_at timestamptz,
  universe_hash text not null,
  calibration_id text not null,
  config_hash text not null,
  feed_mode text not null check (feed_mode = 'iex_partial'),
  ingestion_mode text,
  health text not null default 'stopped',
  ready boolean not null default false,
  shadow boolean not null default true,
  heartbeat_at timestamptz,
  last_completed_minute timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.attention_engine_checkpoints (
  engine_instance_id text not null references public.attention_engine_instances(engine_instance_id),
  sequence bigint not null,
  watermark_at timestamptz not null,
  schema_version integer not null,
  fencing_token bigint not null,
  universe_hash text not null,
  calibration_id text not null,
  config_hash text not null,
  ingestion_mode text not null,
  checksum text not null,
  state jsonb not null,
  created_at timestamptz not null default now(),
  primary key (engine_instance_id, sequence)
);

create table if not exists public.attention_live_snapshots (
  engine_instance_id text primary key references public.attention_engine_instances(engine_instance_id),
  sequence bigint not null,
  as_of timestamptz not null,
  fencing_token bigint not null,
  snapshot jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.attention_events (
  event_id text primary key,
  engine_instance_id text not null references public.attention_engine_instances(engine_instance_id),
  source text not null default 'attention',
  event_type text not null,
  symbol text not null,
  qualified_at timestamptz not null,
  emitted_at timestamptz not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists attention_events_engine_qualified_idx
  on public.attention_events (engine_instance_id, qualified_at desc);


create table if not exists public.attention_delivery_outbox (
  id text primary key,
  engine_instance_id text not null references public.attention_engine_instances(engine_instance_id),
  idempotency_key text not null unique,
  tier text not null check (tier in ('primary','secondary')),
  kind text not null check (kind in ('alert','digest')),
  payload jsonb not null,
  status text not null check (status in ('pending','leased','delivered','retrying','failed')),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null,
  expires_at timestamptz not null,
  lease_owner text,
  lease_expires_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  provider_acknowledgement text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attention_ingestion_audit (
  id bigint generated always as identity primary key,
  engine_instance_id text not null references public.attention_engine_instances(engine_instance_id),
  run_id text not null,
  at timestamptz not null,
  kind text not null,
  severity text not null,
  detail jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.attention_runtime_controls enable row level security;
alter table public.attention_engine_instances enable row level security;
alter table public.attention_engine_checkpoints enable row level security;
alter table public.attention_live_snapshots enable row level security;
alter table public.attention_events enable row level security;
alter table public.attention_delivery_outbox enable row level security;
alter table public.attention_ingestion_audit enable row level security;

create policy "own attention snapshot" on public.attention_live_snapshots for select to authenticated
using (exists (select 1 from public.attention_engine_instances i where i.engine_instance_id = attention_live_snapshots.engine_instance_id and i.user_id = auth.uid()));
create policy "own attention events" on public.attention_events for select to authenticated
using (exists (select 1 from public.attention_engine_instances i where i.engine_instance_id = attention_events.engine_instance_id and i.user_id = auth.uid()));
create policy "own attention runtime health" on public.attention_engine_instances for select to authenticated using (user_id = auth.uid());
create policy "own attention controls" on public.attention_runtime_controls for select to authenticated
using (engine_instance_id in (select engine_instance_id from public.attention_engine_instances where user_id = auth.uid()));

-- Service-role worker calls this function. Fencing makes a stale process unable to commit.
create or replace function public.acquire_attention_engine_lease(p_engine_instance_id text, p_run_id text, p_ttl_seconds integer)
returns table(fencing_token bigint, lease_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  update attention_engine_instances
     set owner_run_id = p_run_id,
         fencing_token = attention_engine_instances.fencing_token + 1,
         lease_expires_at = now() + make_interval(secs => p_ttl_seconds),
         heartbeat_at = now(), updated_at = now()
   where engine_instance_id = p_engine_instance_id
     and (attention_engine_instances.lease_expires_at is null or attention_engine_instances.lease_expires_at <= now() or attention_engine_instances.owner_run_id = p_run_id)
  returning attention_engine_instances.fencing_token, attention_engine_instances.lease_expires_at
       into fencing_token, lease_expires_at;
  if not found then raise exception 'attention runtime lease already held'; end if;
  return next;
end $$;

revoke all on function public.acquire_attention_engine_lease(text,text,integer) from public, anon, authenticated;

create or replace function public.commit_attention_runtime_minute(
  p_engine_instance_id text, p_run_id text, p_fencing_token bigint,
  p_snapshot jsonb, p_events jsonb, p_envelopes jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare e jsonb; o jsonb;
begin
  if not exists (select 1 from attention_engine_instances where engine_instance_id=p_engine_instance_id and owner_run_id=p_run_id and fencing_token=p_fencing_token and lease_expires_at>now()) then raise exception 'attention runtime fencing violation'; end if;
  update attention_engine_instances
     set health = p_snapshot->>'health',
         ready = coalesce((p_snapshot->>'ready')::boolean, false),
         ingestion_mode = p_snapshot->>'ingestionMode',
         heartbeat_at = now(),
         last_completed_minute = to_timestamp((p_snapshot->>'asOf')::double precision/1000),
         updated_at = now()
   where engine_instance_id = p_engine_instance_id;
  insert into attention_live_snapshots(engine_instance_id,sequence,as_of,fencing_token,snapshot) values(p_engine_instance_id,(p_snapshot->>'sequence')::bigint,to_timestamp((p_snapshot->>'asOf')::double precision/1000),p_fencing_token,p_snapshot)
  on conflict(engine_instance_id) do update set sequence=excluded.sequence,as_of=excluded.as_of,fencing_token=excluded.fencing_token,snapshot=excluded.snapshot,updated_at=now();
  for e in select value from jsonb_array_elements(p_events) loop insert into attention_events(event_id,engine_instance_id,event_type,symbol,qualified_at,emitted_at,payload) values(e->>'eventId',p_engine_instance_id,e->>'type',e->>'symbol',to_timestamp((e->>'qualifiedAt')::double precision/1000),to_timestamp((e->>'emittedAt')::double precision/1000),e) on conflict do nothing; end loop;
  for o in select value from jsonb_array_elements(p_envelopes) loop insert into attention_delivery_outbox(id,engine_instance_id,idempotency_key,tier,kind,payload,status,attempt_count,next_attempt_at,expires_at) values(o->>'id',p_engine_instance_id,o->>'idempotencyKey',o->>'tier',o->>'kind',o,o->>'status',(o->>'attemptCount')::integer,to_timestamp((o->>'nextAttemptAt')::double precision/1000),to_timestamp((o->>'expiresAt')::double precision/1000)) on conflict(idempotency_key) do update set payload=excluded.payload,next_attempt_at=excluded.next_attempt_at,expires_at=excluded.expires_at,updated_at=now() where attention_delivery_outbox.status in ('pending','retrying'); end loop;
end $$;

create or replace function public.lease_attention_outbox(p_consumer_id text,p_now timestamptz,p_limit integer,p_lease_seconds integer) returns setof jsonb language plpgsql security definer set search_path=public as $$
declare r attention_delivery_outbox;
begin
 for r in select * from attention_delivery_outbox where expires_at>p_now and next_attempt_at<=p_now and (status in ('pending','retrying') or (status='leased' and lease_expires_at<=p_now)) order by next_attempt_at for update skip locked limit p_limit loop
  update attention_delivery_outbox set status='leased',lease_owner=p_consumer_id,lease_expires_at=p_now+make_interval(secs=>p_lease_seconds),updated_at=now() where id=r.id;
  return next (r.payload || jsonb_build_object('status','leased','leaseOwner',p_consumer_id,'leaseExpiresAt',extract(epoch from (p_now+make_interval(secs=>p_lease_seconds)))*1000));
 end loop;
end $$;

create or replace function public.fail_attention_outbox(p_id text,p_consumer_id text,p_at timestamptz,p_error text,p_next_attempt_at timestamptz) returns void language plpgsql security definer set search_path=public as $$
begin update attention_delivery_outbox set attempt_count=attempt_count+1,last_error=p_error,lease_owner=null,lease_expires_at=null,status=case when p_next_attempt_at is null or p_next_attempt_at>=expires_at then 'failed' else 'retrying' end,next_attempt_at=coalesce(p_next_attempt_at,p_at),updated_at=now() where id=p_id and status='leased' and lease_owner=p_consumer_id; if not found then raise exception 'outbox lease ownership mismatch'; end if; end $$;

revoke all on function public.commit_attention_runtime_minute(text,text,bigint,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.lease_attention_outbox(text,timestamptz,integer,integer) from public,anon,authenticated;
revoke all on function public.fail_attention_outbox(text,text,timestamptz,text,timestamptz) from public,anon,authenticated;

commit;
