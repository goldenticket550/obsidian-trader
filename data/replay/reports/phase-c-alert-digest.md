# Phase C published replay alert digest

> Timing statistics derived from historical pulls assume instantaneous bar availability. Real arrival latency is not represented. Human-relative latency and move-capture figures are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.

> This describes event-engine output. It is not a performance, hit-rate, latency, move-capture, discovery-quality, or correctness evaluation.

> Published combined-policy finding: D1 releases additional p90 key-level transitions. KEY LEVEL EVENT emits 43 rather than the isolated D3 diagnostic's 15. Delivery remains capped, but the resulting envelope load is reported explicitly and is not silently retuned.

Policy: IN PLAY exit 0.66, persistence 15, episode cooling timeout 45 minutes, pending-alert expiry 10 minutes. Alerts are replay-only and no delivery channel exists.
DIRECTION TRANSITION is unavailable until Phase D supplies a direction state; it is not fabricated in Phase C.

## Five-session statistics

- Alerts by type: NOW_IN_PLAY 47; ACCELERATION 4; KEY_LEVEL_EVENT 43; FAILED_ACCELERATION 0.
- NOW IN PLAY qualifying core: min 0.729, median 0.891, max 0.991; threshold violations 0.
- Freshness at qualification: Fresh 0; Developing 16; Mature 7; Extended 24; n/a 0.
- Qualifying-to-emission gap: min 0, median 0, max 0 minutes.
- Excluding early close: NOW_IN_PLAY 47; ACCELERATION 4; KEY_LEVEL_EVENT 43; FAILED_ACCELERATION 0; NOW IN PLAY freshness Fresh 0; Developing 16; Mature 7; Extended 24; n/a 0.
- Early-close census: 1/40 corpus sessions (2.50%). 53 closing-window candidates were dropped; 0 alerts emitted from the early-close session.

## Early-close baseline decision

The corpus keys baselines by symbol x minute-of-day. It does not carry a close-relative bucket identity. On an early close, 12:59 therefore compares with ordinary-session midday history rather than closing-auction history. With only one early-close session in the 40-session corpus, a dedicated distribution cannot be estimated honestly. The final 15 minutes are excluded from alert emission and logged as `early_close_baseline_unavailable` until a versioned close-relative baseline is built. At and after the calendar close, candidates are dropped as `session_closed`.

## Post-storage tiered delivery

PRIMARY is NOW IN PLAY. It retains the existing 4-envelope rolling 15-minute budget, including an overflow digest; deliveries inside the direct capacity are individual. Material override (+10 attention points) applies only to PRIMARY.
SECONDARY is KEY LEVEL EVENT plus ACCELERATION. It is never delivered individually: at most 1 update-in-place digest starts per rolling 15 minutes, listing every secondary event in that window.

| Date | Primary detected | Secondary detected | Primary direct | Primary digests | Secondary digests | Total envelopes | Primary collapsed | Secondary collapsed | Overrides | Max primary / 15m | Max secondary digests / 15m |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2025-10-01 | 8 | 12 | 8 | 0 | 4 | 12 | 0 | 12 | 0 | 3 | 1 |
| 2025-10-10 | 32 | 25 | 9 | 2 | 5 | 16 | 23 | 25 | 0 | 4 | 1 |
| 2025-11-04 | 6 | 10 | 6 | 0 | 4 | 10 | 0 | 10 | 0 | 2 | 1 |
| 2025-11-28 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2026-02-13 | 1 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |

Stored detections remain 94: PRIMARY 47, SECONDARY 47. Delivery produces 39 envelopes: 24 direct PRIMARY, 2 PRIMARY digests, and 13 SECONDARY digests. State, event storage, suppression logs, and standing lists are unchanged.
PRIMARY cap holds; SECONDARY cap holds. Sessions above eight direct PRIMARY deliveries: 2025-10-10 (9). The budgets were not adjusted.

## Published freshness definition — D1

Extended now means distance from the current 9 EMA >=1.5 ATR, and nothing else. Episode travel remains a maturity/history input. VWAP distance and consecutive expansion bars are factual payload badges and never classify freshness or suppress an event.

- ATR travel since episode start: median 1.38, IQR 0.62-2.76, max 5.11.
- EMA9 distance: median 1.59, IQR 1.17-1.94, max 3.05 ATR.
- VWAP factual badge: median 2.94, IQR 1.98-4.94, max 14.90 ATR; 40 rows are >=1.5 ATR.
- Expansion factual badge: 46 rows have an active run; 41 have >=4 bars.
- D1 Extended count: 24. Extended without the EMA9 condition: 0.
- Without back-dating: Fresh 1; Developing 19; Mature 3; Extended 24.

D2 (EMA9 OR episode travel) was rejected because history is not the same claim as current entry extension. D3 was rejected because VWAP distance and expansion momentum mislabeled trending, actively expanding names as do-not-chase. The 40-session comparison is versioned in `phase-c-empirical-gate-diagnostics.json`.

## ACCELERATION gate funnel

| Gate | Independent pass | Cumulative survivors |
|---|---:|---:|
| Active episode | 9751 | 9751 |
| IN PLAY | 1684 | 1684 |
| Participation delta >= 0.75 | 2413 | 453 |
| Displacement delta >= 0.75 | 1805 | 115 |
| Idiosyncrasy supportive | 8092 | 95 |
| Persistence >= 2 | 21 | 8 |
| Quality | 9751 | 8 |
| Mode guard clear | 9643 | 8 |
| Not Extended | 9357 | 6 |
| Opening protection | 9566 | 6 |

Two-minute consecutive confluence remains primary (95 -> 8 cumulative survivors). Published D1 admits 6 after extension and 4 emit after cooldown/identity handling.

## KEY LEVEL EVENT gate funnel

Allowed-level relevance distribution: p50 67.50, p75 77.44, p90 84.11, p95 84.72, p99 88.46, max 92.42. Floor: 84.11111111111111.

Eligible IN PLAY symbol-minutes 1684 -> map 1684 -> allowed level 1684 -> relevance >=84.11 1063 -> selected 1063 -> semantic transition 89 -> novel identity 64 -> emitted 43.
10.03% of allowed level observations meet the published p90 floor. Semantic transitions remain selective but not over-tight: 1063 relevant symbol-minutes -> 89 transitions -> 64 novel identities.

## 2026-02-13 confirmation

AAPL qualified at 08:53 ET in premarket_core. It was not a regular-session alert; the earlier zero-IN-PLAY result across all 390 regular minutes remains correct.

## 2025-10-01 - trending_up

Split: holdout. Detected/stored alerts: 20. Delivered envelopes: 12. Collapsed detections: 12. Suppressions: 8.

### Delivery compaction

- 10:48 ET: 6 secondary attention events in the last 15 min: ACCELERATION GLD, KEY_LEVEL_EVENT NKE, KEY_LEVEL_EVENT NKE, KEY_LEVEL_EVENT GDX, KEY_LEVEL_EVENT GLD, KEY_LEVEL_EVENT GLD ([full list](/attention?view=in-play))
- 11:03 ET: 1 secondary attention event in the last 15 min: KEY_LEVEL_EVENT GDX ([full list](/attention?view=in-play))
- 14:01 ET: 4 secondary attention events in the last 15 min: KEY_LEVEL_EVENT AMD, KEY_LEVEL_EVENT AMD, KEY_LEVEL_EVENT AMD, KEY_LEVEL_EVENT TSM ([full list](/attention?view=in-play))
- 14:16 ET: 1 secondary attention event in the last 15 min: KEY_LEVEL_EVENT TSM ([full list](/attention?view=in-play))
### Stored detections

#### 10:47 ET - NOW_IN_PLAY - GLD

- episodeId: `a3:GLD:1759330020000`
- qualified: 10:47 ET; emitted: 10:47 ET; gap: 0 min
- attention at qualification: 80.87
- core at qualification: 0.809 (raw 0.809); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 3.61/0.732; displacement 3.25/0.893; idiosyncrasy 7.24/0.979
- freshness at qualification: Extended; ATR travelled: 1.16
- **EXTENDED — do not chase**; ATR travelled since episode start: 1.16
- nearest reference at qualification: SWING_LOW 355.70 (0.11 ATR)
- badges: ok; SIP; 1.8 ATR from VWAP; 9 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 10:47 ET - NOW_IN_PLAY - NKE

- episodeId: `a3:NKE:1759329960000`
- qualified: 10:47 ET; emitted: 10:47 ET; gap: 0 min
- attention at qualification: 81.53
- core at qualification: 0.815 (raw 0.815); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 3.89/0.771; displacement 3.02/0.862; idiosyncrasy 7.70/0.986
- freshness at qualification: Developing; ATR travelled: 0.00
- nearest reference at qualification: SWING_HIGH 73.43 (0.54 ATR)
- badges: ok; SIP; 1.9 ATR from VWAP; 8 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 10:48 ET - ACCELERATION - GLD

- episodeId: `a3:GLD:1759330020000`
- qualified: 10:48 ET; emitted: 10:48 ET; gap: 0 min
- attention at qualification: 97.14
- core at qualification: 0.971 (raw 0.971); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 7.46/0.981; displacement 4.14/0.962; idiosyncrasy 5.67/0.928
- freshness at qualification: Mature; ATR travelled: 0.77
- nearest reference at qualification: SWING_LOW 355.70 (0.21 ATR)
- badges: ok; SIP; 1.2 ATR from VWAP; 10 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 10:48 ET - NOW_IN_PLAY - GDX

- episodeId: `a3:GDX:1759330080000`
- qualified: 10:48 ET; emitted: 10:48 ET; gap: 0 min
- attention at qualification: 92.39
- core at qualification: 0.924 (raw 0.924); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 5.64/0.928; displacement 3.51/0.920; idiosyncrasy 5.67/0.928
- freshness at qualification: Developing; ATR travelled: 0.07
- nearest reference at qualification: SWING_LOW 77.36 (0.25 ATR)
- badges: ok; SIP; 0.9 ATR from VWAP; 10 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 10:50 ET - KEY_LEVEL_EVENT - NKE

- episodeId: `a3:NKE:1759329960000`
- qualified: 10:50 ET; emitted: 10:50 ET; gap: 0 min
- attention at qualification: 47.38
- core at qualification: 0.494 (raw 0.494); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 3.55/0.723; displacement 1.01/0.337; idiosyncrasy 2.07/0.396
- freshness at qualification: Mature; ATR travelled: 0.36
- nearest reference at qualification: SWING_HIGH 73.43 (0.18 ATR)
- badges: ok; SIP; 1.6 ATR from VWAP; 11 expansion bars
- key level: break SWING_HIGH (0.18 ATR)
- **NOT AN ENTRY — open the chart.**

#### 10:51 ET - KEY_LEVEL_EVENT - NKE

- episodeId: `a3:NKE:1759329960000`
- qualified: 10:51 ET; emitted: 10:51 ET; gap: 0 min
- attention at qualification: 52.18
- core at qualification: 0.522 (raw 0.522); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 3.38/0.696; displacement 1.20/0.391; idiosyncrasy 5.73/0.931
- freshness at qualification: Mature; ATR travelled: 0.52
- nearest reference at qualification: SWING_HIGH 73.43 (0.02 ATR)
- badges: ok; SIP; 1.4 ATR from VWAP; 12 expansion bars
- key level: retest SWING_HIGH (0.02 ATR)
- **NOT AN ENTRY — open the chart.**

#### 10:57 ET - KEY_LEVEL_EVENT - GDX

- episodeId: `a3:GDX:1759330080000`
- qualified: 10:57 ET; emitted: 10:57 ET; gap: 0 min
- attention at qualification: 29.37
- core at qualification: 0.316 (raw 0.316); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 1.23/0.307; displacement 0.97/0.326; idiosyncrasy 1.37/0.269
- freshness at qualification: Developing; ATR travelled: 1.15
- nearest reference at qualification: VWAP 77.54 (0.15 ATR)
- badges: ok; SIP; 0.1 ATR from VWAP; 19 expansion bars
- key level: approach SWING_HIGH (0.00 ATR)
- **NOT AN ENTRY — open the chart.**

#### 10:58 ET - KEY_LEVEL_EVENT - GLD

- episodeId: `a3:GLD:1759330020000`
- qualified: 10:58 ET; emitted: 10:58 ET; gap: 0 min
- attention at qualification: 27.26
- core at qualification: 0.298 (raw 0.298); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 0.54/0.206; displacement 1.33/0.431; idiosyncrasy 1.02/0.216
- freshness at qualification: Mature; ATR travelled: 0.47
- nearest reference at qualification: SWING_LOW 356.54 (0.14 ATR)
- badges: ok; SIP; 0.2 ATR from VWAP; 20 expansion bars
- key level: approach SWING_LOW (0.14 ATR)
- **NOT AN ENTRY — open the chart.**

#### 10:59 ET - KEY_LEVEL_EVENT - GLD

- episodeId: `a3:GLD:1759330020000`
- qualified: 10:59 ET; emitted: 10:59 ET; gap: 0 min
- attention at qualification: 11.79
- core at qualification: 0.134 (raw 0.134); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation -0.07/0.141; displacement 0.02/0.129; idiosyncrasy 0.18/0.121
- freshness at qualification: Mature; ATR travelled: 0.45
- nearest reference at qualification: VWAP 356.38 (0.13 ATR)
- badges: ok; SIP; 0.1 ATR from VWAP; 21 expansion bars
- key level: rejection SWING_LOW (0.17 ATR)
- **NOT AN ENTRY — open the chart.**

#### 11:03 ET - KEY_LEVEL_EVENT - GDX

- episodeId: `a3:GDX:1759330080000`
- qualified: 11:03 ET; emitted: 11:03 ET; gap: 0 min
- attention at qualification: 12.65
- core at qualification: 0.146 (raw 0.146); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 1.52/0.354; displacement -0.65/0.060; idiosyncrasy -0.10/0.098
- freshness at qualification: Mature; ATR travelled: 0.97
- nearest reference at qualification: VWAP 77.54 (0.11 ATR)
- badges: ok; SIP; 0.1 ATR from VWAP; 4 expansion bars
- key level: rejection SWING_HIGH (0.27 ATR)
- **NOT AN ENTRY — open the chart.**

#### 11:29 ET - NOW_IN_PLAY - SMCI

- episodeId: `a3:SMCI:1759332480000`
- qualified: 11:29 ET; emitted: 11:29 ET; gap: 0 min
- attention at qualification: 87.38
- core at qualification: 0.874 (raw 0.874); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 6.50/0.961; displacement 2.63/0.794; idiosyncrasy 4.81/0.864
- freshness at qualification: Developing; ATR travelled: 0.44
- nearest reference at qualification: HOD 49.93 (0.17 ATR)
- badges: ok; SIP; 3.9 ATR from VWAP; 20 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 12:36 ET - NOW_IN_PLAY - XOM

- episodeId: `a3:XOM:1759335720000`
- qualified: 12:36 ET; emitted: 12:36 ET; gap: 0 min
- attention at qualification: 88.84
- core at qualification: 0.888 (raw 0.888); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 7.62/0.983; displacement 2.68/0.803; idiosyncrasy 8.00/0.989
- freshness at qualification: Extended; ATR travelled: 3.50
- **EXTENDED — do not chase**; ATR travelled since episode start: 3.50
- nearest reference at qualification: LOD 111.53 (0.05 ATR)
- badges: ok; SIP; 3.9 ATR from VWAP; 27 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 13:59 ET - NOW_IN_PLAY - AMD

- episodeId: `a3:AMD:1759341540000`
- qualified: 13:59 ET; emitted: 13:59 ET; gap: 0 min
- attention at qualification: 95.31
- core at qualification: 0.953 (raw 0.953); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 6.26/0.954; displacement 3.95/0.952; idiosyncrasy 8.00/0.989
- freshness at qualification: Extended; ATR travelled: 1.44
- **EXTENDED — do not chase**; ATR travelled since episode start: 1.44
- nearest reference at qualification: SWING_HIGH 162.86 (0.22 ATR)
- badges: ok; SIP; 1.0 ATR from VWAP; 14 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 13:59 ET - NOW_IN_PLAY - SMH

- episodeId: `a3:SMH:1759341540000`
- qualified: 13:59 ET; emitted: 13:59 ET; gap: 0 min
- attention at qualification: 85.47
- core at qualification: 0.855 (raw 0.855); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 6.26/0.954; displacement 2.50/0.766; idiosyncrasy 6.55/0.964
- freshness at qualification: Developing; ATR travelled: 0.42
- nearest reference at qualification: SWING_HIGH 331.78 (0.06 ATR)
- badges: ok; SIP; 7.2 ATR from VWAP; 6 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 14:01 ET - KEY_LEVEL_EVENT - AMD

- episodeId: `a3:AMD:1759341540000`
- qualified: 14:01 ET; emitted: 14:01 ET; gap: 0 min
- attention at qualification: 75.16
- core at qualification: 0.752 (raw 0.752); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 2.88/0.609; displacement 3.59/0.927; idiosyncrasy 5.59/0.924
- freshness at qualification: Mature; ATR travelled: 1.15
- nearest reference at qualification: SWING_LOW 162.63 (0.15 ATR)
- badges: ok; SIP; 0.7 ATR from VWAP; 16 expansion bars
- key level: approach SWING_LOW (0.15 ATR)
- **NOT AN ENTRY — open the chart.**

#### 14:02 ET - NOW_IN_PLAY - TSM

- episodeId: `a3:TSM:1759341540000`
- qualified: 14:02 ET; emitted: 14:02 ET; gap: 0 min
- attention at qualification: 89.78
- core at qualification: 0.898 (raw 0.898); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 5.21/0.903; displacement 3.25/0.893; idiosyncrasy 8.00/0.989
- freshness at qualification: Extended; ATR travelled: 2.84
- **EXTENDED — do not chase**; ATR travelled since episode start: 2.84
- nearest reference at qualification: VWAP 285.74 (0.15 ATR)
- badges: ok; SIP; 0.2 ATR from VWAP; 7 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 14:07 ET - KEY_LEVEL_EVENT - AMD

- episodeId: `a3:AMD:1759341540000`
- qualified: 14:07 ET; emitted: 14:07 ET; gap: 0 min
- attention at qualification: 44.97
- core at qualification: 0.450 (raw 0.450); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 3.62/0.733; displacement 0.78/0.276; idiosyncrasy 3.93/0.754
- freshness at qualification: Mature; ATR travelled: 0.02
- nearest reference at qualification: SWING_HIGH 162.23 (0.01 ATR)
- badges: ok; SIP; 0.3 ATR from VWAP; 22 expansion bars
- key level: approach SWING_HIGH (0.01 ATR)
- **NOT AN ENTRY — open the chart.**

#### 14:13 ET - KEY_LEVEL_EVENT - AMD

- episodeId: `a3:AMD:1759341540000`
- qualified: 14:13 ET; emitted: 14:13 ET; gap: 0 min
- attention at qualification: 15.60
- core at qualification: 0.173 (raw 0.173); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 1.67/0.383; displacement -0.42/0.079; idiosyncrasy 0.69/0.174
- freshness at qualification: Mature; ATR travelled: 0.22
- nearest reference at qualification: SWING_HIGH 162.23 (0.24 ATR)
- badges: ok; SIP; 0.5 ATR from VWAP; 28 expansion bars
- key level: rejection SWING_HIGH (0.24 ATR)
- **NOT AN ENTRY — open the chart.**

#### 14:13 ET - KEY_LEVEL_EVENT - TSM

- episodeId: `a3:TSM:1759341540000`
- qualified: 14:13 ET; emitted: 14:13 ET; gap: 0 min
- attention at qualification: 7.60
- core at qualification: 0.084 (raw 0.084); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 0.36/0.184; displacement -1.03/0.039; idiosyncrasy 0.69/0.174
- freshness at qualification: Mature; ATR travelled: 0.69
- nearest reference at qualification: SWING_LOW 287.75 (0.01 ATR)
- badges: ok; SIP; 1.6 ATR from VWAP; 18 expansion bars
- key level: approach SWING_LOW (0.01 ATR)
- **NOT AN ENTRY — open the chart.**

#### 14:16 ET - KEY_LEVEL_EVENT - TSM

- episodeId: `a3:TSM:1759341540000`
- qualified: 14:16 ET; emitted: 14:16 ET; gap: 0 min
- attention at qualification: 12.77
- core at qualification: 0.136 (raw 0.136); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 0.86/0.249; displacement -0.47/0.074; idiosyncrasy 1.55/0.300
- freshness at qualification: Mature; ATR travelled: 0.31
- nearest reference at qualification: SWING_LOW 287.75 (0.35 ATR)
- badges: ok; SIP; 1.9 ATR from VWAP; 21 expansion bars
- key level: rejection SWING_LOW (0.35 ATR)
- **NOT AN ENTRY — open the chart.**

### Suppression log

| Time ET | Symbol | Event | Reason | Disposition | Identity |
|---|---|---|---|---|---|
| 10:47 | GLD | ACCELERATION | redundant_with_entry | discard_duplicate | `ACCELERATION|a3:GLD:1759330020000|1954811` |
| 10:52 | NKE | KEY_LEVEL_EVENT | same_level_state | discard_duplicate | `KEY_LEVEL_EVENT|a3:NKE:1759329960000|2025-10-01:SWING_HIGH:1759319400000:73.430000|retest` |
| 10:54 | NKE | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:NKE:1759329960000|1954811` |
| 11:08 | NKE | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:NKE:1759329960000|1954812` |
| 11:38 | SMCI | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:SMCI:1759332480000|1954814` |
| 12:45 | XOM | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:XOM:1759335720000|1954819` |
| 13:59 | AMD | ACCELERATION | redundant_with_entry | discard_duplicate | `ACCELERATION|a3:AMD:1759341540000|1954823` |
| 14:21 | TSM | KEY_LEVEL_EVENT | same_level_state | discard_duplicate | `KEY_LEVEL_EVENT|a3:TSM:1759341540000|2025-10-01:SWING_LOW:1759337400000:287.753600|approach` |

## 2025-10-10 - high_volatility

Split: train. Detected/stored alerts: 57. Delivered envelopes: 16. Collapsed detections: 48. Suppressions: 68.

### Delivery compaction

- 08:00 ET: 1 secondary attention event in the last 15 min: KEY_LEVEL_EVENT SNAP ([full list](/attention?view=in-play))
- 10:59 ET: 20 more names entered IN PLAY in the last 15 min: AMZN, CRWV, DELL, HOOD, IBIT, MRVL, QCOM, SMCI, SMH, SOFI, TSM, COIN, AMD, USO, ARM, AVGO, META, NKE, NVDA, TSLA ([full list](/attention?view=in-play))
- 11:04 ET: 16 secondary attention events in the last 15 min: KEY_LEVEL_EVENT AVGO, KEY_LEVEL_EVENT AVGO, KEY_LEVEL_EVENT DELL, KEY_LEVEL_EVENT AVGO, KEY_LEVEL_EVENT AVGO, KEY_LEVEL_EVENT CRWV, KEY_LEVEL_EVENT DELL, KEY_LEVEL_EVENT AVGO, KEY_LEVEL_EVENT DELL, KEY_LEVEL_EVENT MRVL, KEY_LEVEL_EVENT MRVL, KEY_LEVEL_EVENT SOFI, KEY_LEVEL_EVENT AVGO, KEY_LEVEL_EVENT SOFI, ACCELERATION AMZN, KEY_LEVEL_EVENT SOFI ([full list](/attention?view=in-play))
- 11:31 ET: 3 secondary attention events in the last 15 min: ACCELERATION TSLA, KEY_LEVEL_EVENT IWM, ACCELERATION AVGO ([full list](/attention?view=in-play))
- 11:47 ET: 3 secondary attention events in the last 15 min: KEY_LEVEL_EVENT IWM, KEY_LEVEL_EVENT IWM, KEY_LEVEL_EVENT IWM ([full list](/attention?view=in-play))
- 15:19 ET: 2 secondary attention events in the last 15 min: KEY_LEVEL_EVENT AMD, KEY_LEVEL_EVENT AMD ([full list](/attention?view=in-play))
- 16:55 ET: 3 more names entered IN PLAY in the last 15 min: CRWV, SOFI, AMZN ([full list](/attention?view=in-play))
### Stored detections

#### 04:47 ET - NOW_IN_PLAY - SNAP

- episodeId: `a3:SNAP:1760086020000`
- qualified: 04:47 ET; emitted: 04:47 ET; gap: 0 min
- attention at qualification: 69.09
- core at qualification: 0.729 (raw 0.729); IN PLAY enter: 0.723
- calibration: sip x premarket_early; `mode-map-v3:measure-v1:curve-v3:state-v3:sip:premarket_early:population-82f216fdd69d`
- axes at qualification (input/normalized): participation 2.11/0.652; displacement 2.72/0.816; idiosyncrasy 1.79/0.324
- freshness at qualification: Developing; ATR travelled: 0.70
- nearest reference at qualification: VWAP 8.43 (1.35 ATR)
- badges: ok; SIP; 1.4 ATR from VWAP
- **NOT AN ENTRY — open the chart.**

#### 08:00 ET - KEY_LEVEL_EVENT - SNAP

- episodeId: `a3:SNAP:1760086020000`
- qualified: 08:00 ET; emitted: 08:00 ET; gap: 0 min
- attention at qualification: 5.79
- core at qualification: 0.069 (raw 0.069); IN PLAY enter: 0.722
- calibration: sip x premarket_core; `mode-map-v3:measure-v1:curve-v3:state-v3:sip:premarket_core:population-82f216fdd69d`
- axes at qualification (input/normalized): participation -1.65/0.040; displacement -0.05/0.119; idiosyncrasy -0.57/0.078
- freshness at qualification: Mature; ATR travelled: 3.91
- nearest reference at qualification: SWING_LOW 8.39 (0.65 ATR)
- badges: ok; SIP; 1.4 ATR from VWAP; 1 expansion bars
- key level: break SWING_LOW (1.95 ATR)
- **NOT AN ENTRY — open the chart.**

#### 10:58 ET - NOW_IN_PLAY - SPY

- episodeId: `a3:SPY:1760108280000`
- qualified: 10:58 ET; emitted: 10:58 ET; gap: 0 min
- attention at qualification: 86.16
- core at qualification: 0.991 (raw 0.991); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 8.00/0.987; displacement 5.67/0.994; idiosyncrasy 0.00/0.106
- freshness at qualification: Extended; ATR travelled: 1.35
- **EXTENDED — do not chase**; ATR travelled since episode start: 1.35
- nearest reference at qualification: LOD 668.91 (0.97 ATR)
- badges: ok; SIP; 2.9 ATR from VWAP; 19 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 10:58 ET - NOW_IN_PLAY - QQQ

- episodeId: `a3:QQQ:1760108280000`
- qualified: 10:58 ET; emitted: 10:58 ET; gap: 0 min
- attention at qualification: 85.23
- core at qualification: 0.980 (raw 0.980); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 6.89/0.971; displacement 5.20/0.990; idiosyncrasy 0.00/0.106
- freshness at qualification: Extended; ATR travelled: 1.16
- **EXTENDED — do not chase**; ATR travelled since episode start: 1.16
- nearest reference at qualification: LOD 608.26 (0.94 ATR)
- badges: ok; SIP; 3.0 ATR from VWAP; 9 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 10:58 ET - NOW_IN_PLAY - IWM

- episodeId: `a3:IWM:1760108280000`
- qualified: 10:58 ET; emitted: 10:58 ET; gap: 0 min
- attention at qualification: 85.62
- core at qualification: 0.985 (raw 0.985); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 7.87/0.986; displacement 4.81/0.983; idiosyncrasy 0.00/0.106
- freshness at qualification: Extended; ATR travelled: 1.22
- **EXTENDED — do not chase**; ATR travelled since episode start: 1.22
- nearest reference at qualification: LOD 243.87 (0.65 ATR)
- badges: ok; SIP; 2.6 ATR from VWAP; 2 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 10:59 ET - NOW_IN_PLAY - AMZN

- episodeId: `a3:AMZN:1760108280000`
- qualified: 10:59 ET; emitted: 10:59 ET; gap: 0 min
- attention at qualification: 95.66
- core at qualification: 0.957 (raw 0.957); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 6.59/0.964; displacement 3.90/0.949; idiosyncrasy 5.59/0.923
- freshness at qualification: Extended; ATR travelled: 1.45
- **EXTENDED — do not chase**; ATR travelled since episode start: 1.45
- nearest reference at qualification: PML 225.73 (0.66 ATR)
- badges: ok; SIP; 2.2 ATR from VWAP; 6 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 10:59 ET - NOW_IN_PLAY - QCOM

- episodeId: `a3:QCOM:1760108340000`
- qualified: 10:59 ET; emitted: 10:59 ET; gap: 0 min
- attention at qualification: 95.52
- core at qualification: 0.955 (raw 0.955); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 5.68/0.930; displacement 4.71/0.981; idiosyncrasy 8.00/0.989
- freshness at qualification: Developing; ATR travelled: 0.34
- nearest reference at qualification: SWING_HIGH 162.18 (0.10 ATR)
- badges: ok; SIP; 1.8 ATR from VWAP; 5 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 10:59 ET - NOW_IN_PLAY - MRVL

- episodeId: `a3:MRVL:1760108340000`
- qualified: 10:59 ET; emitted: 10:59 ET; gap: 0 min
- attention at qualification: 85.14
- core at qualification: 0.851 (raw 0.851); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 4.56/0.849; displacement 2.97/0.854; idiosyncrasy 8.00/0.989
- freshness at qualification: Developing; ATR travelled: 0.24
- nearest reference at qualification: SWING_LOW 92.12 (0.12 ATR)
- badges: ok; SIP; 1.8 ATR from VWAP; 6 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 10:59 ET - NOW_IN_PLAY - TSM

- episodeId: `a3:TSM:1760108340000`
- qualified: 10:59 ET; emitted: 10:59 ET; gap: 0 min
- attention at qualification: 92.23
- core at qualification: 0.922 (raw 0.922); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 4.77/0.869; displacement 4.64/0.979; idiosyncrasy 8.00/0.989
- freshness at qualification: Developing; ATR travelled: 0.14
- nearest reference at qualification: SWING_LOW 295.43 (0.51 ATR)
- badges: ok; SIP; 2.4 ATR from VWAP; 5 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 10:59 ET - NOW_IN_PLAY - SMH

- episodeId: `a3:SMH:1760108280000`
- qualified: 10:59 ET; emitted: 10:59 ET; gap: 0 min
- attention at qualification: 95.50
- core at qualification: 0.955 (raw 0.955); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 5.50/0.920; displacement 5.31/0.991; idiosyncrasy 8.00/0.989
- freshness at qualification: Extended; ATR travelled: 1.58
- **EXTENDED — do not chase**; ATR travelled since episode start: 1.58
- nearest reference at qualification: LOD 341.66 (1.33 ATR)
- badges: ok; SIP; 2.4 ATR from VWAP; 5 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 10:59 ET - NOW_IN_PLAY - SMCI

- episodeId: `a3:SMCI:1760108340000`
- qualified: 10:59 ET; emitted: 10:59 ET; gap: 0 min
- attention at qualification: 88.77
- core at qualification: 0.888 (raw 0.888); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 4.25/0.816; displacement 4.23/0.966; idiosyncrasy 8.00/0.989
- freshness at qualification: Developing; ATR travelled: 0.61
- nearest reference at qualification: ORL 57.11 (0.14 ATR)
- badges: ok; SIP; 1.9 ATR from VWAP; 10 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 10:59 ET - NOW_IN_PLAY - DELL

- episodeId: `a3:DELL:1760108340000`
- qualified: 10:59 ET; emitted: 10:59 ET; gap: 0 min
- attention at qualification: 83.98
- core at qualification: 0.840 (raw 0.840); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 3.58/0.728; displacement 4.32/0.969; idiosyncrasy 5.56/0.922
- freshness at qualification: Developing; ATR travelled: 0.27
- nearest reference at qualification: ORL 157.10 (0.01 ATR)
- badges: ok; SIP; 0.5 ATR from VWAP; 6 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 10:59 ET - NOW_IN_PLAY - CRWV

- episodeId: `a3:CRWV:1760108340000`
- qualified: 10:59 ET; emitted: 10:59 ET; gap: 0 min
- attention at qualification: 91.82
- core at qualification: 0.918 (raw 0.918); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 4.61/0.854; displacement 5.02/0.987; idiosyncrasy 8.00/0.989
- freshness at qualification: Developing; ATR travelled: 0.20
- nearest reference at qualification: SWING_HIGH 144.97 (0.00 ATR)
- badges: ok; SIP; 2.0 ATR from VWAP; 10 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 10:59 ET - NOW_IN_PLAY - HOOD

- episodeId: `a3:HOOD:1760108280000`
- qualified: 10:59 ET; emitted: 10:59 ET; gap: 0 min
- attention at qualification: 84.45
- core at qualification: 0.845 (raw 0.845); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 3.55/0.722; displacement 5.11/0.988; idiosyncrasy 8.00/0.989
- freshness at qualification: Mature; ATR travelled: 1.29
- nearest reference at qualification: LOD 146.40 (0.75 ATR)
- badges: ok; SIP; 4.0 ATR from VWAP; 26 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 10:59 ET - NOW_IN_PLAY - IBIT

- episodeId: `a3:IBIT:1760108280000`
- qualified: 10:59 ET; emitted: 10:59 ET; gap: 0 min
- attention at qualification: 87.13
- core at qualification: 0.940 (raw 0.940); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 5.11/0.896; displacement 4.99/0.986; idiosyncrasy 1.32/0.260
- freshness at qualification: Developing; ATR travelled: 0.70
- nearest reference at qualification: LOD 68.44 (0.09 ATR)
- badges: ok; SIP; 2.9 ATR from VWAP; 3 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 10:59 ET - NOW_IN_PLAY - SOFI

- episodeId: `a3:SOFI:1760108340000`
- qualified: 10:59 ET; emitted: 10:59 ET; gap: 0 min
- attention at qualification: 92.30
- core at qualification: 0.923 (raw 0.923); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 5.04/0.890; displacement 4.03/0.957; idiosyncrasy 7.40/0.982
- freshness at qualification: Developing; ATR travelled: 0.37
- nearest reference at qualification: SWING_HIGH 28.68 (0.29 ATR)
- badges: ok; SIP; 2.1 ATR from VWAP; 10 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 11:00 ET - NOW_IN_PLAY - COIN

- episodeId: `a3:COIN:1760108340000`
- qualified: 11:00 ET; emitted: 11:00 ET; gap: 0 min
- attention at qualification: 90.51
- core at qualification: 0.905 (raw 0.905); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 4.34/0.826; displacement 5.36/0.991; idiosyncrasy 8.00/0.989
- freshness at qualification: Developing; ATR travelled: 0.66
- nearest reference at qualification: LOD 374.16 (0.53 ATR)
- badges: ok; SIP; 4.0 ATR from VWAP; 5 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 11:01 ET - NOW_IN_PLAY - AMD

- episodeId: `a3:AMD:1760108280000`
- qualified: 11:01 ET; emitted: 11:01 ET; gap: 0 min
- attention at qualification: 80.07
- core at qualification: 0.801 (raw 0.801); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 3.24/0.672; displacement 3.98/0.954; idiosyncrasy 8.00/0.989
- freshness at qualification: Extended; ATR travelled: 1.78
- **EXTENDED — do not chase**; ATR travelled since episode start: 1.78
- nearest reference at qualification: LOD 221.45 (0.24 ATR)
- badges: ok; SIP; 4.4 ATR from VWAP; 7 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 11:01 ET - NOW_IN_PLAY - USO

- episodeId: `a3:USO:1760108400000`
- qualified: 11:01 ET; emitted: 11:01 ET; gap: 0 min
- attention at qualification: 90.26
- core at qualification: 0.903 (raw 0.903); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 7.70/0.984; displacement 2.81/0.828; idiosyncrasy 4.50/0.831
- freshness at qualification: Mature; ATR travelled: 1.32
- nearest reference at qualification: ORL 70.63 (0.09 ATR)
- badges: ok; SIP; 1.5 ATR from VWAP; 11 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 11:02 ET - NOW_IN_PLAY - META

- episodeId: `a3:META:1760108340000`
- qualified: 11:02 ET; emitted: 11:02 ET; gap: 0 min
- attention at qualification: 93.41
- core at qualification: 0.934 (raw 0.934); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 4.89/0.879; displacement 5.50/0.993; idiosyncrasy 6.27/0.955
- freshness at qualification: Extended; ATR travelled: 3.60
- **EXTENDED — do not chase**; ATR travelled since episode start: 3.60
- nearest reference at qualification: LOD 718.83 (0.16 ATR)
- badges: ok; SIP; 4.7 ATR from VWAP; 11 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 11:02 ET - NOW_IN_PLAY - TSLA

- episodeId: `a3:TSLA:1760108340000`
- qualified: 11:02 ET; emitted: 11:02 ET; gap: 0 min
- attention at qualification: 90.13
- core at qualification: 0.901 (raw 0.901); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 4.49/0.842; displacement 4.20/0.964; idiosyncrasy 5.02/0.883
- freshness at qualification: Extended; ATR travelled: 3.06
- **EXTENDED — do not chase**; ATR travelled since episode start: 3.06
- nearest reference at qualification: LOD 428.15 (0.13 ATR)
- badges: ok; SIP; 3.7 ATR from VWAP; 112 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 11:02 ET - NOW_IN_PLAY - NVDA

- episodeId: `a3:NVDA:1760108340000`
- qualified: 11:02 ET; emitted: 11:02 ET; gap: 0 min
- attention at qualification: 96.47
- core at qualification: 0.965 (raw 0.965); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 5.96/0.943; displacement 5.03/0.987; idiosyncrasy 8.00/0.989
- freshness at qualification: Extended; ATR travelled: 2.60
- **EXTENDED — do not chase**; ATR travelled since episode start: 2.60
- nearest reference at qualification: ORL 192.21 (0.13 ATR)
- badges: ok; SIP; 2.1 ATR from VWAP; 28 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 11:02 ET - NOW_IN_PLAY - AVGO

- episodeId: `a3:AVGO:1760108340000`
- qualified: 11:02 ET; emitted: 11:02 ET; gap: 0 min
- attention at qualification: 95.43
- core at qualification: 0.954 (raw 0.954); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 6.06/0.947; displacement 4.14/0.962; idiosyncrasy 8.00/0.989
- freshness at qualification: Extended; ATR travelled: 2.68
- **EXTENDED — do not chase**; ATR travelled since episode start: 2.68
- nearest reference at qualification: LOD 339.20 (0.27 ATR)
- badges: ok; SIP; 3.2 ATR from VWAP; 8 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 11:02 ET - NOW_IN_PLAY - ARM

- episodeId: `a3:ARM:1760108340000`
- qualified: 11:02 ET; emitted: 11:02 ET; gap: 0 min
- attention at qualification: 85.39
- core at qualification: 0.854 (raw 0.854); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 3.66/0.740; displacement 4.95/0.986; idiosyncrasy 8.00/0.989
- freshness at qualification: Extended; ATR travelled: 3.45
- **EXTENDED — do not chase**; ATR travelled since episode start: 3.45
- nearest reference at qualification: LOD 162.25 (0.21 ATR)
- badges: ok; SIP; 4.8 ATR from VWAP; 6 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 11:02 ET - NOW_IN_PLAY - NKE

- episodeId: `a3:NKE:1760108340000`
- qualified: 11:02 ET; emitted: 11:02 ET; gap: 0 min
- attention at qualification: 89.09
- core at qualification: 0.891 (raw 0.891); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 4.25/0.816; displacement 4.42/0.973; idiosyncrasy 8.00/0.989
- freshness at qualification: Extended; ATR travelled: 3.83
- **EXTENDED — do not chase**; ATR travelled since episode start: 3.83
- nearest reference at qualification: LOD 66.34 (0.30 ATR)
- badges: ok; SIP; 5.1 ATR from VWAP; 8 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 11:04 ET - KEY_LEVEL_EVENT - AVGO

- episodeId: `a3:AVGO:1760108340000`
- qualified: 11:04 ET; emitted: 11:04 ET; gap: 0 min
- attention at qualification: 69.23
- core at qualification: 0.692 (raw 0.692); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 2.46/0.531; displacement 3.34/0.903; idiosyncrasy 8.00/0.989
- freshness at qualification: Mature; ATR travelled: 2.60
- nearest reference at qualification: SWING_LOW 340.50 (0.32 ATR)
- badges: ok; SIP; 3.0 ATR from VWAP; 10 expansion bars
- key level: break SWING_LOW (0.32 ATR)
- **NOT AN ENTRY — open the chart.**

#### 11:05 ET - KEY_LEVEL_EVENT - AVGO

- episodeId: `a3:AVGO:1760108340000`
- qualified: 11:05 ET; emitted: 11:05 ET; gap: 0 min
- attention at qualification: 50.50
- core at qualification: 0.505 (raw 0.505); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 1.42/0.338; displacement 2.45/0.755; idiosyncrasy 4.48/0.828
- freshness at qualification: Mature; ATR travelled: 2.19
- nearest reference at qualification: SWING_LOW 340.50 (0.11 ATR)
- badges: ok; SIP; 2.6 ATR from VWAP; 11 expansion bars
- key level: retest SWING_LOW (0.11 ATR)
- **NOT AN ENTRY — open the chart.**

#### 11:05 ET - KEY_LEVEL_EVENT - DELL

- episodeId: `a3:DELL:1760108340000`
- qualified: 11:05 ET; emitted: 11:05 ET; gap: 0 min
- attention at qualification: 60.21
- core at qualification: 0.602 (raw 0.602); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 3.52/0.717; displacement 1.57/0.506; idiosyncrasy 4.26/0.801
- freshness at qualification: Mature; ATR travelled: 1.91
- nearest reference at qualification: SWING_LOW 155.10 (0.01 ATR)
- badges: ok; SIP; 1.8 ATR from VWAP; 12 expansion bars
- key level: approach SWING_LOW (0.01 ATR)
- **NOT AN ENTRY — open the chart.**

#### 11:06 ET - KEY_LEVEL_EVENT - AVGO

- episodeId: `a3:AVGO:1760108340000`
- qualified: 11:06 ET; emitted: 11:06 ET; gap: 0 min
- attention at qualification: 31.15
- core at qualification: 0.348 (raw 0.348); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 1.12/0.288; displacement 1.29/0.420; idiosyncrasy 0.59/0.161
- freshness at qualification: Mature; ATR travelled: 1.51
- nearest reference at qualification: ORL 342.90 (0.42 ATR)
- badges: ok; SIP; 1.9 ATR from VWAP; 12 expansion bars
- key level: failed_break SWING_LOW (0.67 ATR)
- **NOT AN ENTRY — open the chart.**

#### 11:08 ET - KEY_LEVEL_EVENT - AVGO

- episodeId: `a3:AVGO:1760108340000`
- qualified: 11:08 ET; emitted: 11:08 ET; gap: 0 min
- attention at qualification: 39.22
- core at qualification: 0.433 (raw 0.433); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 2.17/0.476; displacement 1.20/0.394; idiosyncrasy 0.84/0.192
- freshness at qualification: Mature; ATR travelled: 2.15
- nearest reference at qualification: SWING_LOW 340.50 (0.04 ATR)
- badges: ok; SIP; 2.5 ATR from VWAP; 14 expansion bars
- key level: approach SWING_LOW (0.04 ATR)
- **NOT AN ENTRY — open the chart.**

#### 11:09 ET - KEY_LEVEL_EVENT - CRWV

- episodeId: `a3:CRWV:1760108340000`
- qualified: 11:09 ET; emitted: 11:09 ET; gap: 0 min
- attention at qualification: 22.56
- core at qualification: 0.264 (raw 0.264); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 2.14/0.469; displacement 0.15/0.149; idiosyncrasy -0.36/0.080
- freshness at qualification: Mature; ATR travelled: 0.66
- nearest reference at qualification: SWING_LOW 143.97 (0.01 ATR)
- badges: ok; SIP; 2.1 ATR from VWAP; 20 expansion bars
- key level: approach SWING_HIGH (0.09 ATR)
- **NOT AN ENTRY — open the chart.**

#### 11:10 ET - KEY_LEVEL_EVENT - DELL

- episodeId: `a3:DELL:1760108340000`
- qualified: 11:10 ET; emitted: 11:10 ET; gap: 0 min
- attention at qualification: 19.23
- core at qualification: 0.205 (raw 0.205); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 2.35/0.510; displacement -0.38/0.083; idiosyncrasy 1.56/0.301
- freshness at qualification: Mature; ATR travelled: 1.21
- nearest reference at qualification: SWING_LOW 155.93 (0.04 ATR)
- badges: ok; SIP; 1.1 ATR from VWAP; 17 expansion bars
- key level: approach SWING_LOW (0.04 ATR)
- **NOT AN ENTRY — open the chart.**

#### 11:11 ET - KEY_LEVEL_EVENT - AVGO

- episodeId: `a3:AVGO:1760108340000`
- qualified: 11:11 ET; emitted: 11:11 ET; gap: 0 min
- attention at qualification: 18.21
- core at qualification: 0.190 (raw 0.190); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 0.79/0.239; displacement 0.17/0.151; idiosyncrasy 2.03/0.388
- freshness at qualification: Mature; ATR travelled: 2.02
- nearest reference at qualification: SWING_LOW 340.50 (0.17 ATR)
- badges: ok; SIP; 2.3 ATR from VWAP; 17 expansion bars
- key level: rejection SWING_LOW (0.17 ATR)
- **NOT AN ENTRY — open the chart.**

#### 11:12 ET - KEY_LEVEL_EVENT - DELL

- episodeId: `a3:DELL:1760108340000`
- qualified: 11:12 ET; emitted: 11:12 ET; gap: 0 min
- attention at qualification: 21.57
- core at qualification: 0.247 (raw 0.247); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 2.82/0.598; displacement -0.19/0.102; idiosyncrasy 0.05/0.110
- freshness at qualification: Mature; ATR travelled: 1.46
- nearest reference at qualification: SWING_LOW 155.10 (0.33 ATR)
- badges: ok; SIP; 1.3 ATR from VWAP; 19 expansion bars
- key level: reclaim SWING_LOW (0.33 ATR)
- **NOT AN ENTRY — open the chart.**

#### 11:13 ET - KEY_LEVEL_EVENT - MRVL

- episodeId: `a3:MRVL:1760108340000`
- qualified: 11:13 ET; emitted: 11:13 ET; gap: 0 min
- attention at qualification: 29.12
- core at qualification: 0.291 (raw 0.291); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 0.15/0.161; displacement 1.63/0.525; idiosyncrasy 6.43/0.961
- freshness at qualification: Mature; ATR travelled: 1.41
- nearest reference at qualification: SWING_LOW 91.11 (0.03 ATR)
- badges: ok; SIP; 2.3 ATR from VWAP; 20 expansion bars
- key level: approach SWING_LOW (0.03 ATR)
- **NOT AN ENTRY — open the chart.**

#### 11:15 ET - KEY_LEVEL_EVENT - MRVL

- episodeId: `a3:MRVL:1760108340000`
- qualified: 11:15 ET; emitted: 11:15 ET; gap: 0 min
- attention at qualification: 15.77
- core at qualification: 0.158 (raw 0.158); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 0.71/0.229; displacement -0.14/0.109; idiosyncrasy 5.34/0.908
- freshness at qualification: Mature; ATR travelled: 1.65
- nearest reference at qualification: SWING_LOW 91.09 (0.21 ATR)
- badges: ok; SIP; 2.6 ATR from VWAP; 22 expansion bars
- key level: rejection SWING_LOW (0.24 ATR)
- **NOT AN ENTRY — open the chart.**

#### 11:16 ET - KEY_LEVEL_EVENT - SOFI

- episodeId: `a3:SOFI:1760108340000`
- qualified: 11:16 ET; emitted: 11:16 ET; gap: 0 min
- attention at qualification: 27.17
- core at qualification: 0.275 (raw 0.275); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 2.49/0.537; displacement 0.10/0.141; idiosyncrasy 2.74/0.534
- freshness at qualification: Mature; ATR travelled: 0.80
- nearest reference at qualification: ORL 28.50 (0.12 ATR)
- badges: ok; SIP; 1.9 ATR from VWAP; 27 expansion bars
- key level: approach ORL (0.12 ATR)
- **NOT AN ENTRY — open the chart.**

#### 11:17 ET - KEY_LEVEL_EVENT - AVGO

- episodeId: `a3:AVGO:1760108340000`
- qualified: 11:17 ET; emitted: 11:17 ET; gap: 0 min
- attention at qualification: 42.01
- core at qualification: 0.420 (raw 0.420); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 1.99/0.441; displacement 1.23/0.400; idiosyncrasy 8.00/0.989
- freshness at qualification: Mature; ATR travelled: 2.95
- nearest reference at qualification: LOD 338.50 (0.02 ATR)
- badges: ok; SIP; 3.1 ATR from VWAP; 23 expansion bars
- key level: break PML (0.86 ATR)
- **NOT AN ENTRY — open the chart.**

#### 11:17 ET - KEY_LEVEL_EVENT - SOFI

- episodeId: `a3:SOFI:1760108340000`
- qualified: 11:17 ET; emitted: 11:17 ET; gap: 0 min
- attention at qualification: 25.71
- core at qualification: 0.257 (raw 0.257); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 1.50/0.351; displacement 0.38/0.188; idiosyncrasy 5.15/0.894
- freshness at qualification: Mature; ATR travelled: 0.93
- nearest reference at qualification: PML 28.41 (0.05 ATR)
- badges: ok; SIP; 2.0 ATR from VWAP; 28 expansion bars
- key level: approach PML (0.05 ATR)
- **NOT AN ENTRY — open the chart.**

#### 11:18 ET - ACCELERATION - AMZN

- episodeId: `a3:AMZN:1760108280000`
- qualified: 11:18 ET; emitted: 11:18 ET; gap: 0 min
- attention at qualification: 89.05
- core at qualification: 0.890 (raw 0.890); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 7.39/0.980; displacement 2.71/0.809; idiosyncrasy 8.00/0.989
- freshness at qualification: Mature; ATR travelled: 4.69
- nearest reference at qualification: SWING_LOW 222.34 (0.86 ATR)
- badges: ok; SIP; 4.1 ATR from VWAP; 25 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 11:18 ET - KEY_LEVEL_EVENT - SOFI

- episodeId: `a3:SOFI:1760108340000`
- qualified: 11:18 ET; emitted: 11:18 ET; gap: 0 min
- attention at qualification: 62.87
- core at qualification: 0.629 (raw 0.629); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 2.70/0.576; displacement 2.18/0.686; idiosyncrasy 6.88/0.972
- freshness at qualification: Mature; ATR travelled: 1.47
- nearest reference at qualification: LOD 28.12 (0.42 ATR)
- badges: ok; SIP; 2.5 ATR from VWAP; 29 expansion bars
- key level: rejection PML (0.53 ATR)
- **NOT AN ENTRY — open the chart.**

#### 11:31 ET - ACCELERATION - TSLA

- episodeId: `a3:TSLA:1760108340000`
- qualified: 11:31 ET; emitted: 11:31 ET; gap: 0 min
- attention at qualification: 88.37
- core at qualification: 0.884 (raw 0.884); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 6.16/0.950; displacement 2.78/0.822; idiosyncrasy 8.00/0.989
- freshness at qualification: Mature; ATR travelled: 4.68
- nearest reference at qualification: LOD 419.77 (0.16 ATR)
- badges: ok; SIP; 4.1 ATR from VWAP; 141 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 11:44 ET - KEY_LEVEL_EVENT - IWM

- episodeId: `a3:IWM:1760108280000`
- qualified: 11:44 ET; emitted: 11:44 ET; gap: 0 min
- attention at qualification: 68.28
- core at qualification: 0.785 (raw 0.785); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 4.44/0.837; displacement 2.37/0.736; idiosyncrasy 0.00/0.106
- freshness at qualification: Mature; ATR travelled: 2.33
- nearest reference at qualification: SWING_LOW 241.39 (0.29 ATR)
- badges: ok; SIP; 1.0 ATR from VWAP; 48 expansion bars
- key level: break SWING_LOW (0.29 ATR)
- **NOT AN ENTRY — open the chart.**

#### 11:45 ET - ACCELERATION - AVGO

- episodeId: `a3:AVGO:1760108340000`
- qualified: 11:45 ET; emitted: 11:45 ET; gap: 0 min
- attention at qualification: 68.40
- core at qualification: 0.684 (raw 0.684); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 2.69/0.574; displacement 2.74/0.815; idiosyncrasy 8.00/0.989
- freshness at qualification: Mature; ATR travelled: 2.83
- nearest reference at qualification: SWING_LOW 338.62 (0.57 ATR)
- badges: ok; SIP; 2.1 ATR from VWAP; 51 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 11:47 ET - KEY_LEVEL_EVENT - IWM

- episodeId: `a3:IWM:1760108280000`
- qualified: 11:47 ET; emitted: 11:47 ET; gap: 0 min
- attention at qualification: 34.34
- core at qualification: 0.395 (raw 0.395); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 4.41/0.834; displacement 0.37/0.187; idiosyncrasy 0.00/0.106
- freshness at qualification: Mature; ATR travelled: 2.48
- nearest reference at qualification: SWING_LOW 241.39 (0.06 ATR)
- badges: ok; SIP; 1.2 ATR from VWAP; 51 expansion bars
- key level: retest SWING_LOW (0.06 ATR)
- **NOT AN ENTRY — open the chart.**

#### 11:57 ET - KEY_LEVEL_EVENT - IWM

- episodeId: `a3:IWM:1760108280000`
- qualified: 11:57 ET; emitted: 11:57 ET; gap: 0 min
- attention at qualification: 43.74
- core at qualification: 0.503 (raw 0.503); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 4.35/0.828; displacement 0.89/0.306; idiosyncrasy 0.00/0.106
- freshness at qualification: Mature; ATR travelled: 2.61
- nearest reference at qualification: SWING_LOW 241.39 (0.20 ATR)
- badges: ok; SIP; 1.3 ATR from VWAP; 61 expansion bars
- key level: failed_break SWING_LOW (0.20 ATR)
- **NOT AN ENTRY — open the chart.**

#### 11:58 ET - KEY_LEVEL_EVENT - IWM

- episodeId: `a3:IWM:1760108280000`
- qualified: 11:58 ET; emitted: 11:58 ET; gap: 0 min
- attention at qualification: 24.34
- core at qualification: 0.280 (raw 0.280); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 3.86/0.767; displacement -0.19/0.102; idiosyncrasy 0.00/0.106
- freshness at qualification: Mature; ATR travelled: 2.35
- nearest reference at qualification: SWING_LOW 241.39 (0.07 ATR)
- badges: ok; SIP; 1.0 ATR from VWAP; 62 expansion bars
- key level: approach SWING_LOW (0.07 ATR)
- **NOT AN ENTRY — open the chart.**

#### 15:12 ET - NOW_IN_PLAY - AMD

- episodeId: `a3:AMD:1760123460000`
- qualified: 15:12 ET; emitted: 15:12 ET; gap: 0 min
- attention at qualification: 91.41
- core at qualification: 0.914 (raw 0.914); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 4.85/0.875; displacement 4.00/0.955; idiosyncrasy 8.00/0.989
- freshness at qualification: Mature; ATR travelled: 1.38
- nearest reference at qualification: SWING_LOW 217.62 (0.86 ATR)
- badges: ok; SIP; 5.1 ATR from VWAP; 73 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 15:19 ET - KEY_LEVEL_EVENT - AMD

- episodeId: `a3:AMD:1760123460000`
- qualified: 15:19 ET; emitted: 15:19 ET; gap: 0 min
- attention at qualification: 33.40
- core at qualification: 0.334 (raw 0.334); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 2.86/0.606; displacement 0.36/0.184; idiosyncrasy 3.20/0.627
- freshness at qualification: Mature; ATR travelled: 0.44
- nearest reference at qualification: SWING_LOW 217.62 (0.07 ATR)
- badges: ok; SIP; 4.0 ATR from VWAP; 80 expansion bars
- key level: approach SWING_LOW (0.07 ATR)
- **NOT AN ENTRY — open the chart.**

#### 15:21 ET - KEY_LEVEL_EVENT - AMD

- episodeId: `a3:AMD:1760123460000`
- qualified: 15:21 ET; emitted: 15:21 ET; gap: 0 min
- attention at qualification: 24.58
- core at qualification: 0.249 (raw 0.249); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 1.81/0.407; displacement 0.18/0.153; idiosyncrasy 2.66/0.518
- freshness at qualification: Mature; ATR travelled: 0.73
- nearest reference at qualification: SWING_LOW 217.62 (0.21 ATR)
- badges: ok; SIP; 4.4 ATR from VWAP; 82 expansion bars
- key level: rejection SWING_LOW (0.21 ATR)
- **NOT AN ENTRY — open the chart.**

#### 16:51 ET - NOW_IN_PLAY - NVDA

- episodeId: `a3:NVDA:1760129460000`
- qualified: 16:51 ET; emitted: 16:51 ET; gap: 0 min
- attention at qualification: 80.28
- core at qualification: 0.803 (raw 0.803); IN PLAY enter: 0.718
- calibration: sip x after_hours_core; `mode-map-v3:measure-v1:curve-v3:state-v3:sip:after_hours_core:population-82f216fdd69d`
- axes at qualification (input/normalized): participation 4.32/0.667; displacement 4.39/0.966; idiosyncrasy 8.00/0.956
- freshness at qualification: Developing; ATR travelled: 0.62
- nearest reference at qualification: SWING_LOW 182.05 (0.19 ATR)
- badges: ok; SIP; 8.3 ATR from VWAP; 2 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 16:52 ET - NOW_IN_PLAY - TSLA

- episodeId: `a3:TSLA:1760129460000`
- qualified: 16:52 ET; emitted: 16:52 ET; gap: 0 min
- attention at qualification: 87.97
- core at qualification: 0.880 (raw 0.880); IN PLAY enter: 0.718
- calibration: sip x after_hours_core; `mode-map-v3:measure-v1:curve-v3:state-v3:sip:after_hours_core:population-82f216fdd69d`
- axes at qualification (input/normalized): participation 5.87/0.846; displacement 3.57/0.915; idiosyncrasy 4.58/0.704
- freshness at qualification: Extended; ATR travelled: 1.90
- **EXTENDED — do not chase**; ATR travelled since episode start: 1.90
- nearest reference at qualification: LOD 409.00 (0.03 ATR)
- badges: ok; SIP; 12.5 ATR from VWAP; 3 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 16:53 ET - NOW_IN_PLAY - QQQ

- episodeId: `a3:QQQ:1760129460000`
- qualified: 16:53 ET; emitted: 16:53 ET; gap: 0 min
- attention at qualification: 74.13
- core at qualification: 0.853 (raw 0.853); IN PLAY enter: 0.718
- calibration: sip x after_hours_core; `mode-map-v3:measure-v1:curve-v3:state-v3:sip:after_hours_core:population-82f216fdd69d`
- axes at qualification (input/normalized): participation 4.91/0.746; displacement 4.63/0.974; idiosyncrasy 0.00/0.108
- freshness at qualification: Extended; ATR travelled: 1.34
- **EXTENDED — do not chase**; ATR travelled since episode start: 1.34
- nearest reference at qualification: LOD 584.88 (0.57 ATR)
- badges: ok; SIP; 12.6 ATR from VWAP; 4 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 16:55 ET - NOW_IN_PLAY - CRWV

- episodeId: `a3:CRWV:1760129460000`
- qualified: 16:55 ET; emitted: 16:55 ET; gap: 0 min
- attention at qualification: 85.51
- core at qualification: 0.855 (raw 0.855); IN PLAY enter: 0.718
- calibration: sip x after_hours_core; `mode-map-v3:measure-v1:curve-v3:state-v3:sip:after_hours_core:population-82f216fdd69d`
- axes at qualification (input/normalized): participation 4.92/0.747; displacement 4.80/0.979; idiosyncrasy 8.00/0.956
- freshness at qualification: Extended; ATR travelled: 3.52
- **EXTENDED — do not chase**; ATR travelled since episode start: 3.52
- nearest reference at qualification: SWING_LOW 137.04 (3.04 ATR)
- badges: ok; SIP; 13.6 ATR from VWAP; 7 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 17:00 ET - NOW_IN_PLAY - SOFI

- episodeId: `a3:SOFI:1760129520000`
- qualified: 17:00 ET; emitted: 17:00 ET; gap: 0 min
- attention at qualification: 96.56
- core at qualification: 0.966 (raw 0.966); IN PLAY enter: 0.718
- calibration: sip x after_hours_core; `mode-map-v3:measure-v1:curve-v3:state-v3:sip:after_hours_core:population-82f216fdd69d`
- axes at qualification (input/normalized): participation 7.47/0.939; displacement 5.70/0.992; idiosyncrasy 8.00/0.956
- freshness at qualification: Mature; ATR travelled: 3.86
- nearest reference at qualification: LOD 25.37 (0.71 ATR)
- badges: ok; SIP; 14.9 ATR from VWAP; 16 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 17:07 ET - NOW_IN_PLAY - AMZN

- episodeId: `a3:AMZN:1760129460000`
- qualified: 17:07 ET; emitted: 17:07 ET; gap: 0 min
- attention at qualification: 78.77
- core at qualification: 0.788 (raw 0.788); IN PLAY enter: 0.718
- calibration: sip x after_hours_core; `mode-map-v3:measure-v1:curve-v3:state-v3:sip:after_hours_core:population-82f216fdd69d`
- axes at qualification (input/normalized): participation 5.27/0.788; displacement 2.66/0.787; idiosyncrasy 8.00/0.956
- freshness at qualification: Mature; ATR travelled: 4.58
- nearest reference at qualification: LOD 212.84 (0.65 ATR)
- badges: ok; SIP; 12.9 ATR from VWAP; 18 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 17:17 ET - NOW_IN_PLAY - IBIT

- episodeId: `a3:IBIT:1760130540000`
- qualified: 17:17 ET; emitted: 17:17 ET; gap: 0 min
- attention at qualification: 86.09
- core at qualification: 0.861 (raw 0.861); IN PLAY enter: 0.718
- calibration: sip x after_hours_core; `mode-map-v3:measure-v1:curve-v3:state-v3:sip:after_hours_core:population-82f216fdd69d`
- axes at qualification (input/normalized): participation 6.81/0.910; displacement 2.81/0.815; idiosyncrasy 8.00/0.956
- freshness at qualification: Extended; ATR travelled: 4.80
- **EXTENDED — do not chase**; ATR travelled since episode start: 4.80
- nearest reference at qualification: LOD 62.00 (0.11 ATR)
- badges: ok; SIP; 8.3 ATR from VWAP; 31 expansion bars
- **NOT AN ENTRY — open the chart.**

### Suppression log

| Time ET | Symbol | Event | Reason | Disposition | Identity |
|---|---|---|---|---|---|
| 10:58 | SPY | ACCELERATION | redundant_with_entry | discard_duplicate | `ACCELERATION|a3:SPY:1760108280000|1955675` |
| 10:58 | QQQ | ACCELERATION | redundant_with_entry | discard_duplicate | `ACCELERATION|a3:QQQ:1760108280000|1955675` |
| 10:58 | IWM | ACCELERATION | redundant_with_entry | discard_duplicate | `ACCELERATION|a3:IWM:1760108280000|1955675` |
| 10:59 | AMZN | ACCELERATION | redundant_with_entry | discard_duplicate | `ACCELERATION|a3:AMZN:1760108280000|1955675` |
| 10:59 | CRWV | ACCELERATION | redundant_with_entry | discard_duplicate | `ACCELERATION|a3:CRWV:1760108340000|1955675` |
| 10:59 | IBIT | ACCELERATION | redundant_with_entry | discard_duplicate | `ACCELERATION|a3:IBIT:1760108280000|1955675` |
| 11:02 | NVDA | ACCELERATION | redundant_with_entry | discard_duplicate | `ACCELERATION|a3:NVDA:1760108340000|1955676` |
| 11:02 | QCOM | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:QCOM:1760108340000|1955676` |
| 11:06 | COIN | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:COIN:1760108340000|1955676` |
| 11:09 | IWM | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:IWM:1760108280000|1955676` |
| 11:12 | AVGO | KEY_LEVEL_EVENT | same_level_state | discard_duplicate | `KEY_LEVEL_EVENT|a3:AVGO:1760108340000|2025-10-10:SWING_LOW:1760087400000:340.500000|approach` |
| 11:13 | AMZN | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:AMZN:1760108280000|1955676` |
| 11:13 | AVGO | KEY_LEVEL_EVENT | same_level_state | discard_duplicate | `KEY_LEVEL_EVENT|a3:AVGO:1760108340000|2025-10-10:SWING_LOW:1760087400000:340.500000|rejection` |
| 11:14 | DELL | KEY_LEVEL_EVENT | same_level_state | discard_duplicate | `KEY_LEVEL_EVENT|a3:DELL:1760108340000|2025-10-10:SWING_LOW:1760094300000:155.100000|approach` |
| 11:15 | USO | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:USO:1760108400000|1955677` |
| 11:16 | TSLA | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:TSLA:1760108340000|1955677` |
| 11:16 | AVGO | KEY_LEVEL_EVENT | same_level_state | discard_duplicate | `KEY_LEVEL_EVENT|a3:AVGO:1760108340000|2025-10-10:SWING_LOW:1760087400000:340.500000|break` |
| 11:16 | DELL | KEY_LEVEL_EVENT | same_level_state | discard_duplicate | `KEY_LEVEL_EVENT|a3:DELL:1760108340000|2025-10-10:SWING_LOW:1760094300000:155.100000|reclaim` |
| 11:17 | AMZN | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:AMZN:1760108280000|1955677` |
| 11:18 | SPY | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:SPY:1760108280000|1955677` |
| 11:18 | QQQ | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:QQQ:1760108280000|1955677` |
| 11:18 | TSLA | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:TSLA:1760108340000|1955677` |
| 11:18 | AVGO | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:AVGO:1760108340000|1955677` |
| 11:18 | QCOM | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:QCOM:1760108340000|1955677` |
| 11:18 | MRVL | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:MRVL:1760108340000|1955677` |
| 11:18 | TSM | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:TSM:1760108340000|1955677` |
| 11:18 | SOFI | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:SOFI:1760108340000|1955677` |
| 11:19 | ARM | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:ARM:1760108340000|1955677` |
| 11:21 | AMD | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:AMD:1760108280000|1955677` |
| 11:21 | ARM | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:ARM:1760108340000|1955677` |
| 11:24 | QQQ | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:QQQ:1760108280000|1955677` |
| 11:24 | IWM | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:IWM:1760108280000|1955677` |
| 11:24 | AMZN | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:AMZN:1760108280000|1955677` |
| 11:24 | TSLA | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:TSLA:1760108340000|1955677` |
| 11:24 | NVDA | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:NVDA:1760108340000|1955677` |
| 11:24 | QCOM | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:QCOM:1760108340000|1955677` |
| 11:30 | SPY | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:SPY:1760108280000|1955678` |
| 11:30 | TSLA | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:TSLA:1760108340000|1955678` |
| 11:30 | AVGO | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:AVGO:1760108340000|1955678` |
| 11:30 | ARM | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:ARM:1760108340000|1955678` |
| 11:30 | SMH | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:SMH:1760108280000|1955678` |
| 11:31 | NVDA | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:NVDA:1760108340000|1955678` |
| 11:31 | MRVL | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:MRVL:1760108340000|1955678` |
| 11:32 | ARM | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:ARM:1760108340000|1955678` |
| 11:33 | COIN | NOW_IN_PLAY | episode_already_alerted | discard_duplicate | `NOW_IN_PLAY|a3:COIN:1760108340000` |
| 11:37 | AMZN | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:AMZN:1760108280000|1955678` |
| 11:37 | AMD | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:AMD:1760108280000|1955678` |
| 11:40 | SPY | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:SPY:1760108280000|1955678` |
| 11:40 | QQQ | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:QQQ:1760108280000|1955678` |
| 11:43 | QQQ | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:QQQ:1760108280000|1955678` |
| 11:43 | TSLA | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:TSLA:1760108340000|1955678` |
| 11:43 | NVDA | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:NVDA:1760108340000|1955678` |
| 11:43 | COIN | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:COIN:1760108340000|1955678` |
| 11:44 | AMD | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:AMD:1760108280000|1955678` |
| 11:44 | AVGO | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:AVGO:1760108340000|1955678` |
| 11:44 | ARM | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:ARM:1760108340000|1955678` |
| 11:44 | SMH | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:SMH:1760108280000|1955678` |
| 11:48 | IWM | KEY_LEVEL_EVENT | same_level_state | discard_duplicate | `KEY_LEVEL_EVENT|a3:IWM:1760108280000|2025-10-10:SWING_LOW:1760109000000:241.390000|retest` |
| 11:51 | TSLA | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:TSLA:1760108340000|1955679` |
| 11:55 | IWM | KEY_LEVEL_EVENT | same_level_state | discard_duplicate | `KEY_LEVEL_EVENT|a3:IWM:1760108280000|2025-10-10:SWING_LOW:1760109000000:241.390000|retest` |
| 11:56 | AMD | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:AMD:1760108280000|1955679` |
| 11:57 | COIN | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:COIN:1760108340000|1955679` |
| 15:19 | AMD | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:AMD:1760123460000|1955693` |
| 15:25 | AMD | KEY_LEVEL_EVENT | same_level_state | discard_duplicate | `KEY_LEVEL_EVENT|a3:AMD:1760123460000|2025-10-10:SWING_LOW:1760115600000:217.620000|approach` |
| 15:26 | AMD | KEY_LEVEL_EVENT | same_level_state | discard_duplicate | `KEY_LEVEL_EVENT|a3:AMD:1760123460000|2025-10-10:SWING_LOW:1760115600000:217.620000|rejection` |
| 16:51 | NVDA | ACCELERATION | redundant_with_entry | discard_duplicate | `ACCELERATION|a3:NVDA:1760129460000|1955699` |
| 16:54 | NVDA | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:NVDA:1760129460000|1955699` |
| 16:57 | QQQ | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:QQQ:1760129460000|1955699` |

## 2025-11-04 - chopping

Split: train. Detected/stored alerts: 16. Delivered envelopes: 10. Collapsed detections: 10. Suppressions: 9.

### Delivery compaction

- 10:47 ET: 3 secondary attention events in the last 15 min: KEY_LEVEL_EVENT LLY, KEY_LEVEL_EVENT LLY, KEY_LEVEL_EVENT LLY ([full list](/attention?view=in-play))
- 14:03 ET: 3 secondary attention events in the last 15 min: KEY_LEVEL_EVENT BE, KEY_LEVEL_EVENT BE, KEY_LEVEL_EVENT BE ([full list](/attention?view=in-play))
- 16:20 ET: 3 secondary attention events in the last 15 min: KEY_LEVEL_EVENT AMD, KEY_LEVEL_EVENT AMD, KEY_LEVEL_EVENT AMD ([full list](/attention?view=in-play))
- 16:47 ET: 1 secondary attention event in the last 15 min: KEY_LEVEL_EVENT AMD ([full list](/attention?view=in-play))
### Stored detections

#### 10:28 ET - NOW_IN_PLAY - LLY

- episodeId: `a3:LLY:1762269660000`
- qualified: 10:28 ET; emitted: 10:28 ET; gap: 0 min
- attention at qualification: 94.66
- core at qualification: 0.947 (raw 0.947); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 5.56/0.924; displacement 4.34/0.970; idiosyncrasy 8.00/0.989
- freshness at qualification: Extended; ATR travelled: 2.90
- **EXTENDED — do not chase**; ATR travelled since episode start: 2.90
- nearest reference at qualification: HOD 910.08 (0.13 ATR)
- badges: ok; SIP; 2.9 ATR from VWAP; 12 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 10:47 ET - KEY_LEVEL_EVENT - LLY

- episodeId: `a3:LLY:1762269660000`
- qualified: 10:47 ET; emitted: 10:47 ET; gap: 0 min
- attention at qualification: 85.80
- core at qualification: 0.858 (raw 0.858); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 4.09/0.798; displacement 3.54/0.923; idiosyncrasy 6.93/0.973
- freshness at qualification: Mature; ATR travelled: 0.23
- nearest reference at qualification: PMH 896.53 (0.22 ATR)
- badges: ok; SIP; 0.6 ATR from VWAP; 31 expansion bars
- key level: break PMH (0.22 ATR)
- **NOT AN ENTRY — open the chart.**

#### 10:48 ET - KEY_LEVEL_EVENT - LLY

- episodeId: `a3:LLY:1762269660000`
- qualified: 10:48 ET; emitted: 10:48 ET; gap: 0 min
- attention at qualification: 44.17
- core at qualification: 0.442 (raw 0.442); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 1.48/0.348; displacement 1.74/0.560; idiosyncrasy 4.46/0.826
- freshness at qualification: Mature; ATR travelled: 0.39
- nearest reference at qualification: PMH 896.53 (0.06 ATR)
- badges: ok; SIP; 0.4 ATR from VWAP; 32 expansion bars
- key level: retest PMH (0.06 ATR)
- **NOT AN ENTRY — open the chart.**

#### 10:53 ET - KEY_LEVEL_EVENT - LLY

- episodeId: `a3:LLY:1762269660000`
- qualified: 10:53 ET; emitted: 10:53 ET; gap: 0 min
- attention at qualification: 22.91
- core at qualification: 0.229 (raw 0.229); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 1.33/0.323; displacement 0.24/0.163; idiosyncrasy 3.37/0.658
- freshness at qualification: Mature; ATR travelled: 0.74
- nearest reference at qualification: VWAP 898.76 (0.08 ATR)
- badges: ok; SIP; 0.1 ATR from VWAP; 4 expansion bars
- key level: failed_break PMH (0.27 ATR)
- **NOT AN ENTRY — open the chart.**

#### 14:00 ET - NOW_IN_PLAY - BE

- episodeId: `a3:BE:1762282740000`
- qualified: 14:00 ET; emitted: 14:00 ET; gap: 0 min
- attention at qualification: 82.49
- core at qualification: 0.825 (raw 0.825); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 3.40/0.698; displacement 4.46/0.974; idiosyncrasy 7.04/0.976
- freshness at qualification: Extended; ATR travelled: 1.44
- **EXTENDED — do not chase**; ATR travelled since episode start: 1.44
- nearest reference at qualification: PML 132.00 (0.14 ATR)
- badges: ok; SIP; 2.7 ATR from VWAP; 3 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 14:03 ET - KEY_LEVEL_EVENT - BE

- episodeId: `a3:BE:1762282740000`
- qualified: 14:03 ET; emitted: 14:03 ET; gap: 0 min
- attention at qualification: 58.66
- core at qualification: 0.587 (raw 0.587); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 1.90/0.425; displacement 2.71/0.810; idiosyncrasy 5.78/0.934
- freshness at qualification: Mature; ATR travelled: 1.65
- nearest reference at qualification: PML 132.00 (0.13 ATR)
- badges: ok; SIP; 2.9 ATR from VWAP; 6 expansion bars
- key level: approach PML (0.13 ATR)
- **NOT AN ENTRY — open the chart.**

#### 14:05 ET - KEY_LEVEL_EVENT - BE

- episodeId: `a3:BE:1762282740000`
- qualified: 14:05 ET; emitted: 14:05 ET; gap: 0 min
- attention at qualification: 26.18
- core at qualification: 0.296 (raw 0.296); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 0.26/0.174; displacement 1.56/0.503; idiosyncrasy 0.36/0.137
- freshness at qualification: Mature; ATR travelled: 1.78
- nearest reference at qualification: PML 132.00 (0.17 ATR)
- badges: ok; SIP; 3.0 ATR from VWAP; 8 expansion bars
- key level: rejection PML (0.17 ATR)
- **NOT AN ENTRY — open the chart.**

#### 14:07 ET - KEY_LEVEL_EVENT - BE

- episodeId: `a3:BE:1762282740000`
- qualified: 14:07 ET; emitted: 14:07 ET; gap: 0 min
- attention at qualification: 47.28
- core at qualification: 0.473 (raw 0.473); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 3.28/0.680; displacement 0.98/0.329; idiosyncrasy 3.65/0.708
- freshness at qualification: Mature; ATR travelled: 0.96
- nearest reference at qualification: SWING_LOW 133.25 (0.43 ATR)
- badges: ok; SIP; 2.1 ATR from VWAP; 10 expansion bars
- key level: reclaim PML (0.51 ATR)
- **NOT AN ENTRY — open the chart.**

#### 14:59 ET - NOW_IN_PLAY - ORCL

- episodeId: `a3:ORCL:1762286340000`
- qualified: 14:59 ET; emitted: 14:59 ET; gap: 0 min
- attention at qualification: 80.10
- core at qualification: 0.801 (raw 0.801); IN PLAY enter: 0.800
- calibration: sip x regular; `mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210:exit-0.66-15`
- axes at qualification (input/normalized): participation 3.48/0.712; displacement 3.32/0.901; idiosyncrasy 8.00/0.989
- freshness at qualification: Developing; ATR travelled: 0.61
- nearest reference at qualification: LOD 245.19 (0.78 ATR)
- badges: ok; SIP; 5.7 ATR from VWAP; 31 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 16:08 ET - NOW_IN_PLAY - SMCI

- episodeId: `a3:SMCI:1762290360000`
- qualified: 16:08 ET; emitted: 16:08 ET; gap: 0 min
- attention at qualification: 89.43
- core at qualification: 0.894 (raw 0.894); IN PLAY enter: 0.718
- calibration: sip x after_hours_core; `mode-map-v3:measure-v1:curve-v3:state-v3:sip:after_hours_core:population-82f216fdd69d`
- axes at qualification (input/normalized): participation 6.11/0.865; displacement 3.68/0.925; idiosyncrasy 8.00/0.956
- freshness at qualification: Extended; ATR travelled: 5.11
- **EXTENDED — do not chase**; ATR travelled since episode start: 5.11
- nearest reference at qualification: LOD 42.00 (1.04 ATR)
- badges: ok; SIP; 5.3 ATR from VWAP; 71 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 16:16 ET - NOW_IN_PLAY - AMD

- episodeId: `a3:AMD:1762290960000`
- qualified: 16:16 ET; emitted: 16:16 ET; gap: 0 min
- attention at qualification: 75.30
- core at qualification: 0.753 (raw 0.753); IN PLAY enter: 0.718
- calibration: sip x after_hours_core; `mode-map-v3:measure-v1:curve-v3:state-v3:sip:after_hours_core:population-82f216fdd69d`
- axes at qualification (input/normalized): participation 4.03/0.624; displacement 3.51/0.909; idiosyncrasy 8.00/0.956
- freshness at qualification: Mature; ATR travelled: 2.12
- nearest reference at qualification: PML 249.80 (0.59 ATR)
- badges: ok; SIP; 2.1 ATR from VWAP; 42 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 16:20 ET - KEY_LEVEL_EVENT - AMD

- episodeId: `a3:AMD:1762290960000`
- qualified: 16:20 ET; emitted: 16:20 ET; gap: 0 min
- attention at qualification: 50.84
- core at qualification: 0.508 (raw 0.508); IN PLAY enter: 0.718
- calibration: sip x after_hours_core; `mode-map-v3:measure-v1:curve-v3:state-v3:sip:after_hours_core:population-82f216fdd69d`
- axes at qualification (input/normalized): participation 1.81/0.282; displacement 3.60/0.918; idiosyncrasy 8.00/0.956
- freshness at qualification: Mature; ATR travelled: 0.91
- nearest reference at qualification: SWING_HIGH 250.93 (0.04 ATR)
- badges: ok; SIP; 0.9 ATR from VWAP; 46 expansion bars
- key level: approach SWING_HIGH (0.04 ATR)
- **NOT AN ENTRY — open the chart.**

#### 16:21 ET - KEY_LEVEL_EVENT - AMD

- episodeId: `a3:AMD:1762290960000`
- qualified: 16:21 ET; emitted: 16:21 ET; gap: 0 min
- attention at qualification: 83.12
- core at qualification: 0.831 (raw 0.831); IN PLAY enter: 0.718
- calibration: sip x after_hours_core; `mode-map-v3:measure-v1:curve-v3:state-v3:sip:after_hours_core:population-82f216fdd69d`
- axes at qualification (input/normalized): participation 5.44/0.806; displacement 3.07/0.857; idiosyncrasy 8.00/0.956
- freshness at qualification: Mature; ATR travelled: 1.23
- nearest reference at qualification: PML 249.80 (0.11 ATR)
- badges: ok; SIP; 1.2 ATR from VWAP; 47 expansion bars
- key level: approach PML (0.11 ATR)
- **NOT AN ENTRY — open the chart.**

#### 16:23 ET - KEY_LEVEL_EVENT - AMD

- episodeId: `a3:AMD:1762290960000`
- qualified: 16:23 ET; emitted: 16:23 ET; gap: 0 min
- attention at qualification: 82.04
- core at qualification: 0.820 (raw 0.820); IN PLAY enter: 0.718
- calibration: sip x after_hours_core; `mode-map-v3:measure-v1:curve-v3:state-v3:sip:after_hours_core:population-82f216fdd69d`
- axes at qualification (input/normalized): participation 4.72/0.722; displacement 3.78/0.933; idiosyncrasy 8.00/0.956
- freshness at qualification: Mature; ATR travelled: 2.96
- nearest reference at qualification: SWING_LOW 247.00 (0.74 ATR)
- badges: ok; SIP; 2.9 ATR from VWAP; 49 expansion bars
- key level: rejection PML (1.79 ATR)
- **NOT AN ENTRY — open the chart.**

#### 16:46 ET - NOW_IN_PLAY - AMD

- episodeId: `a3:AMD:1762292460000`
- qualified: 16:46 ET; emitted: 16:46 ET; gap: 0 min
- attention at qualification: 73.30
- core at qualification: 0.733 (raw 0.733); IN PLAY enter: 0.718
- calibration: sip x after_hours_core; `mode-map-v3:measure-v1:curve-v3:state-v3:sip:after_hours_core:population-82f216fdd69d`
- axes at qualification (input/normalized): participation 4.02/0.622; displacement 3.12/0.864; idiosyncrasy 8.00/0.956
- freshness at qualification: Mature; ATR travelled: 1.40
- nearest reference at qualification: ORL 247.39 (0.10 ATR)
- badges: ok; SIP; 1.2 ATR from VWAP; 72 expansion bars
- **NOT AN ENTRY — open the chart.**

#### 16:47 ET - KEY_LEVEL_EVENT - AMD

- episodeId: `a3:AMD:1762292460000`
- qualified: 16:47 ET; emitted: 16:47 ET; gap: 0 min
- attention at qualification: 68.24
- core at qualification: 0.682 (raw 0.682); IN PLAY enter: 0.718
- calibration: sip x after_hours_core; `mode-map-v3:measure-v1:curve-v3:state-v3:sip:after_hours_core:population-82f216fdd69d`
- axes at qualification (input/normalized): participation 4.51/0.695; displacement 2.15/0.670; idiosyncrasy 8.00/0.956
- freshness at qualification: Mature; ATR travelled: 0.87
- nearest reference at qualification: PML 249.80 (0.05 ATR)
- badges: ok; SIP; 0.7 ATR from VWAP; 73 expansion bars
- key level: approach PML (0.05 ATR)
- **NOT AN ENTRY — open the chart.**

### Suppression log

| Time ET | Symbol | Event | Reason | Disposition | Identity |
|---|---|---|---|---|---|
| 10:41 | LLY | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:LLY:1762269660000|1958078` |
| 10:47 | LLY | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:LLY:1762269660000|1958079` |
| 14:06 | BE | KEY_LEVEL_EVENT | same_level_state | discard_duplicate | `KEY_LEVEL_EVENT|a3:BE:1762282740000|2025-11-04:PML:1762266540000:132.000000|approach` |
| 14:07 | BE | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:BE:1762282740000|1958092` |
| 14:14 | BE | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:BE:1762282740000|1958092` |
| 14:59 | ORCL | ACCELERATION | redundant_with_entry | discard_duplicate | `ACCELERATION|a3:ORCL:1762286340000|1958095` |
| 15:07 | ORCL | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:ORCL:1762286340000|1958096` |
| 16:16 | AMD | ACCELERATION | redundant_with_entry | discard_duplicate | `ACCELERATION|a3:AMD:1762290960000|1958101` |
| 16:27 | AMD | NOW_IN_PLAY | episode_already_alerted | discard_duplicate | `NOW_IN_PLAY|a3:AMD:1762290960000` |

## 2025-11-28 - quiet

Split: train. Detected/stored alerts: 0. Delivered envelopes: 0. Collapsed detections: 0. Suppressions: 72.

### Delivery compaction

No digest envelope required.

### Stored detections

None.

### Suppression log

| Time ET | Symbol | Event | Reason | Disposition | Identity |
|---|---|---|---|---|---|
| 12:51 | INTC | NOW_IN_PLAY | early_close_baseline_unavailable | dropped | `NOW_IN_PLAY|a3:INTC:1764352200000` |
| 12:59 | MSFT | NOW_IN_PLAY | early_close_baseline_unavailable | dropped | `NOW_IN_PLAY|a3:MSFT:1764352740000` |
| 12:59 | SMCI | NOW_IN_PLAY | early_close_baseline_unavailable | dropped | `NOW_IN_PLAY|a3:SMCI:1764352500000` |
| 12:59 | PANW | NOW_IN_PLAY | early_close_baseline_unavailable | dropped | `NOW_IN_PLAY|a3:PANW:1764352680000` |
| 12:59 | GDX | NOW_IN_PLAY | early_close_baseline_unavailable | dropped | `NOW_IN_PLAY|a3:GDX:1764352680000` |
| 12:59 | GDX | ACCELERATION | early_close_baseline_unavailable | dropped | `ACCELERATION|a3:GDX:1764352680000|1960391` |
| 13:00 | SPY | NOW_IN_PLAY | session_closed | dropped | `NOW_IN_PLAY|a3:SPY:1764352680000` |
| 13:00 | IWM | NOW_IN_PLAY | session_closed | dropped | `NOW_IN_PLAY|a3:IWM:1764352740000` |
| 13:00 | META | NOW_IN_PLAY | session_closed | dropped | `NOW_IN_PLAY|a3:META:1764352560000` |
| 13:00 | AVGO | NOW_IN_PLAY | session_closed | dropped | `NOW_IN_PLAY|a3:AVGO:1764352080000` |
| 13:00 | QCOM | NOW_IN_PLAY | session_closed | dropped | `NOW_IN_PLAY|a3:QCOM:1764352440000` |
| 13:00 | MRVL | NOW_IN_PLAY | session_closed | dropped | `NOW_IN_PLAY|a3:MRVL:1764352380000` |
| 13:00 | AMAT | NOW_IN_PLAY | session_closed | dropped | `NOW_IN_PLAY|a3:AMAT:1764352680000` |
| 13:00 | KLAC | NOW_IN_PLAY | session_closed | dropped | `NOW_IN_PLAY|a3:KLAC:1764352500000` |
| 13:00 | ARM | NOW_IN_PLAY | session_closed | dropped | `NOW_IN_PLAY|a3:ARM:1764352680000` |
| 13:00 | TSM | NOW_IN_PLAY | session_closed | dropped | `NOW_IN_PLAY|a3:TSM:1764352800000` |
| 13:00 | PLTR | NOW_IN_PLAY | session_closed | dropped | `NOW_IN_PLAY|a3:PLTR:1764352800000` |
| 13:00 | CRWD | NOW_IN_PLAY | session_closed | dropped | `NOW_IN_PLAY|a3:CRWD:1764352680000` |
| 13:00 | T | NOW_IN_PLAY | session_closed | dropped | `NOW_IN_PLAY|a3:T:1764352800000` |
| 13:01 | IWM | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:IWM:1764352740000|2025-11-28:SWING_HIGH:1764342000000:248.360000|approach` |
| 13:01 | MSFT | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:MSFT:1764352740000|2025-11-28:SWING_HIGH:1764348300000:492.050000|approach` |
| 13:02 | INTC | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:INTC:1764352200000|1960392` |
| 13:03 | MSFT | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:MSFT:1764352740000|2025-11-28:SWING_HIGH:1764348300000:492.050000|rejection` |
| 13:04 | MSFT | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:MSFT:1764352740000|2025-11-28:SWING_HIGH:1764348300000:492.050000|approach` |
| 13:05 | IWM | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:IWM:1764352740000|2025-11-28:SWING_HIGH:1764342000000:248.360000|rejection` |
| 13:05 | MSFT | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:MSFT:1764352740000|2025-11-28:SWING_HIGH:1764348300000:492.050000|rejection` |
| 13:06 | IWM | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:IWM:1764352740000|2025-11-28:SWING_HIGH:1764342000000:248.360000|approach` |
| 13:07 | AVGO | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:AVGO:1764352080000|1960392` |
| 13:07 | CRWD | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:CRWD:1764352680000|1960392` |
| 13:07 | GDX | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:GDX:1764352680000|1960392` |
| 13:08 | MSFT | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:MSFT:1764352740000|2025-11-28:SWING_HIGH:1764348300000:492.050000|approach` |
| 13:09 | MSFT | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:MSFT:1764352740000|2025-11-28:SWING_HIGH:1764348300000:492.050000|rejection` |
| 13:09 | PLTR | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:PLTR:1764352800000|1960392` |
| 13:10 | MSFT | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:MSFT:1764352740000|2025-11-28:SWING_HIGH:1764348300000:492.050000|approach` |
| 13:10 | TSM | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:TSM:1764352800000|2025-11-28:SWING_HIGH:1764339000000:291.740000|approach` |
| 13:11 | SPY | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:SPY:1764352680000|2025-11-28:SWING_HIGH:1764347100000:682.940000|approach` |
| 13:12 | TSM | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:TSM:1764352800000|2025-11-28:SWING_HIGH:1764337800000:291.494100|approach` |
| 13:13 | SPY | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:SPY:1764352680000|2025-11-28:SWING_HIGH:1764347100000:682.940000|rejection` |
| 13:13 | MSFT | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:MSFT:1764352740000|1960392` |
| 13:13 | SMCI | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:SMCI:1764352500000|1960392` |
| 13:13 | GDX | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:GDX:1764352680000|1960392` |
| 13:13 | GDX | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:GDX:1764352680000|2025-11-28:PMH:1764340140000:82.990000|break` |
| 13:14 | MSFT | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:MSFT:1764352740000|2025-11-28:SWING_HIGH:1764348300000:492.050000|reclaim` |
| 13:14 | MRVL | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:MRVL:1764352380000|1960392` |
| 13:15 | GDX | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:GDX:1764352680000|2025-11-28:PMH:1764340140000:82.990000|retest` |
| 13:16 | INTC | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:INTC:1764352200000|1960393` |
| 13:18 | GDX | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:GDX:1764352680000|1960393` |
| 13:27 | GDX | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:GDX:1764352680000|2025-11-28:SWING_HIGH:1764347100000:83.095000|approach` |
| 13:29 | GDX | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:GDX:1764352680000|2025-11-28:SWING_HIGH:1764347100000:83.095000|reclaim` |
| 13:35 | CRWD | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:CRWD:1764352680000|1960394` |
| 13:35 | GDX | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:GDX:1764352680000|2025-11-28:SWING_HIGH:1764347100000:83.095000|approach` |
| 13:36 | GDX | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:GDX:1764352680000|2025-11-28:SWING_HIGH:1764347100000:83.095000|reclaim` |
| 13:37 | TSM | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:TSM:1764352800000|2025-11-28:SWING_HIGH:1764337800000:291.494100|reclaim` |
| 13:37 | GDX | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:GDX:1764352680000|2025-11-28:SWING_HIGH:1764347100000:83.095000|approach` |
| 13:40 | TSM | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:TSM:1764352800000|2025-11-28:SWING_HIGH:1764337800000:291.494100|approach` |
| 13:40 | GDX | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:GDX:1764352680000|1960394` |
| 13:45 | TSM | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:TSM:1764352800000|2025-11-28:SWING_HIGH:1764337800000:291.494100|rejection` |
| 13:46 | TSM | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:TSM:1764352800000|2025-11-28:SWING_HIGH:1764337800000:291.494100|approach` |
| 13:54 | MRVL | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:MRVL:1764352380000|1960395` |
| 14:04 | GDX | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:GDX:1764352680000|1960396` |
| 14:11 | GDX | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:GDX:1764352680000|1960396` |
| 14:28 | CRWD | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:CRWD:1764352680000|1960397` |
| 14:28 | GDX | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:GDX:1764352680000|2025-11-28:SWING_HIGH:1764348300000:83.015000|approach` |
| 14:29 | GDX | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:GDX:1764352680000|2025-11-28:SWING_HIGH:1764348300000:83.015000|rejection` |
| 14:34 | GDX | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:GDX:1764352680000|2025-11-28:SWING_HIGH:1764348300000:83.015000|approach` |
| 14:39 | GDX | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:GDX:1764352680000|2025-11-28:SWING_HIGH:1764348300000:83.015000|rejection` |
| 14:57 | GDX | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:GDX:1764352680000|1960399` |
| 15:07 | GDX | ACCELERATION | insufficient_persistence | pending | `ACCELERATION|a3:GDX:1764352680000|1960400` |
| 15:39 | TSM | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:TSM:1764352800000|2025-11-28:SWING_HIGH:1764339000000:291.740000|rejection` |
| 15:54 | PANW | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:PANW:1764352680000|2025-11-28:SWING_HIGH:1764343500000:190.500000|approach` |
| 16:00 | MRVL | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:MRVL:1764352380000|2025-11-28:SWING_HIGH:1764349500000:89.141600|break` |
| 16:08 | TSM | KEY_LEVEL_EVENT | session_closed | dropped | `KEY_LEVEL_EVENT|a3:TSM:1764352800000|2025-11-28:SWING_HIGH:1764333300000:292.010000|break` |

## 2026-02-13 - chopping

Split: train. Detected/stored alerts: 1. Delivered envelopes: 1. Collapsed detections: 0. Suppressions: 0.

### Delivery compaction

No digest envelope required.

### Stored detections

#### 08:53 ET - NOW_IN_PLAY - AAPL

- episodeId: `a3:AAPL:1770990660000`
- qualified: 08:53 ET; emitted: 08:53 ET; gap: 0 min
- attention at qualification: 74.06
- core at qualification: 0.741 (raw 0.741); IN PLAY enter: 0.722
- calibration: sip x premarket_core; `mode-map-v3:measure-v1:curve-v3:state-v3:sip:premarket_core:population-82f216fdd69d`
- axes at qualification (input/normalized): participation 3.76/0.581; displacement 3.79/0.943; idiosyncrasy 8.00/0.973
- freshness at qualification: Extended; ATR travelled: 1.70
- **EXTENDED — do not chase**; ATR travelled since episode start: 1.70
- nearest reference at qualification: PMH 263.90 (0.16 ATR)
- badges: ok; SIP; 3.5 ATR from VWAP; 12 expansion bars
- **NOT AN ENTRY — open the chart.**

### Suppression log

None.

Artifact: `f43a42bc6f222e06496a44578e0de45704a0689432b91031211e58cce73919a3`. Ground truth: **REFUSED**.
