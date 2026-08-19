# Phase C empirical gate diagnostics

> Timing statistics derived from historical pulls assume instantaneous bar availability. Real arrival latency is not represented. Human-relative latency and move-capture figures are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.

> Diagnostic only. No active definition or threshold changed. No ground-truth, hit-rate, latency, move-capture, or profitability conclusion is claimed.

## Freshness definitions

| Scope | Definition | Fresh | Developing | Mature | Extended | NOW IN PLAY not Extended |
|---|---|---:|---:|---:|---:|---:|
| five sessions | D1_EMA9_ONLY | 0 | 16 | 7 | 24 | 23 |
| five sessions | D2_EMA9_OR_TRAVEL | 0 | 16 | 4 | 27 | 20 |
| five sessions | D3_CURRENT | 0 | 1 | 1 | 45 | 2 |
| 40 sessions | D1_EMA9_ONLY | 1 | 75 | 61 | 129 | 137 |
| 40 sessions | D2_EMA9_OR_TRAVEL | 1 | 75 | 36 | 154 | 112 |
| 40 sessions | D3_CURRENT | 1 | 3 | 5 | 257 | 9 |

D1 uses EMA9 distance >=1.5 ATR only for Extended. D2 adds episode travel >=2 ATR. D3 is the current OR of EMA9, travel, VWAP distance, and uninterrupted expansion. VWAP distance and expansion remain useful facts but are recommended as separate badges, not do-not-chase semantics.

## Key-level relevance sweep — five sessions

| Percentile | Floor | Symbol-minutes with relevant level | Relevant level observations | Semantic transitions | Novel identities | Emitted | Allowed observations >= floor |
|---|---:|---:|---:|---:|---:|---:|---:|
| p75 | 77.44 | 1518 | 8405 | 125 | 89 | 21 | 25.08% |
| p90 | 84.11 | 1063 | 3362 | 89 | 64 | 15 | 10.03% |
| p95 | 84.72 | 870 | 1746 | 83 | 59 | 14 | 5.21% |

## ACCELERATION sweep — five sessions

| Persistence | Definition | IN PLAY | Participation | Displacement | Idiosyncrasy | Persistence | Not Extended | Opening clear | Potential events after cooldown/dedup |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1m | D1_EMA9_ONLY | 1684 | 453 | 115 | 95 | 95 | 87 | 87 | 52 |
| 1m | D2_EMA9_OR_TRAVEL | 1684 | 453 | 115 | 95 | 95 | 31 | 31 | 20 |
| 1m | D3_CURRENT | 1684 | 453 | 115 | 95 | 95 | 6 | 6 | 4 |
| 2m | D1_EMA9_ONLY | 1684 | 453 | 115 | 95 | 8 | 6 | 6 | 4 |
| 2m | D2_EMA9_OR_TRAVEL | 1684 | 453 | 115 | 95 | 8 | 3 | 3 | 1 |
| 2m | D3_CURRENT | 1684 | 453 | 115 | 95 | 8 | 1 | 1 | 1 |

## Recommendations — not published

- Freshness: D1 (EMA9-only) for trader adjudication. VWAP distance and expansion run remain separate factual badges.
- Key levels: p90 / 84.11 as the conservative distribution-derived starting point.
- ACCELERATION: 2-minute+D1 is population-viable as a rare secondary event (4 candidates across five sessions). One-minute+D1 yields 52 and is not publishable without labels. Retirement is not justified yet, but neither is activation.

Active policy remains unchanged: D3, key-level floor 90, acceleration persistence 2 minutes.

Artifact: `35af47e06a8420dc2c786330ea16cc7ed76734bad4fe1748f7430ba3427c6767`.
