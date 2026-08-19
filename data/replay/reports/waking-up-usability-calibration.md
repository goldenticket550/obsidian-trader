# WAKING UP usability calibration

> Timing statistics derived from historical pulls assume instantaneous bar availability. Real arrival latency is not represented. Human-relative latency and move-capture figures are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.

> Population behavior only. Ground-truth validation remains refused. The pullback scoping bug is published; fitting uses training only and reports holdout without refitting.

| Policy / split | Coverage | Dwell median [IQR] | Names/session median [IQR] | Lead median [IQR] | Quiet preserved |
|---|---:|---:|---:|---:|---|
| Current / train | 9.90% | 1.00 [1.00-1.00] | 22.00 [14.75-28.25] | 3.00 [-47.00-127.50] | NO |
| Current / holdout | 11.43% | 1.00 [1.00-1.00] | 27.00 [19.00-28.00] | 60.50 [4.25-126.00] | NO |
| Rejected / train | 0.23% | 1.00 [1.00-1.00] | 0.00 [0.00-1.00] | 83.00 [-36.00-175.00] | yes |
| Rejected / holdout | 0.28% | 1.00 [1.00-1.00] | 1.00 [0.00-1.25] | -202.00 [-202.00--202.00] | NO |

Rejected best training candidate: `v10-x0.75-s50-p2`.

## ATR travelled at qualification (back-dated)

Count 1623; min 0.00, p25 0.16, median 0.34, p75 0.63, max 6.98. Reference remains episode start.

## One-lever isolation (training)

| Lever | Config | Coverage | Dwell | Lead | Quiet |
|---|---|---:|---:|---:|---|
| velocity_threshold | v0.5-x1.5-s40-p2 | 16.10% | 1.00 | 3.50 | NO |
| velocity_threshold | v1-x1.5-s40-p2 | 15.87% | 1.00 | 3.50 | NO |
| velocity_threshold | v1.5-x1.5-s40-p2 | 15.60% | 1.00 | 5.00 | NO |
| velocity_threshold | v2-x1.5-s40-p2 | 15.31% | 1.00 | 2.00 | NO |
| velocity_threshold | v3-x1.5-s40-p2 | 14.62% | 1.00 | 3.50 | NO |
| velocity_threshold | v4-x1.5-s40-p2 | 13.87% | 1.00 | 7.00 | NO |
| velocity_threshold | v5-x1.5-s40-p2 | 13.16% | 1.00 | 3.50 | NO |
| velocity_threshold | v7.62-x1.5-s40-p2 | 9.90% | 1.00 | 3.00 | NO |
| velocity_threshold | v10-x1.5-s40-p2 | 5.56% | 1.00 | 4.00 | NO |
| extension_cap | v7.62-x0.5-s40-p2 | 0.51% | 1.00 | -47.00 | NO |
| extension_cap | v7.62-x0.75-s40-p2 | 1.10% | 1.00 | 55.00 | NO |
| extension_cap | v7.62-x1-s40-p2 | 2.53% | 1.00 | 5.00 | NO |
| extension_cap | v7.62-x1.5-s40-p2 | 9.90% | 1.00 | 3.00 | NO |
| extension_cap | v7.62-x2-s40-p2 | 18.90% | 1.00 | 19.00 | NO |
| extension_cap | v7.62-x2.5-s40-p2 | 24.18% | 1.00 | 36.00 | NO |
| extension_cap | v7.62-x3-s40-p2 | 26.64% | 1.00 | 40.00 | NO |
| extension_cap | v7.62-x4-s40-p2 | 28.33% | 1.00 | 40.00 | NO |
| minimum_score | v7.62-x1.5-s10-p2 | 19.36% | 1.00 | 78.00 | NO |
| minimum_score | v7.62-x1.5-s15-p2 | 19.35% | 1.00 | 78.00 | NO |
| minimum_score | v7.62-x1.5-s20-p2 | 19.35% | 1.00 | 78.00 | NO |
| minimum_score | v7.62-x1.5-s25-p2 | 19.34% | 1.00 | 78.00 | NO |
| minimum_score | v7.62-x1.5-s30-p2 | 18.25% | 1.00 | 80.50 | NO |
| minimum_score | v7.62-x1.5-s35-p2 | 14.59% | 1.00 | 29.50 | NO |
| minimum_score | v7.62-x1.5-s40-p2 | 9.90% | 1.00 | 3.00 | NO |
| minimum_score | v7.62-x1.5-s45-p2 | 6.43% | 1.00 | -19.00 | NO |
| minimum_score | v7.62-x1.5-s50-p2 | 3.31% | 1.00 | -20.00 | NO |
| persistence | v7.62-x1.5-s40-p1 | 43.72% | 1.00 | 115.50 | NO |
| persistence | v7.62-x1.5-s40-p2 | 9.90% | 1.00 | 3.00 | NO |

## Sequential selection

| Pass | Lever | Before | After | Config |
|---:|---|---:|---:|---|
| 1 | velocity_threshold | 30121.02 | 30080.19 | v1.5-x1.5-s40-p2 |
| 1 | extension_cap | 30080.19 | 20161.19 | v1.5-x0.75-s40-p2 |
| 2 | velocity_threshold | 20161.19 | 10995.07 | v10-x0.75-s40-p2 |
| 2 | minimum_score | 10995.07 | 177.67 | v10-x0.75-s50-p2 |

## Post-fix funnel

Total 914393; actual WAKING rows 39.

| Gate | Independent | Cumulative |
|---|---:|---:|
| extension | 300449 | 300449 |
| minimumScore | 22393 | 1027 |
| dataQuality | 914393 | 1027 |
| velocity | 23752 | 664 |
| persistence | 39 | 39 |

No WAKING configuration is published. Artifact: `65c1d7f9a9b6e7146674e63da170ef7b29e21db20da071e6da1ac2ddc537a3f1`. Ground truth: **REFUSED**.
