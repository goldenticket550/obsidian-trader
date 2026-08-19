# Attention Engine — five-session digest (theoretical_max_rescale)

> This is a description of what the replay engine did. It is not a performance, hit-rate, latency, move-capture, discovery-quality, or correctness evaluation.

> Timing statistics derived from historical pulls assume instantaneous bar availability. Real arrival latency is not represented. Human-relative latency and move-capture figures are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.

Feed: `sip`. Saturation treatment: `theoretical_max_rescale`; EXPERIMENTAL, NOT PUBLISHED. Rows are ordered by attention velocity in WAKING UP and attention score in IN PLAY. State is membership metadata.
Reached-IN-PLAY episode tables cover all sub-windows. Quiet-stretch sections cover the regular session only.
Episode lifetime measures the active/cooling episode span; IN PLAY occupancy counts only minutes whose state was IN_PLAY. Completed episodes do not continue accruing lifetime.

## 2025-10-01 — trending_up

Split: holdout. Tags: trending_up. Early close: no.

### Scheduled snapshots

#### 09:45 ET

**WAKING UP**

None.

**IN PLAY**

None.

#### 10:15 ET

**WAKING UP**

None.

**IN PLAY**

None.

#### 11:00 ET

**WAKING UP**

None.

**IN PLAY**

None.

#### 13:00 ET

**WAKING UP**

None.

**IN PLAY**

None.

#### 14:30 ET

**WAKING UP**

None.

**IN PLAY**

None.

### Reached IN PLAY at any point (all sub-windows)

| Symbol | Episode start (back-dated) | Peak attention | Peak rank | Episode lifetime | IN PLAY occupancy |
|---|---|---:|---:|---:|---:|
| IBIT | 04:20 ET | 97.0 | 1 | 15 min | 10 min |
| MSTR | 04:23 ET | 86.2 | 1 | 151 min | 3 min |
| IBIT | 04:37 ET | 97.4 | 1 | 22 min | 16 min |
| SLV | 05:21 ET | 94.2 | 1 | 7 min | 2 min |
| AMD | 07:05 ET | 96.9 | 1 | 5 min | 3 min |
| SOFI | 07:46 ET | 96.8 | 1 | 15 min | 2 min |
| META | 08:06 ET | 97.8 | 1 | 21 min | 6 min |
| BE | 08:54 ET | 97.8 | 1 | 11 min | 7 min |
| ARM | 10:33 ET | 99.1 | 1 | 9 min | 5 min |
| GLD | 10:46 ET | 98.7 | 1 | 7 min | 5 min |
| GDX | 10:47 ET | 98.2 | 1 | 6 min | 2 min |
| SLV | 10:47 ET | 98.2 | 1 | 5 min | 2 min |
| META | 11:59 ET | 98.6 | 1 | 5 min | 2 min |
| AMD | 13:58 ET | 98.8 | 1 | 7 min | 4 min |
| INTC | 13:58 ET | 98.6 | 1 | 9 min | 7 min |
| TSM | 13:58 ET | 98.6 | 1 | 8 min | 3 min |
| IBIT | 18:01 ET | 92.3 | 1 | 13 min | 3 min |
| IBIT | 19:16 ET | 90.2 | 1 | 7 min | 2 min |
| SOFI | 19:27 ET | 95.4 | 1 | 5 min | 2 min |

### Reached EMERGING but never IN PLAY

AAOI, AMZN, CRM, CRWV, IWM, LLY, MRVL, MU, NKE, NOW, NVDA, PLTR, PYPL, QQQ, SMCI, SMH, SNAP, SPY, T, USO, WDC, XOM

### Quiet stretches — no names IN PLAY

- 09:30–10:35 ET
- 10:40–10:47 ET
- 10:52–12:01 ET
- 12:03–13:59 ET
- 14:06–16:00 ET

### Cluster compaction and override changes

None.

## 2025-10-10 — high_volatility

Split: train. Tags: trending_down, high_volatility. Early close: no.

### Scheduled snapshots

#### 09:45 ET

**WAKING UP**

None.

**IN PLAY**

None.

#### 10:15 ET

**WAKING UP**

None.

**IN PLAY**

None.

#### 11:00 ET

**WAKING UP**

None.

**IN PLAY**

| Symbol | Attention | Velocity/min | State | Freshness | ATR travelled |
|---|---:|---:|---|---|---:|
| CRWV | 99.1 | 21.60 | IN_PLAY | Extended | 1.09 |
| COIN | 99.1 | 18.26 | IN_PLAY | Extended | 0.66 |
| AMD | 99.0 | 1.82 | IN_PLAY | Extended | 1.27 |
| TSM | 98.5 | 8.46 | IN_PLAY | Extended | 0.11 |
| AAOI | 98.4 | 21.66 | IN_PLAY | Extended | 0.53 |
| SMH | 98.3 | 3.55 | IN_PLAY | Extended | 2.80 |
| QCOM | 98.3 | 15.51 | IN_PLAY | Extended | 1.50 |
| AMZN | 98.2 | 8.59 | IN_PLAY | Extended | 2.22 |
| SOFI | 98.1 | 21.57 | IN_PLAY | Extended | 1.06 |
| INTC | 97.4 | 19.44 | IN_PLAY | Extended | 1.56 |

Compaction: +3 more in semis; +1 more in ai_infra.

#### 13:00 ET

**WAKING UP**

None.

**IN PLAY**

None.

#### 14:30 ET

**WAKING UP**

None.

**IN PLAY**

None.

### Reached IN PLAY at any point (all sub-windows)

| Symbol | Episode start (back-dated) | Peak attention | Peak rank | Episode lifetime | IN PLAY occupancy |
|---|---|---:|---:|---:|---:|
| IWM | 05:00 ET | 81.3 | 5 | 11 min | 2 min |
| QQQ | 05:00 ET | 84.2 | 1 | 6 min | 4 min |
| SPY | 05:00 ET | 83.9 | 1 | 20 min | 3 min |
| SLV | 05:51 ET | 97.8 | 1 | 19 min | 12 min |
| SLV | 06:14 ET | 97.7 | 1 | 9 min | 4 min |
| CRWV | 08:08 ET | 96.5 | 1 | 7 min | 3 min |
| ORCL | 09:00 ET | 85.3 | 1 | 7 min | 2 min |
| USO | 09:10 ET | 94.0 | 1 | 8 min | 3 min |
| AAL | 09:12 ET | 83.8 | 1 | 6 min | 4 min |
| IBIT | 09:17 ET | 76.7 | 2 | 7 min | 2 min |
| AAPL | 10:57 ET | 98.8 | 4 | 9 min | 4 min |
| AMAT | 10:57 ET | 98.5 | 2 | 10 min | 5 min |
| AMD | 10:57 ET | 99.2 | 1 | 8 min | 5 min |
| HOOD | 10:57 ET | 98.8 | 3 | 8 min | 5 min |
| IBIT | 10:57 ET | 98.6 | 10 | 8 min | 2 min |
| IWM | 10:57 ET | 85.9 | 8 | 10 min | 8 min |
| QQQ | 10:57 ET | 86.1 | 9 | 10 min | 8 min |
| SMH | 10:57 ET | 98.9 | 4 | 10 min | 7 min |
| SPY | 10:57 ET | 86.2 | 19 | 10 min | 8 min |
| AAOI | 10:58 ET | 98.4 | 8 | 7 min | 4 min |
| AMZN | 10:58 ET | 99.0 | 1 | 9 min | 7 min |
| ARM | 10:58 ET | 98.8 | 2 | 11 min | 4 min |
| AVGO | 10:58 ET | 98.8 | 3 | 9 min | 4 min |
| COIN | 10:58 ET | 99.2 | 1 | 6 min | 3 min |
| CRWV | 10:58 ET | 99.1 | 1 | 6 min | 4 min |
| DELL | 10:58 ET | 98.6 | 5 | 9 min | 7 min |
| INTC | 10:58 ET | 98.6 | 8 | 6 min | 3 min |
| META | 10:58 ET | 99.0 | 2 | 9 min | 4 min |
| NKE | 10:58 ET | 99.2 | 1 | 8 min | 4 min |
| NVDA | 10:58 ET | 99.0 | 1 | 9 min | 6 min |
| QCOM | 10:58 ET | 99.0 | 3 | 8 min | 6 min |
| SMCI | 10:58 ET | 99.1 | 3 | 7 min | 5 min |
| SOFI | 10:58 ET | 98.4 | 10 | 8 min | 5 min |
| TSLA | 10:58 ET | 98.8 | 5 | 8 min | 3 min |
| TSM | 10:58 ET | 99.0 | 1 | 9 min | 7 min |
| USO | 10:59 ET | 97.7 | 14 | 5 min | 2 min |
| WMT | 11:16 ET | 98.3 | 1 | 14 min | 3 min |
| SMH | 11:17 ET | 98.5 | 2 | 9 min | 5 min |
| AMD | 11:18 ET | 99.1 | 1 | 9 min | 6 min |
| AMZN | 11:18 ET | 98.1 | 3 | 9 min | 2 min |
| SMCI | 11:18 ET | 98.6 | 1 | 7 min | 5 min |
| TSM | 11:18 ET | 98.7 | 2 | 6 min | 2 min |
| MU | 11:31 ET | 98.1 | 1 | 5 min | 2 min |
| PYPL | 11:31 ET | 98.3 | 1 | 6 min | 2 min |
| TSLA | 11:31 ET | 98.7 | 1 | 6 min | 2 min |
| COST | 11:37 ET | 99.1 | 1 | 4 min | 2 min |
| AMD | 15:10 ET | 98.7 | 1 | 6 min | 3 min |
| GOOGL | 16:43 ET | 97.8 | 2 | 173 min | 14 min |
| IBIT | 16:45 ET | 97.1 | 1 | 17 min | 10 min |
| SMCI | 16:46 ET | 94.6 | 1 | 13 min | 2 min |
| IWM | 16:48 ET | 84.0 | 12 | 32 min | 7 min |
| AAPL | 16:50 ET | 97.8 | 1 | 19 min | 11 min |
| AMD | 16:50 ET | 96.9 | 2 | 12 min | 10 min |
| AMD | 16:50 ET | 96.9 | 1 | 32 min | 6 min |
| AMZN | 16:50 ET | 97.0 | 1 | 34 min | 14 min |
| CRWV | 16:50 ET | 97.6 | 1 | 16 min | 9 min |
| HOOD | 16:50 ET | 97.6 | 3 | 12 min | 6 min |
| HOOD | 16:50 ET | 97.6 | 1 | 40 min | 6 min |
| INTC | 16:50 ET | 97.3 | 2 | 16 min | 8 min |
| MSTR | 16:50 ET | 97.8 | 1 | 78 min | 23 min |
| MU | 16:50 ET | 97.4 | 1 | 14 min | 3 min |
| NBIS | 16:50 ET | 97.3 | 3 | 20 min | 13 min |
| NVDA | 16:50 ET | 97.1 | 2 | 16 min | 12 min |
| PLTR | 16:50 ET | 97.0 | 2 | 29 min | 10 min |
| QQQ | 16:50 ET | 84.5 | 11 | 15 min | 10 min |
| SPY | 16:50 ET | 84.0 | 12 | 10 min | 6 min |
| TSLA | 16:50 ET | 96.9 | 5 | 11 min | 5 min |
| SOFI | 16:51 ET | 97.4 | 1 | 16 min | 10 min |
| SOFI | 16:51 ET | 97.4 | 1 | 45 min | 9 min |
| META | 16:52 ET | 97.3 | 1 | 188 min | 7 min |
| MSFT | 16:54 ET | 97.8 | 2 | 67 min | 4 min |
| AVGO | 16:55 ET | 97.8 | 1 | 184 min | 9 min |
| IBIT | 17:08 ET | 96.3 | 1 | 17 min | 8 min |
| NBIS | 17:16 ET | 96.3 | 1 | 12 min | 3 min |
| NVDA | 18:01 ET | 96.8 | 1 | 19 min | 5 min |
| SPY | 18:07 ET | 79.0 | 5 | 8 min | 2 min |
| TSLA | 18:07 ET | 96.3 | 1 | 8 min | 4 min |
| QQQ | 18:08 ET | 83.9 | 2 | 7 min | 5 min |
| ORCL | 18:09 ET | 91.6 | 3 | 6 min | 2 min |
| CRWV | 18:10 ET | 77.6 | 7 | 4 min | 2 min |
| CRWV | 18:10 ET | 96.2 | 1 | 9 min | 2 min |
| INTC | 18:10 ET | 94.8 | 1 | 9 min | 5 min |
| HOOD | 19:46 ET | 97.1 | 1 | 7 min | 2 min |
| IBIT | 19:48 ET | 92.9 | 1 | 8 min | 2 min |

### Reached EMERGING but never IN PLAY

GLD, MRVL, NFLX, PANW, SNAP, SNDK, T

### Quiet stretches — no names IN PLAY

- 09:30–10:58 ET
- 11:06–11:19 ET
- 11:29–11:33 ET
- 11:36–11:38 ET
- 11:40–15:12 ET
- 15:15–16:00 ET

### Cluster compaction and override changes

- 10:59 ET · IN PLAY: +1 more in semis
- 11:00 ET · IN PLAY: +3 more in semis; +1 more in ai_infra
- 11:01 ET · IN PLAY: +4 more in semis; +1 more in ai_infra
- 11:02 ET · IN PLAY: +6 more in semis; +1 more in megacap_tech; +1 more in ai_infra
- 11:03 ET · IN PLAY: +5 more in semis; +1 more in megacap_tech
- 11:04 ET · IN PLAY: +4 more in semis; +1 more in megacap_tech
- 11:05 ET · IN PLAY: +3 more in semis
- 16:53 ET · IN PLAY: +1 more in megacap_tech

## 2025-11-04 — chopping

Split: train. Tags: chopping. Early close: no.

### Scheduled snapshots

#### 09:45 ET

**WAKING UP**

None.

**IN PLAY**

None.

#### 10:15 ET

**WAKING UP**

None.

**IN PLAY**

None.

#### 11:00 ET

**WAKING UP**

None.

**IN PLAY**

None.

#### 13:00 ET

**WAKING UP**

None.

**IN PLAY**

None.

#### 14:30 ET

**WAKING UP**

None.

**IN PLAY**

None.

### Reached IN PLAY at any point (all sub-windows)

| Symbol | Episode start (back-dated) | Peak attention | Peak rank | Episode lifetime | IN PLAY occupancy |
|---|---|---:|---:|---:|---:|
| META | 04:00 ET | 94.6 | 1 | 195 min | 7 min |
| PLTR | 04:16 ET | 87.1 | 1 | 6 min | 2 min |
| SPY | 05:31 ET | 82.4 | 1 | 6 min | 4 min |
| IBIT | 05:40 ET | 86.0 | 1 | 5 min | 2 min |
| SLV | 06:49 ET | 88.2 | 1 | 15 min | 6 min |
| SNDK | 08:06 ET | 97.1 | 1 | 4 min | 2 min |
| PLTR | 08:12 ET | 92.7 | 1 | 9 min | 2 min |
| PLTR | 08:53 ET | 87.2 | 1 | 14 min | 2 min |
| MSTR | 08:54 ET | 96.1 | 1 | 7 min | 3 min |
| SNDK | 09:01 ET | 77.3 | 1 | 20 min | 2 min |
| LLY | 10:20 ET | 99.1 | 1 | 14 min | 7 min |
| AAL | 13:35 ET | 98.4 | 1 | 7 min | 2 min |
| BE | 13:58 ET | 98.4 | 1 | 6 min | 3 min |
| ORCL | 14:58 ET | 98.2 | 1 | 4 min | 2 min |
| SMCI | 16:01 ET | 97.5 | 1 | 11 min | 5 min |
| SNAP | 16:06 ET | 97.5 | 1 | 12 min | 3 min |
| AMD | 16:15 ET | 97.2 | 1 | 36 min | 17 min |
| NBIS | 16:26 ET | 97.7 | 1 | 21 min | 5 min |
| HOOD | 16:33 ET | 96.4 | 1 | 15 min | 2 min |
| PLTR | 16:36 ET | 93.7 | 1 | 7 min | 2 min |
| HOOD | 19:07 ET | 93.4 | 1 | 9 min | 2 min |
| META | 19:45 ET | 97.8 | 1 | 13 min | 4 min |
| AMD | 19:54 ET | 96.0 | 1 | 6 min | 3 min |

### Reached EMERGING but never IN PLAY

AMZN, CCL, CRWV, GOOGL, INTC, IWM, MRVL, MU, NVDA, QQQ, SOFI, TSLA, TSM, UNH, WDC

### Quiet stretches — no names IN PLAY

- 09:30–10:22 ET
- 10:24–10:28 ET
- 10:33–13:38 ET
- 13:40–14:00 ET
- 14:03–14:59 ET
- 15:01–16:00 ET

### Cluster compaction and override changes

None.

## 2025-11-28 — quiet

Split: train. Tags: quiet. Early close: yes.

### Scheduled snapshots

#### 09:45 ET

**WAKING UP**

None.

**IN PLAY**

None.

#### 10:15 ET

**WAKING UP**

None.

**IN PLAY**

None.

#### 11:00 ET

**WAKING UP**

None.

**IN PLAY**

None.

#### 13:00 ET

Session closed; no regular-session snapshot.

#### 14:30 ET

Session closed; no regular-session snapshot.

### Reached IN PLAY at any point (all sub-windows)

| Symbol | Episode start (back-dated) | Peak attention | Peak rank | Episode lifetime | IN PLAY occupancy |
|---|---|---:|---:|---:|---:|
| AVGO | 07:13 ET | 96.3 | 1 | 4 min | 2 min |
| IBIT | 08:47 ET | 97.3 | 1 | 4 min | 2 min |
| SLV | 08:58 ET | 97.3 | 1 | 22 min | 11 min |
| CRWD | 12:53 ET | 98.9 | 1 | 7 min | 2 min |
| SMCI | 12:54 ET | 98.5 | 2 | 188 min | 2 min |
| AMZN | 12:55 ET | 96.9 | 5 | 190 min | 2 min |
| ARM | 12:57 ET | 98.4 | 4 | 3 min | 2 min |
| SPY | 12:57 ET | 85.3 | 11 | 185 min | 2 min |
| IWM | 12:58 ET | 85.9 | 2 | 206 min | 3 min |

### Reached EMERGING but never IN PLAY

AAPL, AMAT, COIN, GDX, GLD, IBM, INTC, KLAC, LLY, META, MSFT, MSTR, MU, PANW, QCOM, SMH, USO

### Quiet stretches — no names IN PLAY

- 09:30–12:58 ET

### Cluster compaction and override changes

None.

## 2026-02-13 — chopping

Split: train. Tags: chopping. Early close: no.

### Scheduled snapshots

#### 09:45 ET

**WAKING UP**

None.

**IN PLAY**

None.

#### 10:15 ET

**WAKING UP**

None.

**IN PLAY**

None.

#### 11:00 ET

**WAKING UP**

None.

**IN PLAY**

None.

#### 13:00 ET

**WAKING UP**

None.

**IN PLAY**

None.

#### 14:30 ET

**WAKING UP**

None.

**IN PLAY**

None.

### Reached IN PLAY at any point (all sub-windows)

| Symbol | Episode start (back-dated) | Peak attention | Peak rank | Episode lifetime | IN PLAY occupancy |
|---|---|---:|---:|---:|---:|
| IWM | 08:23 ET | 83.9 | 1 | 13 min | 4 min |
| QQQ | 08:23 ET | 82.0 | 5 | 13 min | 4 min |
| COIN | 08:25 ET | 89.6 | 1 | 10 min | 4 min |
| COIN | 08:25 ET | 96.8 | 1 | 21 min | 4 min |
| MSTR | 08:27 ET | 89.3 | 7 | 8 min | 2 min |
| BE | 08:30 ET | 91.3 | 1 | 6 min | 2 min |
| MU | 08:30 ET | 95.8 | 2 | 6 min | 3 min |
| NBIS | 08:30 ET | 97.4 | 1 | 8 min | 2 min |
| NVDA | 08:30 ET | 96.8 | 3 | 5 min | 3 min |
| PLTR | 08:30 ET | 93.4 | 7 | 4 min | 2 min |
| SNDK | 08:30 ET | 97.2 | 1 | 8 min | 4 min |
| SOFI | 08:30 ET | 97.4 | 1 | 10 min | 2 min |
| TSLA | 08:30 ET | 96.8 | 9 | 4 min | 2 min |
| SNDK | 08:45 ET | 97.2 | 1 | 18 min | 7 min |
| PLTR | 08:46 ET | 97.2 | 1 | 13 min | 3 min |
| MU | 08:48 ET | 95.4 | 2 | 7 min | 5 min |
| AAPL | 08:50 ET | 97.2 | 1 | 8 min | 6 min |
| SMCI | 08:51 ET | 90.0 | 2 | 7 min | 2 min |
| TSLA | 09:01 ET | 83.6 | 1 | 6 min | 2 min |
| MSFT | 09:02 ET | 79.2 | 2 | 9 min | 2 min |

### Reached EMERGING but never IN PLAY

AMAT, AMD, AMZN, CRWV, GDX, GOOGL, HOOD, IBIT, NFLX, SPY, UNH, WDC

### Quiet stretches — no names IN PLAY

- 09:30–16:00 ET

### Cluster compaction and override changes

None.

