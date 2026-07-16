-- Fixes a real bug in 0004_background_scanning.sql: that migration only
-- added SELECT policies to scan_snapshots and alert_events, on the
-- (incorrect) assumption that only the cron job — using the RLS-bypassing
-- admin client — would ever write to them. In fact, the dashboard's own
-- /api/scan route also writes to both tables on every regular scan, using
-- the requesting user's normal RLS-protected session. Without insert/
-- update policies, every dashboard-triggered scan failed with
-- "new row violates row-level security policy."

create policy "Users can insert their own scan snapshots"
  on public.scan_snapshots for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own scan snapshots"
  on public.scan_snapshots for update
  using (auth.uid() = user_id);

create policy "Users can insert their own alert events"
  on public.alert_events for insert
  with check (auth.uid() = user_id);
