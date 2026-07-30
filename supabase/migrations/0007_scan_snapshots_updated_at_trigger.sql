-- Fixes a real bug found while diagnosing an apparent alert gap on
-- 2026-07-30: `scan_snapshots.updated_at` was declared in 0004 as
-- `timestamptz not null default now()` with NO trigger, and the upsert in
-- lib/alerts/persistentAlertStore.ts never set it explicitly. A DEFAULT
-- only applies on INSERT, so the column recorded first-insert time and
-- then froze -- while its name asserts the opposite.
--
-- Observed impact: ARM 5m demonstrably had a snapshot written at 16:56
-- UTC (it fired an alert, and saveSnapshot runs unconditionally right
-- after the alert is recorded) yet its updated_at still read 13:11 UTC,
-- 226 minutes stale. Nothing about alert correctness depended on the
-- column, but it is the table's only freshness signal, so it actively
-- misled diagnosis -- it read as "scanning has stopped" when scanning was
-- in fact running every 60 seconds.
--
-- scan_snapshots is written from two independent code paths (the
-- dashboard's own /api/scan using the user's RLS session, and
-- /api/cron/scan using the admin client), which is exactly why this
-- belongs in a database trigger rather than only in application code:
-- the guarantee should not depend on every writer remembering.
--
-- Reuses public.set_updated_at(), already defined in 0001 and already
-- driving the same trigger on strategy_configs, risk_settings, and
-- daily_trading_status. It is re-declared here with `create or replace`
-- so this migration is self-contained and can be applied to a database
-- regardless of ordering, without altering the existing definition.
--
-- Idempotent: `create or replace` for the function, and the trigger is
-- dropped-if-exists before being created, so running this more than once
-- is safe.
--
-- Deliberately NOT backfilled. Existing rows hold their insert time, and
-- the true last-write time for those rows is genuinely unknown -- writing
-- a guess would replace an obviously-stale value with a plausible-looking
-- fabricated one, which is worse. Existing rows correct themselves on
-- their next write.

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists scan_snapshots_set_updated_at on public.scan_snapshots;

create trigger scan_snapshots_set_updated_at
  before update on public.scan_snapshots
  for each row execute function public.set_updated_at();
