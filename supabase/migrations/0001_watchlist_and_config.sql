-- Phase 6 foundation: persistent, per-user watchlist and strategy config.
-- Run this in the Supabase SQL Editor, or via `supabase db push` if using
-- the Supabase CLI locally.

-- === watchlists ===============================================
create table if not exists public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'My Watchlist',
  is_default boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.watchlists enable row level security;

create policy "Users can view their own watchlists"
  on public.watchlists for select
  using (auth.uid() = user_id);

create policy "Users can insert their own watchlists"
  on public.watchlists for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own watchlists"
  on public.watchlists for update
  using (auth.uid() = user_id);

create policy "Users can delete their own watchlists"
  on public.watchlists for delete
  using (auth.uid() = user_id);

-- === watchlist_symbols =========================================
create table if not exists public.watchlist_symbols (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references public.watchlists(id) on delete cascade,
  symbol text not null,
  exchange text not null default 'NASDAQ',
  added_at timestamptz not null default now(),
  unique (watchlist_id, symbol)
);

alter table public.watchlist_symbols enable row level security;

-- Access is scoped through the parent watchlist's ownership rather than
-- duplicating user_id onto every symbol row.
create policy "Users can view symbols in their own watchlists"
  on public.watchlist_symbols for select
  using (
    exists (
      select 1 from public.watchlists w
      where w.id = watchlist_symbols.watchlist_id and w.user_id = auth.uid()
    )
  );

create policy "Users can insert symbols into their own watchlists"
  on public.watchlist_symbols for insert
  with check (
    exists (
      select 1 from public.watchlists w
      where w.id = watchlist_symbols.watchlist_id and w.user_id = auth.uid()
    )
  );

create policy "Users can delete symbols from their own watchlists"
  on public.watchlist_symbols for delete
  using (
    exists (
      select 1 from public.watchlists w
      where w.id = watchlist_symbols.watchlist_id and w.user_id = auth.uid()
    )
  );

-- === strategy_configs ===========================================
-- V1 stores the entire StrategyConfig (see lib/strategies/config.ts) as a
-- single jsonb blob per user, rather than exploding ~30 threshold fields
-- into individual columns. Trade-off: simpler migrations and no schema
-- change every time a new threshold is added to the TypeScript type, at
-- the cost of not being queryable/indexable per-field in SQL. Revisit if
-- that becomes a real need.
create table if not exists public.strategy_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  config jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.strategy_configs enable row level security;

create policy "Users can view their own strategy config"
  on public.strategy_configs for select
  using (auth.uid() = user_id);

create policy "Users can insert their own strategy config"
  on public.strategy_configs for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own strategy config"
  on public.strategy_configs for update
  using (auth.uid() = user_id);

-- Keep updated_at current on every write.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger strategy_configs_set_updated_at
  before update on public.strategy_configs
  for each row execute function public.set_updated_at();
