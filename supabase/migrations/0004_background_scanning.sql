-- Phase 6d: background scanning support. Persists scan state so alert
-- diffing works correctly across stateless serverless invocations (a
-- cron-triggered scan may run in a completely fresh container with no
-- memory of the previous scan — the in-memory AlertStore from Phase 5
-- cannot survive that, only a real database can).

-- === scan_snapshots ===============================================
-- Stores the most recent SetupResult per user/symbol/timeframe, so the
-- next scan (whenever and wherever it runs) has something real to diff
-- against instead of assuming "nothing happened before."
create table if not exists public.scan_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  timeframe text not null,
  result jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_id, symbol, timeframe)
);

alter table public.scan_snapshots enable row level security;

create policy "Users can view their own scan snapshots"
  on public.scan_snapshots for select
  using (auth.uid() = user_id);

-- Written by BOTH the dashboard's own /api/scan route (using the
-- requesting user's normal RLS-protected session) and the cron job
-- (using the RLS-bypassing admin client) — so unlike the original
-- comment here claimed, real insert/update policies are required, not
-- optional. See 0005_fix_scan_snapshot_rls.sql for the fix applied to
-- any database that already ran this migration before the bug was found.
create policy "Users can insert their own scan snapshots"
  on public.scan_snapshots for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own scan snapshots"
  on public.scan_snapshots for update
  using (auth.uid() = user_id);

-- === alert_events ===================================================
-- Persists fired alerts per user, replacing the in-memory event history
-- from Phase 5 so alert history survives restarts and works when alerts
-- fire from a cron invocation the user was never connected to.
create table if not exists public.alert_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_id text not null,
  alert_type text not null,
  symbol text not null,
  timeframe text not null,
  message text not null,
  fired_at timestamptz not null default now()
);

alter table public.alert_events enable row level security;

create policy "Users can view their own alert events"
  on public.alert_events for select
  using (auth.uid() = user_id);

-- Same fix as scan_snapshots above — the dashboard's own scan route
-- inserts here using the user's regular session, not just the cron job.
create policy "Users can insert their own alert events"
  on public.alert_events for insert
  with check (auth.uid() = user_id);

create index if not exists alert_events_user_fired_idx
  on public.alert_events (user_id, fired_at desc);

-- Used by the cooldown check (has this rule fired for this user/symbol/
-- timeframe recently?) without scanning the whole table.
create index if not exists alert_events_cooldown_idx
  on public.alert_events (user_id, rule_id, symbol, timeframe, fired_at desc);
