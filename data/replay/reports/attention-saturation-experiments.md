# Attention-score saturation experiments

> Candidate evaluation only. No curve or threshold in this report is published or active.

> Timing statistics derived from historical pulls assume instantaneous bar availability. Real arrival latency is not represented. Human-relative latency and move-capture figures are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.

## Unclamped regular-session inputs

| Feed | Axis | Raw p50/p75/p90/p95/p99/max | >2 | >4 | >6 | Would hit ±8 | Log p50/p75/p90/p95/p99/max | Log would hit ±8 |
|---|---|---|---:|---:|---:|---:|---|---:|
| sip | participation | 0.0971/1.2722/3.2162/5.1467/12.5299/494.6853 | 17.21% | 7.40% | 3.90% | 2.36% | 0.0881/0.8953/1.7583/2.3914/3.9493/21.6020 | 0.26% |
| sip | displacement | 0.0372/0.7823/1.5711/2.1226/3.4697/32.2687 | 5.83% | 0.58% | 0.13% | 0.05% | 0.0225/0.7404/1.4527/1.9140/2.9313/13.3737 | 0.01% |
| iex_partial | participation | 0.2203/1.4124/3.4530/5.5143/13.1697/971.4377 | 18.55% | 8.18% | 4.37% | 2.63% | 0.1843/0.8316/1.5057/2.0038/3.1809/14.5692 | 0.01% |
| iex_partial | displacement | 0.0380/0.7631/1.5353/2.0827/3.4618/42.7748 | 5.56% | 0.59% | 0.13% | 0.07% | 0.0194/0.7142/1.3941/1.8402/2.8365/20.8841 | 0.03% |

## Regular-session score-shape comparison

| Variant | Feed | Mode | Core p50/p75/p90/p95/p99/max | Core >0.87 | Attention p50/p75/p90/p95/p99/max |
|---|---|---|---|---:|---|
| published | sip | dense | 0.1518/0.2515/0.4050/0.5378/0.8204/0.9935 | 0.68% | 15.7000/26.7000/44.0800/59.3700/92.4200/100.0000 |
| log_participation | sip | dense | 0.1422/0.2289/0.3493/0.4417/0.6507/0.9918 | 0.11% | 14.7000/24.2900/38.1300/48.8600/73.3600/100.0000 |
| log_range_only | sip | dense | 0.1499/0.2465/0.3939/0.5191/0.7783/0.9935 | 0.44% | 15.5100/26.1800/42.8500/57.2500/87.8200/100.0000 |
| log_participation_and_range | sip | dense | 0.1406/0.2247/0.3385/0.4247/0.6208/0.9935 | 0.07% | 14.5300/23.8500/36.9400/46.9800/69.9800/100.0000 |
| empirical_curves | sip | dense | 0.0328/0.0618/0.1172/0.1731/0.4115/1.0000 | 0.14% | 3.3900/6.5600/12.7700/19.1500/46.1800/100.0000 |
| log_participation_empirical_curves | sip | dense | 0.0331/0.0701/0.1467/0.2305/0.5051/0.9996 | 0.13% | 3.4300/7.4300/15.9500/25.4100/56.7900/100.0000 |
| log_participation_range_empirical_curves | sip | dense | 0.0336/0.0732/0.1556/0.2436/0.5190/0.9996 | 0.11% | 3.4800/7.7600/16.9400/26.8800/58.2800/100.0000 |
| theoretical_max_rescale | sip | dense | 0.1518/0.2515/0.4050/0.5378/0.8204/0.9935 | 0.68% | 13.6500/23.2200/38.3300/51.6200/80.3700/99.3276 |
| log_participation_theoretical_max_rescale | sip | dense | 0.1422/0.2289/0.3493/0.4417/0.6507/0.9918 | 0.11% | 12.7800/21.1200/33.1600/42.4800/63.7900/99.1388 |
| log_participation_range_theoretical_max_rescale | sip | dense | 0.1406/0.2247/0.3385/0.4247/0.6208/0.9935 | 0.07% | 12.6400/20.7400/32.1300/40.8600/60.8600/99.2703 |
| published | iex_partial | dense | 0.1516/0.2709/0.4580/0.6018/0.8621/0.9905 | 0.93% | 15.1600/27.0900/45.8000/60.1800/86.2100/99.0478 |
| log_participation | iex_partial | dense | 0.1516/0.2709/0.4580/0.6018/0.8621/0.9905 | 0.93% | 15.1600/27.0900/45.8000/60.1800/86.2100/99.0478 |
| log_range_only | iex_partial | dense | 0.1494/0.2650/0.4412/0.5729/0.8127/0.9905 | 0.56% | 14.9400/26.5000/44.1200/57.2900/81.2700/99.0478 |
| log_participation_and_range | iex_partial | dense | 0.1494/0.2650/0.4412/0.5729/0.8127/0.9905 | 0.56% | 14.9400/26.5000/44.1200/57.2900/81.2700/99.0478 |
| empirical_curves | iex_partial | dense | 0.0319/0.0677/0.1483/0.2422/0.5779/1.0000 | 0.25% | 3.1900/6.7700/14.8300/24.2200/57.7900/100.0000 |
| log_participation_empirical_curves | iex_partial | dense | 0.0319/0.0677/0.1483/0.2422/0.5779/1.0000 | 0.25% | 3.1900/6.7700/14.8300/24.2200/57.7900/100.0000 |
| log_participation_range_empirical_curves | iex_partial | dense | 0.0321/0.0727/0.1613/0.2598/0.5950/1.0000 | 0.23% | 3.2100/7.2700/16.1300/25.9800/59.5000/99.9994 |
| theoretical_max_rescale | iex_partial | dense | 0.1516/0.2709/0.4580/0.6018/0.8621/0.9905 | 0.93% | 13.1800/23.5600/39.8300/52.3300/74.9700/86.1285 |
| log_participation_theoretical_max_rescale | iex_partial | dense | 0.1516/0.2709/0.4580/0.6018/0.8621/0.9905 | 0.93% | 13.1800/23.5600/39.8300/52.3300/74.9700/86.1285 |
| log_participation_range_theoretical_max_rescale | iex_partial | dense | 0.1494/0.2650/0.4412/0.5729/0.8127/0.9905 | 0.56% | 12.9900/23.0400/38.3700/49.8200/70.6700/86.1285 |

The JSON companion contains every feed × sub-window × baseline-mode row, all axis norm distributions, component-level volume/dollar-volume/range tails, and every experimental curve.

Artifact hash: `7b50a21f9104b6dd52eecfefd9097aaa1a021240b036aa51edb454c7eba8f164`.
