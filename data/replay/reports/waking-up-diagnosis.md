# WAKING UP zero-coverage diagnosis

> Timing statistics derived from historical pulls assume instantaneous bar availability. Real arrival latency is not represented. Human-relative latency and move-capture figures are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.

> Diagnostic population evidence only. No discovery-quality, hit-rate, latency, move-capture, false-positive, or ground-truth conclusion is available. No gate or active calibration was changed.

## Finding

`freshness in {Fresh, Developing}` is the fatal gate: it passes 0 symbol-minutes in every viable feed/window, so every cumulative funnel is zero at its first stage. The corpus builder carries one session-cumulative `pullbackObserved` bit from 04:00 onward. It is true on 100% of SIP regular rows and 99.98% of IEX regular rows. Because any historical pullback forces Mature, every regular-session episode is born Mature or Extended.

The provisional 2.00 threshold is not active. Published velocity thresholds are 5.790-7.620 score points/minute for SIP and 10.416 for IEX regular. Velocity is not the zero-producing gate: SIP regular exceeds 2.00 on 26.43% of available symbol-minutes and its actual 7.620 threshold on 5.12%.

## Velocity definition and empirical distribution

`scoreDelta1m`, `scoreDelta3m`, and `scoreDelta5m` are attention-score point changes over their named windows. `rollingZDelta5m` is the five-minute change in the mean available axis z-composite. The decision velocity is score points per minute: `scoreDelta3m / 3`, falling back to the 1-minute delta and then `scoreDelta5m / 5` when necessary.

Each distribution cell is p50 / p75 / p90 / p95 / p99 / max.

| Feed | Window | Published threshold (points/min) | Score delta 1m | Score delta 3m | Score delta 5m | Rolling z delta 5m | Decision velocity/min | >= 2.00 | >= published |
|---|---|---:|---|---|---|---|---|---:|---:|
| iex_partial | regular | 10.416 | 0.035 / 5.663 / 14.349 / 21.479 / 37.355 / 81.241 | 0.015 / 8.493 / 21.468 / 31.754 / 52.084 / 82.693 | -0.028 / 9.033 / 23.143 / 34.315 / 55.992 / 83.271 | -0.006 / 0.727 / 1.475 / 1.993 / 3.118 / 6.926 | 0.003 / 2.916 / 7.445 / 11.056 / 18.576 / 74.756 | 30.73% | 5.67% |
| sip | premarket_early | 6.028 | 0.005 / 4.232 / 9.527 / 13.706 / 23.410 / 67.865 | 0.035 / 5.792 / 12.974 / 18.194 / 29.635 / 77.305 | -0.010 / 6.219 / 13.875 / 19.576 / 32.156 / 87.320 | -0.009 / 0.728 / 1.594 / 2.259 / 3.799 / 9.351 | 0.027 / 2.192 / 5.157 / 7.528 / 14.795 / 60.621 | 26.56% | 7.70% |
| sip | premarket_core | 6.232 | -0.086 / 4.092 / 9.659 / 14.108 / 25.067 / 81.709 | -0.105 / 5.575 / 12.911 / 18.435 / 31.420 / 80.932 | -0.106 / 6.030 / 13.905 / 19.851 / 33.304 / 90.597 | -0.010 / 0.714 / 1.517 / 2.118 / 3.460 / 7.375 | -0.024 / 2.016 / 4.834 / 7.056 / 13.445 / 71.052 | 25.14% | 6.41% |
| sip | premarket_final | 6.140 | -0.171 / 3.987 / 9.502 / 13.841 / 24.615 / 73.093 | -0.266 / 5.319 / 12.762 / 18.312 / 31.589 / 69.460 | -0.335 / 5.754 / 13.641 / 19.596 / 33.230 / 68.942 | -0.032 / 0.699 / 1.469 / 2.030 / 3.261 / 5.981 | -0.093 / 1.955 / 4.865 / 7.189 / 13.826 / 45.595 | 24.67% | 6.79% |
| sip | regular | 7.620 | -0.199 / 4.478 / 11.133 / 16.583 / 30.100 / 90.075 | -0.170 / 6.514 / 15.782 / 22.982 / 39.806 / 91.001 | -0.141 / 7.182 / 17.275 / 25.164 / 43.387 / 94.621 | -0.012 / 0.711 / 1.471 / 2.012 / 3.209 / 7.944 | -0.057 / 2.180 / 5.285 / 7.709 / 13.382 / 47.701 | 26.43% | 5.12% |
| sip | after_hours_core | 6.328 | -0.042 / 4.449 / 10.373 / 15.036 / 26.690 / 86.566 | -0.071 / 5.809 / 13.364 / 19.068 / 33.079 / 86.376 | -0.076 / 6.385 / 14.678 / 20.861 / 35.950 / 86.421 | -0.012 / 0.746 / 1.671 / 2.372 / 3.808 / 8.469 | -0.016 / 2.128 / 5.063 / 7.537 / 14.729 / 65.676 | 26.03% | 6.91% |
| sip | after_hours_late | 5.790 | -0.034 / 4.099 / 9.524 / 13.801 / 23.735 / 67.763 | -0.131 / 5.383 / 12.311 / 17.449 / 28.985 / 67.589 | -0.154 / 5.918 / 13.302 / 18.830 / 31.022 / 81.848 | -0.014 / 0.717 / 1.572 / 2.237 / 3.582 / 7.358 | -0.026 / 2.026 / 4.840 / 7.245 / 14.435 / 55.005 | 25.21% | 7.46% |

## Independent gate pass rates

| Feed | Window | Symbol-minutes | Fresh/Developing | ATR below cap | Score >= 40 | Quality | Persistence | Published velocity | Actual rows |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| iex_partial | regular | 770052 | 0.00% | 0.59% | 8.99% | 100.00% | 99.17% | 5.57% | 0 |
| sip | premarket_early | 125447 | 0.00% | 2.45% | 2.22% | 100.00% | 96.97% | 6.55% | 0 |
| sip | premarket_core | 153722 | 0.00% | 2.45% | 2.43% | 100.00% | 97.93% | 5.96% | 0 |
| sip | premarket_final | 49432 | 0.00% | 6.68% | 2.18% | 100.00% | 95.44% | 6.09% | 0 |
| sip | regular | 914393 | 0.00% | 4.72% | 5.43% | 100.00% | 99.59% | 5.11% | 0 |
| sip | after_hours_core | 128890 | 0.00% | 3.44% | 4.19% | 100.00% | 97.63% | 6.25% | 0 |
| sip | after_hours_late | 103307 | 0.00% | 1.94% | 2.12% | 100.00% | 98.63% | 6.60% | 0 |

## Cumulative funnel

The requested order is Fresh/Developing -> ATR cap -> minimum score -> data quality -> persistence -> velocity. Since stage one is zero, every later cumulative count is also zero; the explicit rows below prevent an absent key from being mistaken for missing instrumentation.

| Feed | Window | Stage reached | Count | Fraction of all symbol-minutes |
|---|---|---|---:|---:|
| iex_partial | regular | freshness | 0 | 0.00% |
| iex_partial | regular | atrTravel | 0 | 0.00% |
| iex_partial | regular | minimumScore | 0 | 0.00% |
| iex_partial | regular | dataQuality | 0 | 0.00% |
| iex_partial | regular | persistence | 0 | 0.00% |
| iex_partial | regular | velocity | 0 | 0.00% |
| sip | premarket_early | freshness | 0 | 0.00% |
| sip | premarket_early | atrTravel | 0 | 0.00% |
| sip | premarket_early | minimumScore | 0 | 0.00% |
| sip | premarket_early | dataQuality | 0 | 0.00% |
| sip | premarket_early | persistence | 0 | 0.00% |
| sip | premarket_early | velocity | 0 | 0.00% |
| sip | premarket_core | freshness | 0 | 0.00% |
| sip | premarket_core | atrTravel | 0 | 0.00% |
| sip | premarket_core | minimumScore | 0 | 0.00% |
| sip | premarket_core | dataQuality | 0 | 0.00% |
| sip | premarket_core | persistence | 0 | 0.00% |
| sip | premarket_core | velocity | 0 | 0.00% |
| sip | premarket_final | freshness | 0 | 0.00% |
| sip | premarket_final | atrTravel | 0 | 0.00% |
| sip | premarket_final | minimumScore | 0 | 0.00% |
| sip | premarket_final | dataQuality | 0 | 0.00% |
| sip | premarket_final | persistence | 0 | 0.00% |
| sip | premarket_final | velocity | 0 | 0.00% |
| sip | regular | freshness | 0 | 0.00% |
| sip | regular | atrTravel | 0 | 0.00% |
| sip | regular | minimumScore | 0 | 0.00% |
| sip | regular | dataQuality | 0 | 0.00% |
| sip | regular | persistence | 0 | 0.00% |
| sip | regular | velocity | 0 | 0.00% |
| sip | after_hours_core | freshness | 0 | 0.00% |
| sip | after_hours_core | atrTravel | 0 | 0.00% |
| sip | after_hours_core | minimumScore | 0 | 0.00% |
| sip | after_hours_core | dataQuality | 0 | 0.00% |
| sip | after_hours_core | persistence | 0 | 0.00% |
| sip | after_hours_core | velocity | 0 | 0.00% |
| sip | after_hours_late | freshness | 0 | 0.00% |
| sip | after_hours_late | atrTravel | 0 | 0.00% |
| sip | after_hours_late | minimumScore | 0 | 0.00% |
| sip | after_hours_late | dataQuality | 0 | 0.00% |
| sip | after_hours_late | persistence | 0 | 0.00% |
| sip | after_hours_late | velocity | 0 | 0.00% |

## Freshness versus exit persistence

| Policy | Active episode symbol-minutes | Fresh | Developing | Mature | Extended | WAKING rows |
|---|---:|---:|---:|---:|---:|---:|
| pre_usability | 7406 | 0 (0.00%) | 0 (0.00%) | 1249 (16.86%) | 6157 (83.14%) | 0 |
| selected_with_exit_persistence_2 | 7425 | 0 (0.00%) | 0 (0.00%) | 1249 (16.82%) | 6176 (83.18%) | 0 |
| accepted_exit_persistence_30 | 68395 | 0 (0.00%) | 0 (0.00%) | 15073 (22.04%) | 53322 (77.96%) | 0 |

The pre-usability policy already had zero Fresh and Developing time. Holding the selected entry/exit band at two-minute exits changes almost nothing. Thirty-minute exits expand active episode time from 7,425 to 68,395 symbol-minutes, but do not cause the zero: Fresh and Developing remain zero.

## Backdating interaction

Among 4324 SIP-regular moments that met score, quality, persistence, state, episode, guard, and velocity conditions, 360 (8.33%) fail the ATR-travel cap from the back-dated price but would pass from the qualification price. Backdating therefore is self-defeating for the ATR gate in a measurable minority. It changes zero current final eligibilities only because the earlier freshness gate is already fatal. Per the sequencing rule, the ATR reference correction is recorded but not applied in this one-gate counterfactual.

## Single-gate counterfactual

Only pullback-history semantics changed: it resets at episode start and requires a 0.5 ATR directional excursion followed by a 0.3 ATR retracement. Score, velocity, ATR cap/reference, state, persistence, quality, and backdating are unchanged. This is `counterfactual_not_published`.

| Date | Time ET | Symbol | Attention | Velocity/min | State | Freshness | ATR travelled |
|---|---|---|---:|---:|---|---|---:|
| 2025-10-10 | 09:03 | ORCL | 40.5 | 7.57 | EMERGING | Fresh | 0.02 |
| 2025-11-04 | 16:59 | AMD | 49.5 | 9.15 | WATCHING | Fresh | 0.00 |
| 2025-11-04 | 17:23 | AMD | 40.3 | 8.96 | WATCHING | Fresh | 0.32 |
| 2026-02-13 | 09:08 | QQQ | 40.1 | 7.82 | EMERGING | Fresh | 0.44 |
| 2026-02-13 | 09:09 | QQQ | 57.7 | 9.33 | EMERGING | Developing | 0.63 |
| 2026-02-13 | 10:34 | AMAT | 59.1 | 8.27 | WATCHING | Developing | 0.25 |

The correction produces 6 WAKING symbol-minutes across the five digest sessions. It proves the impossible freshness gate is repaired, but remains far too sparse to establish product usability. No further gate was changed.

## Cost of 30-minute exit persistence

| Population | Symbol-minutes | Settled | Pending exit | Median score decay from episode peak | p75 | p95 | Max |
|---|---:|---:|---:|---:|---:|---:|---:|
| Full IN PLAY | 9592 | 17.41% | 82.59% | 57.74 | 71.82 | 83.84 | 95.24 |
| Displayed IN PLAY | 8411 | 18.63% | 81.37% | 56.40 | 71.30 | 83.77 | 95.24 |

Displayed IN PLAY is dominated by decaying memberships: 81.37% are pending exit and median score decay is 56.40 points. The 30-minute exit is therefore too generous on this evidence and requires a separate, single-lever recalibration; it is not changed in this diagnostic round.

Artifact: `cb2ae173a5d34b7ba50a94dee1f1eb5efe79ca3440fc83e9db8e66729a1c5433`. Ground-truth validation: **REFUSED**.
