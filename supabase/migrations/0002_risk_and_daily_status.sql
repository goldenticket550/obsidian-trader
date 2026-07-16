-- Phase 6b: risk/accountability settings and daily trading status.
-- Run this after 0001_watchlist_and_config.sql.

-- === risk_settings ===============================================
create table if not exists public.risk_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  max_trades_per_day integer not null default 3,
  max_loss_per_day numeric not null default 400,
  daily_profit_target numeric not null default 300,
  max_risk_per_trade numeric not null default 200,
  min_setup_score integer not null default 7,
  min_minutes_between_trades integer not null default 15,
  allowed_sessions text[] not null default array['regular'],
  block_after_target boolean not null default true,
  block_after_loss_limit boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.risk_settings enable row level security;

create policy "Users can view their own risk settings"
  on public.risk_settings for select
  using (auth.uid() = user_id);

create policy "Users can insert their own risk settings"
  on public.risk_settings for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own risk settings"
  on public.risk_settings for update
  using (auth.uid() = user_id);

create trigger risk_settings_set_updated_at
  before update on public.risk_settings
  for each row execute function public.set_updated_at();

-- === daily_trading_status =========================================
-- One row per user per trading day. `trade_date` is a plain date (not a
-- timestamp) so "today" has an unambiguous, timezone-stable meaning —
-- the application layer is responsible for computing that date in US
-- Eastern time (see lib/risk/queries.ts), matching how the market
-- actually defines a trading day.
--
-- V1 limitation, documented not hidden: trades_taken and realized_pnl
-- here are updated by a lightweight "log a trade" action (a running
-- count + a P&L delta), not derived from real per-trade records. Once
-- the full trade journal exists, this becomes an aggregate view over
-- journal entries instead of independently-tracked counters.
create table if not exists public.daily_trading_status (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_date date not null,
  trades_taken integer not null default 0,
  realized_pnl numeric not null default 0,
  last_trade_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, trade_date)
);

alter table public.daily_trading_status enable row level security;

create policy "Users can view their own daily trading status"
  on public.daily_trading_status for select
  using (auth.uid() = user_id);

create policy "Users can insert their own daily trading status"
  on public.daily_trading_status for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own daily trading status"
  on public.daily_trading_status for update
  using (auth.uid() = user_id);

create trigger daily_trading_status_set_updated_at
  before update on public.daily_trading_status
  for each row execute function public.set_updated_at();
