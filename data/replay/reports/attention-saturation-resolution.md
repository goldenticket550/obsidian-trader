# Attention-score saturation diagnosis and candidate evaluation

> Diagnostic and experimental replay only. No candidate curve, transform, threshold, or final-score rescale in this report has been published to the active calibration.

> Ground-truth validation remains REFUSED. This report describes score/population behavior, not discovery quality or trading performance.

> Timing statistics derived from historical pulls assume instantaneous bar availability. Real arrival latency is not represented. Human-relative latency and move-capture figures are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.

## Result

The MAD-tail hypothesis is confirmed for Participation. In SIP regular dense buckets, unclamped participation z is p50 0.0971, p95 5.1467, p99 12.5299, max 494.6853; 2.36% of observations would hit the ±8 clamp. The dollar-volume component is p99 12.7635 and max 511.8272. `log1p` reduces participation p99 to 3.9493 and the would-clamp share to 0.26%.

It is not symmetric across axes. SIP regular Displacement is p99 3.4697 and only 0.05% would hit ±8; logging range reduces an already much smaller tail. Idiosyncrasy is also heavy-tailed (p99 8.5816; 1.23% would hit ±8) and remains a separate finding.

A (log participation), B (empirical z50/k from unclamped observations), and their combinations all FAIL the episode-level acceptance test. Their best requested result still has 45/74 (60.8%) episode peaks at exactly 100. Minute-scale tail repair is real, but the hard final clamp remains many-to-one after state thresholds select session maxima.

An additional control normalizes by the formula's theoretical maximum modifier instead of clipping: `attention = 100 * core * modifier / 1.15`. It changes neither core nor confluence. Alone it produces 0/155 exact-100 peaks. Combined with log participation plus log range it produces 0/74 exact-100 peaks, 70.1713–98.4163 range, and 62 distinct one-decimal peaks. This clears the numerical acceptance condition but is PROPOSED FOR ADJUDICATION, NOT ACTIVE.

## Empirical unclamped axis inputs

Distribution cells are p50/p75/p90/p95/p99/max. Tail cells are fractions >2/>4/>6/would-hit-±8. Presence cells add the fraction at the six-bit cap.

| Feed | Window | Mode | Participation z | Participation tails | Presence bits / cap | Displacement z | Displacement tails | Idiosyncrasy z | Idiosyncrasy tails |
|---|---|---|---|---|---|---|---|---|---|
| sip | premarket_early | dense | 0.4069/2.1710/5.9692/10.7846/33.2579/916.9738 | 26.44%/15.13%/9.93%/7.22% | n/a | 0.0314/0.7187/1.4956/2.0823/3.7262/58.0498 | 5.51%/0.80%/0.24%/0.16% | 0.0000/1.2751/3.1785/4.9057/10.5804/86.8329 | 17.27%/7.15%/3.41%/1.87% |
| sip | premarket_early | sparse | n/a/n/a/n/a/n/a/n/a/n/a | n/a/n/a/n/a/NaN% | 0.9546/1.1456/1.5735/1.8365/2.6439/3.5064 / 0.00% | 0.0223/0.7014/1.5338/2.2027/4.3206/325.2139 | 6.21%/1.19%/0.43%/0.41% | 0.4931/1.9160/4.0930/6.1767/12.5587/170.9019 | 24.05%/10.38%/5.24%/2.85% |
| sip | premarket_core | dense | 0.3065/2.0231/5.8890/11.0088/36.1005/1463.9260 | 25.20%/14.62%/9.80%/7.22% | n/a | 0.0768/0.7918/1.6110/2.2574/4.3757/99.8061 | 6.52%/1.27%/0.46%/0.29% | 0.3063/1.6538/3.6273/5.4646/11.9505/160.2324 | 20.95%/8.63%/4.19%/2.36% |
| sip | premarket_core | sparse | n/a/n/a/n/a/n/a/n/a/n/a | n/a/n/a/n/a/NaN% | 1.0954/1.4580/1.6990/1.9434/2.5395/2.7563 / 0.00% | 0.0870/0.7656/1.6016/2.2740/4.4226/209.5791 | 6.52%/1.33%/0.46%/0.56% | 0.5821/1.9097/3.9499/5.8679/12.4104/166.0605 | 23.76%/9.78%/4.79%/2.64% |
| sip | premarket_final | dense | 0.1866/1.7008/5.0433/9.3648/35.8340/29510.2889 | 22.41%/12.42%/8.34%/6.05% | n/a | 0.0625/0.7836/1.5777/2.2031/4.0788/32.7604 | 6.26%/1.05%/0.37%/0.28% | 0.3737/1.5906/3.2974/4.7820/9.3431/217.9441 | 19.88%/7.04%/3.06%/1.55% |
| sip | premarket_final | sparse | n/a/n/a/n/a/n/a/n/a/n/a | n/a/n/a/n/a/NaN% | 0.9885/1.2243/1.4580/1.4901/2.5395/2.5395 / 0.00% | 0.0845/0.7705/1.5908/2.2477/4.1020/21.9206 | 6.50%/1.10%/0.43%/0.52% | 0.6447/2.0694/3.8498/5.5295/11.1461/103.5136 | 25.82%/9.21%/4.01%/2.21% |
| sip | regular | dense | 0.0971/1.2722/3.2162/5.1467/12.5299/494.6853 | 17.21%/7.40%/3.90%/2.36% | n/a | 0.0372/0.7823/1.5711/2.1226/3.4697/32.2687 | 5.83%/0.58%/0.13%/0.05% | 0.5889/1.7692/3.3628/4.6977/8.5816/109.6596 | 21.81%/7.11%/2.76%/1.23% |
| sip | after_hours_core | dense | 0.6118/3.0910/10.7942/26.3790/156.0708/17282.7843 | 32.16%/21.06%/15.78%/12.73% | n/a | 0.1422/0.9038/1.8412/2.6387/5.3592/44.2961 | 8.63%/1.98%/0.77%/0.49% | 0.4898/2.1995/5.0864/8.0982/22.6153/246.5932 | 26.98%/13.63%/7.84%/5.14% |
| sip | after_hours_core | sparse | n/a/n/a/n/a/n/a/n/a/n/a | n/a/n/a/n/a/NaN% | 1.0831/1.3659/1.6804/1.8997/2.5395/3.5064 / 0.00% | 0.1103/0.8491/1.8363/2.7659/6.0527/158.2760 | 8.70%/2.41%/1.01%/0.97% | 0.8577/2.8995/6.3416/10.0216/25.6505/211.8524 | 33.51%/18.17%/10.82%/7.10% |
| sip | after_hours_late | dense | 0.6236/2.7118/7.7984/14.5264/48.5961/5498.8592 | 30.53%/18.63%/12.96%/9.77% | n/a | 0.0471/0.7310/1.4941/2.0777/3.5289/247.9403 | 5.51%/0.66%/0.15%/0.37% | 0.2727/1.8232/4.2724/6.5382/14.3908/213.9413 | 23.11%/10.94%/5.79%/3.49% |
| sip | after_hours_late | sparse | n/a/n/a/n/a/n/a/n/a/n/a | n/a/n/a/n/a/NaN% | 0.9885/1.4112/1.6990/1.8997/2.6082/3.5064 / 0.00% | 0.0036/0.6769/1.5094/2.1762/4.2442/152.0905 | 5.86%/1.16%/0.37%/0.77% | 0.4838/2.1444/4.7234/7.0100/13.9852/114.9513 | 26.59%/12.68%/6.63%/3.87% |
| sip | regular | sparse | n/a/n/a/n/a/n/a/n/a/n/a | n/a/n/a/n/a/NaN% | 1.4266/1.4422/2.5064/2.5395/2.5395/2.5395 / 0.00% | 0.0330/0.7735/1.5945/2.1370/3.4739/10.2780 | 5.90%/0.67%/0.21%/0.03% | 0.0732/1.2355/2.8119/4.0607/8.1643/24.9368 | 15.95%/5.28%/2.19%/1.08% |
| iex_partial | premarket_final | sparse | n/a/n/a/n/a/n/a/n/a/n/a | n/a/n/a/n/a/NaN% | 1.0605/1.1898/1.2670/1.3485/3.0743/4.0743 / 0.00% | -0.1594/0.4862/1.2269/2.2124/6.2014/9.1777 | 5.88%/2.94%/1.18%/1.18% | -0.0325/1.3402/3.4469/4.3833/11.9308/20.7837 | 15.88%/5.88%/2.94%/1.76% |
| iex_partial | regular | dense | 0.2203/1.4124/3.4530/5.5143/13.1697/971.4377 | 18.55%/8.18%/4.37%/2.63% | n/a | 0.0380/0.7631/1.5353/2.0827/3.4618/42.7748 | 5.56%/0.59%/0.13%/0.07% | 0.7390/1.9550/3.6155/5.0096/9.1658/97.4992 | 24.38%/8.20%/3.21%/1.49% |
| iex_partial | regular | sparse | n/a/n/a/n/a/n/a/n/a/n/a | n/a/n/a/n/a/NaN% | 0.9419/1.3485/1.4710/2.3154/2.3485/2.3485 / 0.00% | 0.0338/0.7563/1.5804/2.2140/3.8977/13.8101 | 6.47%/0.91%/0.32%/0.35% | 0.6671/2.1421/4.3229/6.4764/14.6604/179.4488 | 26.71%/11.29%/5.77%/3.40% |
| iex_partial | premarket_core | sparse | n/a/n/a/n/a/n/a/n/a/n/a | n/a/n/a/n/a/NaN% | 1.2357/1.3154/1.4367/1.4529/3.3041/3.3825 / 0.00% | 0.2112/0.9293/1.8439/2.3167/6.5100/8.4503 | 8.18%/3.64%/1.82%/0.91% | 0.0349/1.5311/2.7217/4.0567/6.8860/7.8925 | 17.27%/5.45%/3.64%/0.00% |
| iex_partial | premarket_final | dense | 1.9202/7.2427/21.0509/35.5863/47.2146/50.1217 | 50.00%/37.50%/37.50%/25.00% | n/a | -0.2719/-0.1148/0.8042/1.3651/1.8138/1.9260 | 0.00%/0.00%/0.00%/0.00% | -0.1300/0.8810/5.2735/7.6092/9.4777/9.9449 | 25.00%/12.50%/12.50%/12.50% |
| iex_partial | after_hours_core | dense | 0.5226/2.4691/17.6415/25.3705/51.3744/60.0106 | 26.67%/23.33%/20.00%/20.00% | n/a | 0.0580/0.4734/0.9979/1.3649/1.6968/1.7568 | 0.00%/0.00%/0.00%/0.00% | -0.1927/0.8500/1.3801/1.4773/2.5197/2.9186 | 3.33%/0.00%/0.00%/0.00% |
| iex_partial | after_hours_core | sparse | n/a/n/a/n/a/n/a/n/a/n/a | n/a/n/a/n/a/NaN% | 1.3654/2.1601/2.9168/2.9489/3.0945/3.1309 / 0.00% | -0.2886/1.3854/2.2370/2.8032/3.0423/3.1021 | 16.67%/0.00%/0.00%/0.00% | -0.0376/0.8848/2.0148/3.2243/6.5231/7.3478 | 11.11%/5.56%/5.56%/0.00% |

## Published norm and core distributions

Distribution cells are p50/p75/p90/p95/p99/max. These rows use the currently published curves and post-clamp inputs.

| Feed | Window | Mode | Participation norm | Displacement norm | Idiosyncrasy norm | Core | Core >0.87 |
|---|---|---|---|---|---|---|---:|
| sip | premarket_early | dense | 0.1361/0.3315/0.8541/0.9564/0.9564/0.9564 | 0.1257/0.2570/0.4826/0.6637/0.9388/0.9997 | 0.1119/0.2455/0.5729/0.8290/0.9798/0.9798 | 0.1429/0.2439/0.4086/0.5554/0.8481/0.9778 | 0.85% |
| sip | premarket_early | sparse | 0.1991/0.2578/0.4234/0.5378/0.8270/0.9558 | 0.1245/0.2528/0.4948/0.6971/0.9631/0.9997 | 0.1539/0.3439/0.7259/0.9258/0.9798/0.9798 | 0.1668/0.2443/0.3477/0.4107/0.5595/0.9630 | 0.02% |
| sip | premarket_core | dense | 0.1286/0.3106/0.8474/0.9564/0.9564/0.9564 | 0.1358/0.2784/0.5191/0.7084/0.9538/0.9997 | 0.1356/0.2893/0.6221/0.8581/0.9733/0.9733 | 0.1457/0.2472/0.4114/0.5574/0.8635/0.9778 | 0.95% |
| sip | premarket_core | sparse | 0.2413/0.3750/0.4777/0.5838/0.7993/0.8533 | 0.1373/0.2719/0.5162/0.7129/0.9628/0.9997 | 0.1601/0.3280/0.6742/0.8894/0.9733/0.9733 | 0.1879/0.2760/0.3818/0.4518/0.6123/0.8914 | 0.02% |
| sip | premarket_final | dense | 0.1201/0.2676/0.7624/0.9564/0.9564/0.9564 | 0.1310/0.2739/0.5088/0.6965/0.9481/0.9997 | 0.1436/0.2997/0.6143/0.8332/0.9835/0.9835 | 0.1373/0.2328/0.3890/0.5336/0.8588/0.9778 | 0.94% |
| sip | premarket_final | sparse | 0.2087/0.2850/0.3750/0.3882/0.7993/0.7993 | 0.1342/0.2706/0.5130/0.7084/0.9591/0.9997 | 0.1712/0.3822/0.7090/0.8988/0.9835/0.9835 | 0.1735/0.2520/0.3497/0.4081/0.5546/0.8685 | 0.00% |
| sip | regular | dense | 0.1564/0.3130/0.6684/0.8982/0.9874/0.9874 | 0.1317/0.2774/0.5066/0.6713/0.9160/0.9997 | 0.1615/0.3386/0.6570/0.8526/0.9889/0.9889 | 0.1518/0.2515/0.4050/0.5378/0.8204/0.9935 | 0.68% |
| sip | after_hours_core | dense | 0.1525/0.4742/0.9564/0.9564/0.9564/0.9564 | 0.1604/0.3187/0.5847/0.7821/0.9664/0.9995 | 0.1426/0.3356/0.7674/0.9564/0.9564/0.9564 | 0.1723/0.2987/0.5061/0.6802/0.9449/0.9777 | 2.11% |
| sip | after_hours_core | sparse | 0.2374/0.3380/0.4696/0.5651/0.7993/0.9558 | 0.1554/0.3049/0.5823/0.8063/0.9834/0.9995 | 0.1744/0.4433/0.8818/0.9564/0.9564/0.9564 | 0.1983/0.2872/0.4005/0.4771/0.6436/0.9107 | 0.05% |
| sip | after_hours_late | dense | 0.1535/0.4134/0.9448/0.9564/0.9564/0.9564 | 0.1246/0.2569/0.4819/0.6647/0.9273/0.9998 | 0.1262/0.2834/0.6603/0.8945/0.9564/0.9564 | 0.1529/0.2565/0.4169/0.5570/0.8419/0.9778 | 0.77% |
| sip | after_hours_late | sparse | 0.2087/0.3560/0.4777/0.5651/0.8179/0.9558 | 0.1186/0.2437/0.4868/0.6915/0.9639/0.9998 | 0.1421/0.3277/0.7227/0.9201/0.9564/0.9564 | 0.1695/0.2509/0.3601/0.4322/0.6197/0.9149 | 0.02% |
| sip | regular | sparse | 0.3622/0.3685/0.7898/0.7993/0.7993/0.7993 | 0.1311/0.2752/0.5139/0.6752/0.9167/0.9979 | 0.1116/0.2476/0.5483/0.7734/0.9889/0.9889 | 0.2363/0.3459/0.4765/0.5552/0.7408/0.8799 | 0.12% |
| iex_partial | premarket_final | sparse | 0.0744/0.0868/0.0951/0.1046/0.5241/0.8017 | 0.0697/0.1398/0.2834/0.5632/0.9727/0.9993 | 0.0802/0.3118/0.8501/0.9456/0.9993/0.9993 | 0.0820/0.1943/0.3469/0.5295/0.9789/0.9928 | 2.35% |
| iex_partial | regular | dense | 0.1553/0.3132/0.6834/0.9122/0.9857/0.9857 | 0.1297/0.2708/0.4954/0.6617/0.9169/0.9997 | 0.1721/0.3444/0.6505/0.8434/0.9813/0.9813 | 0.1516/0.2709/0.4580/0.6018/0.8621/0.9905 | 0.93% |
| iex_partial | regular | sparse | 0.1956/0.3312/0.3803/0.7290/0.7403/0.7403 | 0.1291/0.2691/0.5096/0.6976/0.9490/0.9997 | 0.1645/0.3772/0.7614/0.9428/0.9813/0.9813 | 0.1493/0.2789/0.4878/0.6488/0.9121/0.9905 | 1.37% |
| iex_partial | premarket_core | sparse | 0.0917/0.1006/0.1159/0.1180/0.5975/0.6218 | 0.1047/0.2167/0.4533/0.5935/0.9952/0.9993 | 0.0864/0.3630/0.7039/0.9212/0.9971/0.9992 | 0.1115/0.2413/0.4906/0.6586/0.7881/0.9922 | 0.91% |
| iex_partial | premarket_final | dense | 0.4912/0.9974/0.9993/0.9993/0.9993/0.9993 | 0.0614/0.0761/0.2259/0.3519/0.4526/0.4778 | 0.0721/0.2737/0.8747/0.9370/0.9868/0.9993 | 0.0645/0.1286/0.4252/0.5581/0.6644/0.6910 | 0.00% |
| iex_partial | after_hours_core | dense | 0.1453/0.6339/0.9993/0.9993/0.9993/0.9993 | 0.0887/0.1381/0.2312/0.3206/0.4103/0.4276 | 0.0672/0.2011/0.3222/0.3484/0.6392/0.7507 | 0.0913/0.1531/0.1773/0.2357/0.4468/0.5257 | 0.00% |
| iex_partial | after_hours_core | sparse | 0.1067/0.2513/0.4730/0.4834/0.5306/0.5425 | 0.0604/0.3452/0.5669/0.7228/0.7763/0.7896 | 0.0802/0.2100/0.5033/0.6978/0.9383/0.9984 | 0.0679/0.2629/0.3982/0.5804/0.7901/0.8426 | 0.00% |

## Five-session episode comparison

| Candidate | Episodes | Peak attention p50/p75/p90/p95/p99/max | Exact 100 | Peak rank 1 | Unique peaks at 0.1 | Acceptance |
|---|---:|---|---:|---:|---:|---|
| published | 155 | 100.0000/100.0000/100.0000/100.0000/100.0000/100.0000 | 130 (83.87%) | 89 (57.42%) | 21 | FAIL |
| log_participation | 79 | 100.0000/100.0000/100.0000/100.0000/100.0000/100.0000 | 54 (68.35%) | 43 (54.43%) | 23 | FAIL |
| log_participation_and_range | 74 | 100.0000/100.0000/100.0000/100.0000/100.0000/100.0000 | 45 (60.81%) | 38 (51.35%) | 26 | FAIL |
| empirical_curves | 109 | 100.0000/100.0000/100.0000/100.0000/100.0000/100.0000 | 76 (69.72%) | 61 (55.96%) | 28 | FAIL |
| log_participation_empirical_curves | 107 | 100.0000/100.0000/100.0000/100.0000/100.0000/100.0000 | 70 (65.42%) | 59 (55.14%) | 32 | FAIL |
| log_participation_range_empirical_curves | 102 | 100.0000/100.0000/100.0000/100.0000/100.0000/100.0000 | 63 (61.76%) | 62 (60.78%) | 33 | FAIL |
| theoretical_max_rescale | 155 | 97.2225/98.3950/98.8835/99.0660/99.1985/99.2345 | 0 (0.00%) | 101 (65.16%) | 68 | PASS |
| log_participation_theoretical_max_rescale | 79 | 91.8920/95.3311/96.8803/97.1818/98.5311/98.6680 | 0 (0.00%) | 49 (62.03%) | 62 | PASS |
| log_participation_range_theoretical_max_rescale | 74 | 89.2588/93.2992/96.1714/96.8747/98.1646/98.4163 | 0 (0.00%) | 42 (56.76%) | 62 | PASS |

The proposed digest is `attention-session-digest-proposed.md`; its header marks the treatment experimental and unpublished.

## Digest contradiction resolved

This was a reporting defect, not an engine state-tracking defect. The old `Duration` mixed episode lifetime with IN PLAY occupancy, and the collector continued advancing `lastAt` on already-completed episodes. The table now has separate `Episode lifetime` and `IN PLAY occupancy` columns and freezes lifetime at completion. GDX now reads: start 10:47 ET, episode lifetime 6 minutes, IN PLAY occupancy 2 minutes. The 14:06–16:00 quiet stretch is therefore consistent.

## Per-minute IN PLAY population — published SIP regular

Across 15420 minutes, zero names were IN PLAY for 14971 minutes (97.09%). The peak was 38/61; 3 minutes had at least 30.

This is not bimodal. It is a dominant atom at zero with a very thin, extremely right-tailed nonzero distribution. The 30+ rows are broad-tape regime evidence and remain in engine state/logging; a separate 12-row presentation cap prevents the UI from rendering the entire population.

| Simultaneous IN PLAY | Minutes | Share |
|---:|---:|---:|
| 0 | 14971 | 97.09% |
| 1 | 345 | 2.24% |
| 2 | 30 | 0.19% |
| 3 | 19 | 0.12% |
| 4 | 14 | 0.09% |
| 5 | 1 | 0.01% |
| 6 | 6 | 0.04% |
| 7 | 4 | 0.03% |
| 8 | 2 | 0.01% |
| 9 | 4 | 0.03% |
| 10 | 1 | 0.01% |
| 11 | 3 | 0.02% |
| 12 | 3 | 0.02% |
| 13 | 3 | 0.02% |
| 14 | 2 | 0.01% |
| 16 | 3 | 0.02% |
| 17 | 2 | 0.01% |
| 21 | 1 | 0.01% |
| 22 | 1 | 0.01% |
| 26 | 1 | 0.01% |
| 28 | 1 | 0.01% |
| 33 | 1 | 0.01% |
| 34 | 1 | 0.01% |
| 38 | 1 | 0.01% |

Report identity: `d48d5e02b69d9425ff98987a869ba7520ea0cbf60b84c8bafdae622534bd4331`.
