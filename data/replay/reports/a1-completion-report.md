# Attention Engine Phase A1 report

Status: **COMPLETE. A2 not started.**

## Configured universe

- Canonical source: `docs/universe-authored.ts`
- Tradeable: 61
- Reference-only: 7
- Fetched in one split-adjusted batch: 68
- Reference-only entries are excluded before ranking, candidate display, event eligibility, and cluster-cap accounting.
- SMH, DRAM, IBIT, and GLD remain tradeable while resolving correctly as another symbol's sector ETF.
- Trader-approved `memory` and `ai_infra` clusters are preserved.

## AAOI archive and listing control

- Asset identity: Applied Optoelectronics
- Archive addition: 27 files and 189,191 bars
- Feed/adjustment: explicit SIP / split
- Derived candidate/effective date: 2016-01-04
- Resolution: `first_bar`
- Largest gap: none
- Possible when-issued signature: no
- Probe/following volume ratio: 0.9032 against the 0.20 threshold
- Sessions through 2026-08-15: 2,670; classification: established
- `listedSince` policy installed: no

AAOI listed in 2013, but Alpaca's full available daily response begins 2016-01-04. The negative control still has ample established history and produced neither a gap nor a when-issued flag.

## Effective listing dates and limited-history cohort

| Symbol | Authored | Derived candidate | Effective | Resolution rule | Sessions | Cohort | When-issued ratio | Leading sessions excluded | Archive bars discarded |
|---|---|---|---|---|---:|---|---:|---:|---:|
| AAOI | none | 2016-01-04 | 2016-01-04 | `first_bar` | 2670 | established control | 0.9032 | 0 | 0 |
| CRWV | 2025-03-28 | 2025-03-28 | 2025-03-28 | `first_bar` | 347 | established | 1.7455 | 0 | 0 |
| NBIS | 2024-10-21 | 2024-10-21 | 2024-10-21 | `gap_rule` | 456 | established | n/a | 0 | 2 |
| SNDK | 2025-02-24 | 2025-02-13 | 2025-02-24 | `authored_override` | 371 | established | 0.0999 | 6 | 6 |
| SPCX | 2026-06-12 | 2026-06-12 | 2026-06-12 | `first_bar` | 44 | `limited_history` | 2.5280 | 0 | 780 |

SPCX remains the only limited-history member. Alpaca supplied six printed SNDK daily bars before the 2025-02-24 regular-way boundary; all six available stub bars were excluded, and every archive path filters all timestamps before that cutoff.

## §3.16 ai_infra display replay

- Members: SMCI, DELL, NBIS, CRWV, AAOI
- Default cap: three visible
- Baseline replay: SMCI, DELL, NBIS visible; CRWV and AAOI collapsed as `+2 more in ai_infra`
- Override replay: hidden AAOI becomes the strongest WAKING UP candidate and is promoted; overflow becomes `+1 more in ai_infra`
- Full ranked order remains SMCI, DELL, NBIS, CRWV, AAOI
- State, event IDs, episode/logging rows, and rank remain present for all five names in both frames

## Archive verification

- Symbols: 200
- Files/checksums: 351/351 verified
- Bars: 31,648,036
- Bytes: 461,852,053
- Ten-symbol direct API spot checks: passed
- Metadata SHA-256: `795ea9dfb41b90821a11248e1c395ee736aef50144115baded46560ba76af952`

## Mode-map regeneration

- Version: v3
- Immutable v2-to-v3 diff: exactly 960 added AAOI buckets
- Removed buckets: 0
- Existing-bucket mode flips: 0
- Synthetic sparse 0.59 to dense 0.61 flip: passed; cache invalidation key emitted

## Verification

- Tests: 1,427 passed across 94 files
- TypeScript: passed
- Subscription: none
- Deployment: none
- Migration application: none
- Phase A2: not started
