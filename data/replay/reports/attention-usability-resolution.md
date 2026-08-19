# Attention score and usability resolution

> Timing statistics derived from historical pulls assume instantaneous bar availability. Real arrival latency is not represented. Human-relative latency and move-capture figures are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.

> Population behavior only. No hit rate, discovery quality, latency, move capture, false-positive rate, or ground-truth conclusion is claimed.

## Current vs calibrated usability

> This usability refit applies to SIP regular only. IEX regular retains its earlier population calibration; no IEX usability conclusion is claimed.

| Version | Minutes with IN PLAY | Minutes with WAKING UP | IN PLAY occupancy median [IQR] | EMERGING occupancy median [IQR] | Gap median [IQR] | Full-session zero days |
|---|---:|---:|---:|---:|---:|---|
| Before | 2.91% (449/15420) | 0.00% | 3 [2–5], min 1, max 14 | 2 [2–3], min 1, max 10 | 31.5 [10.75–70.75], min 1, max 298 | 2026-02-13, 2026-04-20, 2026-05-06 |
| After | 21.63% (3336/15420) | 0.00% | 33 [30–45.5], min 1, max 129 | 30 [29–33.75], min 1, max 122 | 44 [17–110], min 1, max 288 | 2025-11-14, 2026-01-20, 2026-02-13, 2026-04-20, 2026-05-06 |

Selected SIP regular policy: enter 0.8, exit 0.7, exit persistence 30 minutes. Entry persistence remains 2 minutes.

## Score scale

The final score uses no clip. With influence 0.15, Idiosyncrasy applies a scale of 73.91%–100% (a 0–26.09% discount). Influence 0.075 would produce 86.05%–100% and remains unselected.
Five-session episode peaks before: 130/155 exact 100; after: 0/52. After range 74.1–98.4, 43 distinct one-decimal values.

## Within-minute IN PLAY score spread (minutes with >=2 names)

| Version | Minutes | Min score median [IQR] | Max score median [IQR] | Within-minute IQR median [IQR] | Distinct displayed median [IQR] | Fully tied minutes |
|---|---:|---:|---:|---:|---:|---:|
| Before | 104 | 95.85135265308347 [74.16121980773454–100], min 21.377954788505974, max 100 | 100 [100–100], min 57.66985457176795, max 100 | 1.1563299375114227 [0–5.289522144540236], min 0, max 24.808633586888064 | 3 [1–4], min 1, max 12 | 28 |
| After | 991 | 14.715785475672646 [9.641198462863565–24.51590970619039], min 1.71404360780478, max 87.26933753226677 | 44.73375154070151 [28.37419888975908–66.66234867812437], min 6.282176737712321, max 99.12220022197837 | 9.955789182876995 [5.249560676197329–16.537401051216264], min 0.018802371780255456, max 52.557943895914946 | 3 [2–8], min 1, max 28 | 1 |

The JSON companion contains every per-minute min, max, quartile, IQR, and exact/displayed distinct count.

The ordered list is now numerically real: zero multi-name minutes are tied at full precision and only one ties at the displayed tenth. The dwell gain is not free, however. Thirty-minute exit persistence retains some IN PLAY memberships after current attention decays; rows remain sorted by current score, pending-exit explanations stay visible, and the 12-row display cap keeps the low-score tail from crowding the screen.

## Lever isolation

| Scenario | Kind | Enter | Exit | Exit persistence | Train coverage | Train dwell median | Holdout coverage | Holdout dwell median |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| control | control | 0.7808 | 0.7658 | 2 | 3.37% | 3 | 3.06% | 2 |
| persistence-15 | exit_persistence_only | 0.7808 | 0.7658 | 15 | 13.53% | 16 | 16.37% | 15 |
| exit-0.70-p15 | combined_exit | 0.7808 | 0.7 | 15 | 14.69% | 17 | 16.82% | 16 |
| enter-0.80 | enter_threshold_only | 0.8 | 0.7658 | 2 | 2.70% | 3 | 2.20% | 2 |
| enter-0.80-exit-0.70-p25 | enter_plus_exit | 0.8 | 0.7 | 25 | 18.39% | 28 | 20.15% | 26 |
| enter-0.80-exit-0.70-p30 | enter_plus_exit | 0.8 | 0.7 | 30 | 21.01% | 33 | 23.06% | 31 |

Exit persistence alone increased dwell before any enter change. Exit-only policies could hit coverage/dwell, but the transformed 0.7808 entry boundary caused 2026-05-06 to cease being a mandated zero day. The entry boundary therefore changed only in the separately reported second stage. An initially selected 0.50 exit was rejected by full replay because it fell below EMERGING_exit and violated I3; ordered exit bands are now a hard calibration-store invariant.

## Trader-time interpretation

IN PLAY now remains visible long enough by the stated population targets: the median occupancy exceeds ten minutes and regular-session coverage is inside 20–40%, while the three quiet days remain zero. This is a usability statement, not evidence that the names were correct.
WAKING UP remains absent across the corpus. That is a failed-usability finding and was not tuned away without a declared target.

Deterministic replay: 94d92f144c650bc7cea370cd28039c79fc50d7746524cb3294cd77058a6870fd (reproduced). Artifact: dd68c6335cf7dfe8153c437ab28afa0e01deb6aaa026ae78a0097bece3e20749.
