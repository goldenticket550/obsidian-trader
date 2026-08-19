# Phase C NEW IN PLAY payload diagnosis — before fix

> Timing statistics derived from historical pulls assume instantaneous bar availability. Real arrival latency is not represented. Human-relative latency and move-capture figures are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.

> Diagnosis only. No event behavior was changed while producing this report.

Mechanism: **(a)**. The qualifying transition is correct. Suppressed NEW IN PLAY edges remain pending, but payload construction reads the later emission row instead of the qualifying row.

All 26 qualifying rows met their exact IN PLAY entry gate; 22 emitted payloads did not. The cooling-timeout creation path did not bypass the state gate.

| Date | Symbol | Qualifying ET | Emission ET | Gap min | Qualifying core | Emission core | Threshold | Delay reason |
|---|---|---:|---:|---:|---:|---:|---:|---|
| 2025-10-01 | GLD | 10:47 | 10:48 | 1 | 0.809 | 0.971 | 0.800 | extended |
| 2025-10-01 | NKE | 10:47 | 10:51 | 4 | 0.815 | 0.522 | 0.800 | extended |
| 2025-10-01 | GDX | 10:48 | 10:59 | 11 | 0.924 | 0.120 | 0.800 | extended |
| 2025-10-01 | AMD | 13:59 | 14:01 | 2 | 0.953 | 0.752 | 0.800 | extended |
| 2025-10-01 | TSM | 14:02 | 14:06 | 4 | 0.898 | 0.542 | 0.800 | extended |
| 2025-10-10 | SNAP | 04:47 | 04:47 | 0 | 0.729 | 0.729 | 0.723 | none |
| 2025-10-10 | USO | 11:01 | 11:03 | 2 | 0.903 | 0.469 | 0.800 | extended |
| 2025-10-10 | DELL | 10:59 | 11:06 | 7 | 0.840 | 0.477 | 0.800 | extended |
| 2025-10-10 | CRWV | 10:59 | 11:06 | 7 | 0.918 | 0.456 | 0.800 | extended |
| 2025-10-10 | IWM | 10:58 | 11:10 | 12 | 0.985 | 0.461 | 0.800 | extended |
| 2025-10-10 | SOFI | 10:59 | 11:12 | 13 | 0.923 | 0.271 | 0.800 | extended |
| 2025-10-10 | TSM | 10:59 | 11:46 | 47 | 0.922 | 0.723 | 0.800 | extended |
| 2025-10-10 | AMD | 11:01 | 11:51 | 50 | 0.801 | 0.307 | 0.800 | extended |
| 2025-11-04 | LLY | 10:28 | 10:40 | 12 | 0.947 | 0.473 | 0.800 | extended |
| 2025-11-04 | BE | 14:00 | 14:14 | 14 | 0.825 | 0.307 | 0.800 | extended |
| 2025-11-04 | AMD | 16:16 | 16:17 | 1 | 0.753 | 0.770 | 0.718 | extended, episode_already_alerted |
| 2025-11-04 | AMD | 16:46 | 16:46 | 0 | 0.733 | 0.733 | 0.718 | none |
| 2025-11-28 | PANW | 12:59 | 13:00 | 1 | 0.855 | 0.759 | 0.800 | extended |
| 2025-11-28 | TSM | 13:00 | 13:01 | 1 | 0.803 | 0.076 | 0.800 | extended |
| 2025-11-28 | IWM | 13:00 | 13:05 | 5 | 0.878 | 0.017 | 0.800 | extended |
| 2025-11-28 | SPY | 13:00 | 13:06 | 6 | 0.840 | 0.152 | 0.800 | extended |
| 2025-11-28 | T | 13:00 | 13:10 | 10 | 0.877 | 0.054 | 0.800 | extended |
| 2025-11-28 | GDX | 12:59 | 13:13 | 14 | 0.984 | 0.417 | 0.800 | extended |
| 2025-11-28 | KLAC | 13:00 | 13:27 | 27 | 0.800 | 0.015 | 0.800 | extended |
| 2025-11-28 | QCOM | 13:00 | 13:54 | 54 | 0.852 | 0.012 | 0.800 | extended |
| 2025-11-28 | ARM | 13:00 | 15:58 | 178 | 0.866 | 0.048 | 0.800 | extended |

Artifact: `68cd966c9e37e53a349922fadd045893b7fa02a9615bedef81c4c7bbbe91e95e`.
