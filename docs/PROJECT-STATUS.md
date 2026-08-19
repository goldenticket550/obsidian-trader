# Obsidian Trader — project status

Last updated: 2026-08-19

---

## WHAT THIS IS

Two scanners in one app, sharing one login.

- **`/` — the legacy scanner.** A filter. Point it at a symbol and it checks conditions and scores
  the setup. Answers *should I take this*. Still runs on its cron. Currently the engine authorized
  to send alerts (`activeAlertEngine = legacy`).
- **`/attention` — the attention engine.** A router. Watches all 61 tradeable symbols every minute
  and surfaces which ones just started mattering. Answers *where should I be looking*.

Live at **https://obsidian-trader-blue.vercel.app**

---

## HOW TO RUN A SESSION

The worker runs on the Surface; the site reads what it publishes.

1. Worker (leave running, supervised): `npm run runtime:worker` from
   `C:\Users\golde\projects\obsidian-trader`
2. Open `https://obsidian-trader-blue.vercel.app/attention` on any signed-in device.

No local build or `npm run start` needed — that runbook step is obsolete.

**Signs it's working at 09:30:** badge reads `CURRENT`; "last updated" clock ticks every 15s; mode
badge reads `SHADOW — ON-PAGE ONLY · NO OUT-OF-BAND DELIVERY`; names appear in the ranked table
from the first minute.

`DETECTION SUPPRESSED` means unavailable, not quiet. They are deliberately different states.

---

## USERS

| Email | Role |
|---|---|
| goldenticket550@gmail.com | owner |
| mosiahb17@gmail.com | viewer |
| luigit813@gmail.com | viewer |

Manage from the repo root:

```powershell
npm run attention:viewer -- grant <email> --no-invite
npm run attention:viewer -- revoke <email>
npm run attention:viewer -- list
```

`--no-invite` creates access without sending email, so grants are not blocked by Supabase's mail
quota. Viewers sign in themselves at `/login` with a magic link.

Viewers see the attention scanner only. Journal, labels, watchlist, risk settings, scan snapshots
and configuration are owner-only, enforced by row-level security — not by hidden links.

---

## WHAT WAS FIXED

| Problem | Result |
|---|---|
| Scorer ignored required conditions | Missing a required condition now caps the score |
| Score saturation — 133/154 peaks at exactly 100 | Rescaled by `maxModifier`, no clipping |
| 96% of alerts fired below their own threshold | Payload captured at the qualifying minute |
| Everything flagged `Extended` | `Extended` = EMA9 distance only. Actionable alerts 9/266 → 137/266 |
| Alert flood | Tiering: 4 primary per 15 min, secondary digested |
| Worker took 17s per minute | Static per-session baselines. 14.61s → 458ms (31.9×) |
| Nothing recorded in shadow mode | Detection validity governs storage; the control flag governs delivery only |
| Blind until 10:35 every morning | ATR warm-up bridges the prior session. **61/61 scoreable at 09:30** (was 0) |
| SPY/QQQ/IWM never scored | Self-referential benchmarks replaced with peers. Never-scoreable list is empty |
| Entire engine untracked on one machine | Committed and pushed, 650 MB archive in Git LFS |
| Worker died every night at midnight | Non-regular minutes are a zero-request dark-window no-op |

**Negative result, accepted:** early surfacing ("WAKING UP") does not work. Three attempts; the
quiet-preserving variant fired a median −202 minutes — hours *after* the move was already in play.
1-minute OHLCV cannot show a move beginning. Permanently retired; do not revisit.

---

## THE OPEN QUESTION

**Nobody has measured whether the alerts are any good.** No hit rate, no control group, no ground
truth. That is Phase F, and it is blocked on labels only the trader can produce at `/labels`.

The gate for charging anyone is not "perfect" — it is *measured*.

Watch for this specifically during evaluation sessions: were the names it surfaced ones you'd have
wanted to look at? Note the misses as much as the hits.

---

## OPEN ITEMS

1. Capture one full clean session, 09:30 → 16:00.
2. Phase F — alert quality measurement. Needs labels. Note: the label tables were never applied to
   the production database.
3. Rotate credentials — Alpaca key/secret (with the worker stopped), Vercel OIDC token,
   `CRON_SECRET`.
4. Move the worker off the Surface. Railway ~$5/mo. Required before anyone else relies on it.
5. `npm ci` reports 2 critical / 7 high vulnerabilities.
6. Alpaca **data redistribution terms** — get an answer in writing before charging anyone for
   access to market data derived from that feed.
7. Alert delivery (`attentionLiveAlertingEnabled`) is off by choice. Turn it on after evaluation.

---

## GIT

- Repo: `github.com/goldenticket550/obsidian-trader`
- Production deploys from `main`.
- 650 MB in Git LFS including the 40-session calibration archive — irreplaceable, the free IEX feed
  cannot reproduce that SIP history.

Restore on a new machine:

```powershell
git clone https://github.com/goldenticket550/obsidian-trader.git
cd obsidian-trader
git lfs pull
npm ci
```

---

## RULES THAT SHOULD NOT BE RE-LITIGATED

- Attention score: `100 × core × modifier / maxModifier`, no clipping.
  `core = √(normA × normB)` on log1p axes. Idiosyncrasy is a bounded discount, never a gate.
- `Extended` is EMA9 distance only. VWAP distance and expansion bars are badges, never freshness.
- Recording an event is not delivering it.
- Unavailable is never presented as quiet.
- Thresholds come from a reported sweep, never from an asserted value.
