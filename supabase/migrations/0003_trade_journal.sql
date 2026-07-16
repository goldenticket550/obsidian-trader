-- Phase 6c: trade journal.
-- Run this after 0001_watchlist_and_config.sql and 0002_risk_and_daily_status.sql.

create table if not exists public.trade_journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_date date not null,
  symbol text not null,
  direction text not null check (direction in ('long', 'short')),
  entry_price numeric not null,
  exit_price numeric,
  position_size numeric not null,
  stop_loss numeric,
  profit_loss numeric not null default 0,
  setup_score_at_entry integer,
  conditions_passed text[] not null default array[]::text[],
  conditions_missing text[] not null default array[]::text[],
  screenshot_url text,
  notes text,
  emotional_state text,
  followed_plan boolean not null default true,
  mistake_category text,
  lesson_learned text,
  -- Freeform tags, a simpler alternative to a separate journal_tags join
  -- table for a single-user personal tool. Documented simplification from
  -- the original schema's separate journal_tags table — revisit if this
  -- ever needs to support shared/aggregated tag analytics across users.
  tags text[] not null default array[]::text[],
  created_at timestamptz not null default now()
);

alter table public.trade_journal_entries enable row level security;

create policy "Users can view their own journal entries"
  on public.trade_journal_entries for select
  using (auth.uid() = user_id);

create policy "Users can insert their own journal entries"
  on public.trade_journal_entries for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own journal entries"
  on public.trade_journal_entries for update
  using (auth.uid() = user_id);

create policy "Users can delete their own journal entries"
  on public.trade_journal_entries for delete
  using (auth.uid() = user_id);

create index if not exists trade_journal_entries_user_date_idx
  on public.trade_journal_entries (user_id, trade_date desc);
