-- §2.3b: interruption-safe trader-adjudicated replay labels.

alter table public.trade_journal_entries
  add column if not exists entry_time timestamptz;

create table if not exists public.replay_label_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trading_date date not null,
  quiet_session boolean,
  review_completed boolean not null default false,
  generated_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, trading_date)
);

create table if not exists public.replay_label_candidates (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  trading_date date not null,
  symbol text not null,
  rank integer not null,
  decision text not null default 'pending' check (decision in ('pending', 'accepted', 'rejected')),
  selection_reasons text[] not null default array[]::text[],
  range_atr numeric not null,
  max_window_travel_atr numeric not null,
  became_interesting text not null,
  actually_noticed text,
  direction text not null check (direction in ('bullish', 'bearish')),
  reason_tags text[] not null default array[]::text[],
  edited_fields text[] not null default array[]::text[],
  sparkline jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.replay_ground_truth_labels (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  trading_date date not null,
  symbol text not null,
  became_interesting text,
  actually_noticed text,
  actual_notice_confidence text not null check (actual_notice_confidence in ('high', 'low', 'unknown')),
  direction text not null check (direction in ('bullish', 'bearish', 'mixed')),
  reason_tags text[] not null default array[]::text[],
  note text not null default '',
  source text not null check (source in ('executed_trade', 'trader_adjudicated')),
  selection_biased boolean not null,
  missed_by_candidate_generator boolean not null default false,
  edited_fields text[] not null default array[]::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.replay_label_sessions enable row level security;
alter table public.replay_label_candidates enable row level security;
alter table public.replay_ground_truth_labels enable row level security;

create policy "Users manage their label sessions" on public.replay_label_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage their label candidates" on public.replay_label_candidates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage their ground truth labels" on public.replay_ground_truth_labels
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists replay_label_sessions_user_date_idx
  on public.replay_label_sessions (user_id, trading_date desc);
create index if not exists replay_label_candidates_user_date_rank_idx
  on public.replay_label_candidates (user_id, trading_date, rank);
create index if not exists replay_ground_truth_labels_user_date_idx
  on public.replay_ground_truth_labels (user_id, trading_date);
