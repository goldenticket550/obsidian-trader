# Structural corrections — train/holdout result

> Timing statistics derived from historical pulls assume instantaneous bar availability. Real arrival latency is not represented. Human-relative latency and move-capture figures are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.

> Population behavior only. Ground-truth validation remains refused.

## Outcome

Neither structural proposal produced an acceptable publishable policy. The mechanisms are implemented and replayable, but active state smoothing remains `0`, no WAKING UP gate is published, and the requested downstream exit refit/digest were stopped by the explicit failure condition.

## Correction 2 — state-only rolling median

Velocity and displayed score remain raw. State decisions and I1-I4' use `coreSmoothed`.

| Minutes | Train coverage | Holdout coverage | Train settled | Holdout settled | Train decay | Holdout decay | Train transitions | Holdout transitions |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 21.01% | 23.06% | 13.22% | 7.53% | 58.19 | 64.12 | 2353 | 1242 |
| 3 | 18.18% | 21.13% | 13.07% | 7.61% | 53.98 | 57.47 | 2452 | 1287 |
| 5 | 10.17% | 7.54% | 15.55% | 12.78% | 53.70 | 56.70 | 1525 | 737 |

At matched 15-30% train/holdout coverage, 3-minute smoothing still required 30-minute exit persistence. Five-minute smoothing had no point in the coverage band. The 3-minute fixed policy increased transitions; 5 minutes reduced churn only by collapsing coverage. Therefore neither 3 nor 5 minutes is published.

## Correction 1 — state/episode-independent WAKING UP

Eligibility uses raw attention velocity, an absolute-score floor, acceptable data quality, rolling price extension, and independent short persistence. State, episode, and freshness are not gates; freshness is display-only and is `n/a` without an episode.

| Policy / split | Minute coverage | Dwell median [IQR] | Lead median | Quiet sessions |
|---|---:|---:|---:|---:|
| Original decoupled / train | 9.90% | 1.00 [1.00-1.00] | 3.00 | 0 |
| Original decoupled / holdout | 11.43% | 1.00 [1.00-1.00] | 60.50 | 0 |
| Rejected quiet-preserving / train | 0.23% | 1.00 [1.00-1.00] | 83.00 | 16 |
| Rejected quiet-preserving / holdout | 0.28% | 1.00 [1.00-1.00] | -202.00 | 4 |

Every isolated lever had a maximum training median dwell of one minute: velocity_threshold=1, extension_cap=1, minimum_score=1, persistence=1. The original decoupled gate restored coverage but violated quiet-session preservation and provided one-minute dwell. The quiet-preserving candidate collapsed to 0.23% train / 0.28% holdout, still with one-minute dwell; holdout lead was -202.00 minutes.

**Finding:** the early-surfacing thesis is not supported by this corpus under the tested gate family and usability constraints. No WAKING configuration is published.

## Deliberately not run

The exit refit and five-session post-fit digest were not run because there is no accepted smoothed substrate or WAKING configuration. This follows the requested stopping condition and avoids presenting a rejected candidate as a fit.

Artifact: `28d7ef3536d9ffa35cf7a4d9a81c82da04671e6e33e62f4475053eeaeae3d28a`. Ground truth: **REFUSED**.
