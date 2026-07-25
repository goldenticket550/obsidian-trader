# Staging Setup & Verification Checklist

This documents how to safely test real (non-mock) behavior — live market data, real alerts, real
Supabase persistence — without touching production data or ever executing a real trade. Nothing
in this document has been set up for you; it's a plan to follow, not a completed setup. No
external accounts, cloud resources, or credentials have been created as part of writing this.

## Why a separate staging environment matters here

This app already runs safely on mock data with zero configuration (Phases 1-5's design). Staging
exists for the narrower case of testing against *real* Alpaca/Supabase behavior — a new detector
change, a new migration, a provider quirk — without risking your actual production watchlist,
journal entries, or risk settings.

## Setting up staging

1. **A second, separate Supabase project** (not your production one). Free tier is fine. Run
   every migration in `supabase/migrations/` against it, in order, same as production. This gives
   you an isolated database — nothing you do in staging can corrupt production data.
2. **Alpaca paper-trading or read-only market-data credentials**, not your live account's real
   keys if your account is ever upgraded to a live-trading tier. Alpaca's free tier is
   inherently data-only in this app (see Phase 4's README section) — this app never places
   trades regardless of which Alpaca credentials are used, but paper/sandbox credentials are
   still the safer default when testing.
3. **A separate `.env.staging.local` (or equivalent) with its own values** — never reuse
   production's `NEXT_PUBLIC_SUPABASE_URL`/keys/`ALPACA_*`/`ANTHROPIC_API_KEY` in staging. Point
   staging's Supabase URL at the staging project from step 1, and (optionally) a separate Alpaca
   key pair if you have one, or the same read-only market-data key if Alpaca doesn't offer a
   separate staging key (market-data-only access has no execution capability regardless of which
   environment reads it).
4. **A visible "STAGING" indicator in the UI when this environment is active** — not built yet.
   A reasonable implementation: an env var like `NEXT_PUBLIC_ENVIRONMENT_LABEL=staging`, checked
   in `app/layout.tsx`, rendering a small colored banner (e.g. in the top nav bar, similar to how
   `data quality: simulated/realtime/delayed` already works) whenever it's set to anything other
   than `production`. This is real, small, buildable work — flagging it here as documented but
   not yet implemented, rather than claiming it exists.
5. **No live brokerage execution** — not applicable to change, since this app never places trades
   in any environment, staging or production. Nothing to configure here beyond confirming that
   remains true (see Phase 6's "no automatic trade execution" principle, unchanged).

## End-to-end verification checklist

Run through this in staging after any change that touches market data, scoring, or alerts:

1. **Market-data retrieval** — confirm `/api/scan` (or a direct call to `AlpacaProvider.getCandles()`)
   returns real bars with sensible OHLCV values, not `null`/`undefined`/all-zero data.
2. **Candle timestamp and timeframe validation** — confirm the most recent bar's timestamp is
   actually recent (not stale — this app has hit real bugs here before, see the "stale candle
   pagination" and "January 1970" sections above) and that 15m bars are genuinely 900 seconds
   apart, not secretly 300 seconds like the 5m series.
3. **`scanWatchlist()` / `scanWatchlistWithProvider()`** — confirm it runs against every symbol
   in the staging watchlist without throwing, and returns a `SetupResult` per symbol/timeframe.
4. **Scoring and entry-status behavior** — spot-check a few real symbols' scores against the
   checklist manually (does a symbol with several passing core conditions actually score higher
   than one with only supporting conditions passing?) and confirm `entryStatus` responds sensibly
   (a symbol that's run far from its EMA should show `extended_do_not_chase`, not
   `actionable_now`).
5. **Alert creation and deduplication** — trigger `/api/cron/scan` (with the staging
   `CRON_SECRET`) twice in a row with no real market movement in between; confirm the second run
   fires zero new alerts (proves the persistent alert store's diffing and cooldown logic are
   both working, not just that the endpoint responds `200`).
6. **Dashboard display** — sign into the staging app, confirm the watchlist, setup detail panel,
   accountability panel, journal, and alerts page all render real (not mock) data correctly,
   including the conviction/entry-status badges and invalidation notes from Phase 8.
7. **Supabase persistence and Row Level Security** — as one staging user, confirm you can create/
   read/update your own watchlist, journal entries, and settings. If you have a second staging
   user available, confirm they cannot see the first user's data (RLS is doing its job) — this is
   the single most important check, since a RLS policy gap is a real privacy bug, not just an
   inconvenience.
8. **Failure behavior when providers are unavailable** — temporarily point `ALPACA_API_KEY_ID` at
   an invalid value (in staging only) and confirm the app fails with a clear, visible error
   message rather than silently showing stale or fabricated data. Restore the real staging key
   afterward.

## What this document is not

This is a plan and a checklist, not a completed integration or a claim that staging currently
exists. No Supabase project, Alpaca account, or credential was created while writing this — per
the review that requested this document, only safe repository configuration and documentation
were added.
