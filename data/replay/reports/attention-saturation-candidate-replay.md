# Attention saturation candidate replay

> Experimental comparison only. The proposed row is not adopted or published; ground-truth conclusions remain refused.

> Timing statistics derived from historical pulls assume instantaneous bar availability. Real arrival latency is not represented. Human-relative latency and move-capture figures are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.

| Candidate | Episodes | Peak p50/p75/p90/p95/p99/min/max | Exact 100 | Peak-rank 1 | Unique peaks (0.1) | Acceptance |
|---|---:|---|---:|---:|---:|---|
| published | 155 | 100/100/100/100/100/88.1503/100 | 130 (83.9%) | 89 (57.4%) | 21 | FAIL |
| log_participation | 79 | 100/100/100/100/100/83.6056/100 | 54 (68.4%) | 43 (54.4%) | 23 | FAIL |
| log_participation_and_range | 74 | 100/100/100/100/100/80.697/100 | 45 (60.8%) | 38 (51.4%) | 26 | FAIL |
| empirical_curves | 109 | 100/100/100/100/100/53.2615/100 | 76 (69.7%) | 61 (56.0%) | 28 | FAIL |
| log_participation_empirical_curves | 107 | 100/100/100/100/100/65.8735/100 | 70 (65.4%) | 59 (55.1%) | 32 | FAIL |
| log_participation_range_empirical_curves | 102 | 100/100/100/100/100/68.948/100 | 63 (61.8%) | 62 (60.8%) | 33 | FAIL |
| theoretical_max_rescale | 155 | 97.2225/98.395/98.8835/99.066/99.1985/76.6524/99.2345 | 0 (0.0%) | 101 (65.2%) | 68 | PASS |
| log_participation_theoretical_max_rescale | 79 | 91.892/95.3311/96.8803/97.1818/98.5311/72.7005/98.668 | 0 (0.0%) | 49 (62.0%) | 62 | PASS |
| log_participation_range_theoretical_max_rescale | 74 | 89.2588/93.2992/96.1714/96.8747/98.1646/70.1713/98.4163 | 0 (0.0%) | 42 (56.8%) | 62 | PASS |

Proposed for trader adjudication: `log_participation_range_theoretical_max_rescale`. This is a replay comparison, not an active calibration change.

Artifact hash: `c6f93980190703627cce83f0fe7ffa503c84ab19b9b178a73b309d58a62ae0c7`.
