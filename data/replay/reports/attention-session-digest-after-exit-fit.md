# Attention Engine - digest after independent IN PLAY exit-liveness fit

> This is a description of what the replay engine did. It is not a performance, hit-rate, latency, move-capture, discovery-quality, or correctness evaluation.

> Timing statistics derived from historical pulls assume instantaneous bar availability. Real arrival latency is not represented. Human-relative latency and move-capture figures are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.

Feed: `sip`. No exit frontier point met every target; active exit policy remains unchanged. Rows are ordered by attention velocity in WAKING UP and attention score in IN PLAY. State is membership metadata.
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

| Symbol | Attention | Velocity/min | State | Freshness | ATR travelled |
|---|---:|---:|---|---|---:|
| NKE | 50.2 | 9.15 | IN_PLAY | Extended | 0.06 |
| GLD | 25.7 | 2.41 | IN_PLAY | Mature | 0.82 |
| GDX | 20.4 | -3.00 | IN_PLAY | Developing | 1.22 |

#### 13:00 ET

**WAKING UP**

None.

**IN PLAY**

| Symbol | Attention | Velocity/min | State | Freshness | ATR travelled |
|---|---:|---:|---|---|---:|
| XOM | 18.1 | 0.05 | IN_PLAY | Extended | 4.40 |

#### 14:30 ET

**WAKING UP**

None.

**IN PLAY**

| Symbol | Attention | Velocity/min | State | Freshness | ATR travelled |
|---|---:|---:|---|---|---:|
| SMH | 30.1 | 3.60 | IN_PLAY | Extended | 0.21 |
| AMD | 9.2 | 0.35 | IN_PLAY | Mature | 0.11 |
| TSM | 7.4 | 0.69 | IN_PLAY | Mature | 1.73 |

### Reached IN PLAY at any point (all sub-windows)

| Symbol | Episode start (back-dated) | Peak attention | Peak rank | Episode lifetime | IN PLAY occupancy |
|---|---|---:|---:|---:|---:|
| NKE | 10:45 ET | 85.1 | 1 | 41 min | 38 min |
| GLD | 10:46 ET | 97.1 | 1 | 35 min | 33 min |
| GDX | 10:47 ET | 92.4 | 1 | 34 min | 30 min |
| SMCI | 11:27 ET | 87.4 | 1 | 33 min | 30 min |
| XOM | 12:21 ET | 88.8 | 1 | 55 min | 39 min |
| TSM | 13:29 ET | 97.1 | 1 | 71 min | 37 min |
| AMD | 13:58 ET | 95.3 | 2 | 35 min | 33 min |
| SMH | 13:58 ET | 85.6 | 1 | 34 min | 32 min |

### Reached EMERGING but never IN PLAY

AAL, AMAT, AMZN, ARM, BE, CRM, CRWV, IBIT, INTC, IWM, LLY, META, MU, NOW, NVDA, PANW, PLTR, PYPL, QQQ, SLV, SNAP, SOFI, SPY, T, USO, WDC

### Quiet stretches — no names IN PLAY

- 09:30–10:47 ET
- 11:25–11:29 ET
- 11:59–12:36 ET
- 13:15–13:59 ET
- 14:39–16:00 ET

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
| SMH | 95.2 | 8.32 | IN_PLAY | Extended | 2.80 |
| CRWV | 91.2 | 20.56 | IN_PLAY | Extended | 1.09 |
| COIN | 90.5 | 17.96 | IN_PLAY | Extended | 0.66 |
| SOFI | 86.3 | 19.70 | IN_PLAY | Extended | 1.06 |
| SPY | 85.5 | 1.75 | IN_PLAY | Extended | 3.29 |
| QCOM | 84.5 | 13.94 | IN_PLAY | Extended | 1.50 |
| IWM | 83.2 | 3.66 | IN_PLAY | Extended | 2.63 |
| TSM | 78.8 | 8.96 | IN_PLAY | Extended | 0.11 |
| AMZN | 76.7 | 6.52 | IN_PLAY | Extended | 2.96 |
| SMCI | 74.5 | 13.13 | IN_PLAY | Extended | 1.78 |

Compaction: +1 more in semis; +2 more across other clusters.

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
| SNAP | 04:46 ET | 81.4 | 1 | 196 min | 9 min |
| AMD | 10:57 ET | 87.9 | 1 | 80 min | 75 min |
| AMZN | 10:57 ET | 95.7 | 1 | 79 min | 76 min |
| HOOD | 10:57 ET | 93.3 | 1 | 78 min | 65 min |
| IBIT | 10:57 ET | 92.3 | 1 | 77 min | 69 min |
| IWM | 10:57 ET | 85.6 | 1 | 80 min | 78 min |
| QQQ | 10:57 ET | 85.2 | 2 | 80 min | 78 min |
| SMH | 10:57 ET | 95.5 | 1 | 80 min | 77 min |
| SPY | 10:57 ET | 86.2 | 1 | 79 min | 77 min |
| ARM | 10:58 ET | 86.6 | 2 | 65 min | 60 min |
| AVGO | 10:58 ET | 95.4 | 1 | 77 min | 61 min |
| COIN | 10:58 ET | 93.3 | 1 | 78 min | 75 min |
| CRWV | 10:58 ET | 93.9 | 3 | 65 min | 63 min |
| DELL | 10:58 ET | 87.0 | 2 | 55 min | 53 min |
| META | 10:58 ET | 93.4 | 1 | 78 min | 32 min |
| MRVL | 10:58 ET | 87.9 | 6 | 66 min | 49 min |
| NKE | 10:58 ET | 89.1 | 4 | 36 min | 31 min |
| NVDA | 10:58 ET | 96.5 | 1 | 78 min | 73 min |
| QCOM | 10:58 ET | 95.5 | 2 | 58 min | 56 min |
| SMCI | 10:58 ET | 93.3 | 2 | 78 min | 76 min |
| SOFI | 10:58 ET | 92.3 | 2 | 77 min | 75 min |
| TSLA | 10:58 ET | 94.8 | 1 | 77 min | 62 min |
| TSM | 10:58 ET | 96.3 | 1 | 79 min | 77 min |
| USO | 10:59 ET | 90.3 | 3 | 33 min | 30 min |
| AMD | 15:10 ET | 91.4 | 1 | 51 min | 48 min |
| AMZN | 16:50 ET | 78.8 | 1 | 35 min | 2 min |
| CRWV | 16:50 ET | 85.5 | 1 | 16 min | 2 min |
| NVDA | 16:50 ET | 97.0 | 1 | 13 min | 5 min |
| QQQ | 16:50 ET | 74.1 | 2 | 12 min | 6 min |
| TSLA | 16:50 ET | 88.0 | 1 | 15 min | 4 min |
| SOFI | 16:51 ET | 96.6 | 1 | 16 min | 2 min |
| IBIT | 17:08 ET | 86.1 | 1 | 15 min | 2 min |

### Reached EMERGING but never IN PLAY

AAL, AAPL, AMAT, COST, GLD, GOOGL, IBM, INTC, MSFT, MSTR, MU, NBIS, ORCL, PANW, PLTR, PYPL, SLV, WMT

### Quiet stretches — no names IN PLAY

- 09:30–10:58 ET
- 12:16–15:12 ET

### Cluster compaction and override changes

- 10:59 ET · IN PLAY: +1 more in semis; +1 more across other clusters
- 11:00 ET · IN PLAY: +1 more in semis; +2 more across other clusters
- 11:01 ET · IN PLAY: +2 more in semis; +3 more across other clusters
- 11:02 ET · IN PLAY: +5 more in semis; +6 more across other clusters
- 11:31 ET · IN PLAY: +5 more in semis; +5 more across other clusters
- 11:33 ET · IN PLAY: +5 more in semis; +4 more across other clusters
- 11:34 ET · IN PLAY: +5 more in semis; +3 more across other clusters
- 11:48 ET · IN PLAY: +4 more in semis; +3 more across other clusters
- 11:52 ET · IN PLAY: +4 more in semis; +2 more across other clusters
- 11:55 ET · IN PLAY: +3 more in semis; +2 more across other clusters
- 12:02 ET · IN PLAY: +2 more in semis; +1 more across other clusters
- 12:03 ET · IN PLAY: +1 more in semis; +1 more across other clusters
- 12:04 ET · IN PLAY: +1 more in semis

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

| Symbol | Attention | Velocity/min | State | Freshness | ATR travelled |
|---|---:|---:|---|---|---:|
| LLY | 11.4 | -0.23 | IN_PLAY | Mature | 0.91 |

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
| LLY | 10:20 ET | 96.0 | 1 | 58 min | 49 min |
| BE | 13:58 ET | 83.3 | 1 | 49 min | 30 min |
| ORCL | 14:58 ET | 81.3 | 1 | 32 min | 30 min |
| SMCI | 16:01 ET | 89.4 | 1 | 11 min | 2 min |
| AMD | 16:15 ET | 92.6 | 1 | 25 min | 12 min |
| AMD | 16:15 ET | 92.6 | 1 | 36 min | 2 min |

### Reached EMERGING but never IN PLAY

AAL, AVGO, CRWV, GDX, GOOGL, HOOD, IBIT, INTC, IWM, META, MSTR, MU, NBIS, NVDA, PANW, PLTR, PYPL, QQQ, SNAP, SNDK, SOFI, TSLA, TSM, UBER, UNH

### Quiet stretches — no names IN PLAY

- 09:30–10:28 ET
- 11:17–14:00 ET
- 14:30–14:59 ET
- 15:29–16:00 ET

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

**WAKING UP**

None.

**IN PLAY**

| Symbol | Attention | Velocity/min | State | Freshness | ATR travelled |
|---|---:|---:|---|---|---:|
| CRWD | 98.4 | 5.17 | IN_PLAY | Extended | 1.10 |
| GDX | 97.5 | 8.32 | IN_PLAY | Extended | 1.48 |
| MRVL | 94.6 | 16.63 | IN_PLAY | Extended | 2.45 |
| PLTR | 94.5 | 18.58 | IN_PLAY | Extended | 0.74 |
| META | 94.3 | 11.38 | IN_PLAY | Extended | 1.88 |
| SMCI | 93.2 | 8.59 | IN_PLAY | Extended | 3.11 |
| MSFT | 91.0 | 19.73 | IN_PLAY | Extended | 0.39 |
| ARM | 86.6 | 5.60 | IN_PLAY | Extended | 1.35 |
| AVGO | 86.4 | 8.41 | IN_PLAY | Extended | 3.35 |
| AMAT | 85.8 | 3.66 | IN_PLAY | Extended | 3.06 |

Compaction: +5 more in semis; +1 more across other clusters.

#### 14:30 ET

**WAKING UP**

None.

**IN PLAY**

| Symbol | Attention | Velocity/min | State | Freshness | ATR travelled |
|---|---:|---:|---|---|---:|
| AVGO | 4.1 | -0.77 | IN_PLAY | Extended | 9.11 |
| SMCI | 1.8 | -1.66 | IN_PLAY | Extended | 9.15 |

### Reached IN PLAY at any point (all sub-windows)

| Symbol | Episode start (back-dated) | Peak attention | Peak rank | Episode lifetime | IN PLAY occupancy |
|---|---|---:|---:|---:|---:|
| AVGO | 12:47 ET | 86.4 | 1 | 196 min | 139 min |
| INTC | 12:49 ET | 90.2 | 1 | 44 min | 41 min |
| META | 12:52 ET | 94.3 | 3 | 39 min | 30 min |
| MRVL | 12:52 ET | 94.6 | 1 | 222 min | 51 min |
| QCOM | 12:53 ET | 83.1 | 1 | 187 min | 18 min |
| AMAT | 12:54 ET | 85.8 | 11 | 129 min | 6 min |
| KLAC | 12:54 ET | 86.9 | 2 | 34 min | 2 min |
| SMCI | 12:54 ET | 93.2 | 1 | 187 min | 151 min |
| ARM | 12:57 ET | 88.3 | 6 | 182 min | 13 min |
| CRWD | 12:57 ET | 98.4 | 1 | 164 min | 37 min |
| GDX | 12:57 ET | 98.4 | 1 | 203 min | 102 min |
| PANW | 12:57 ET | 82.4 | 2 | 178 min | 18 min |
| SPY | 12:57 ET | 80.2 | 1 | 34 min | 30 min |
| IWM | 12:58 ET | 81.5 | 1 | 206 min | 97 min |
| MSFT | 12:58 ET | 91.0 | 1 | 221 min | 97 min |
| PLTR | 12:59 ET | 94.5 | 4 | 32 min | 30 min |
| T | 12:59 ET | 82.1 | 2 | 181 min | 35 min |
| TSM | 12:59 ET | 82.5 | 1 | 237 min | 78 min |

### Reached EMERGING but never IN PLAY

AAPL, ADBE, AMZN, COIN, GLD, HOOD, IBIT, IBM, LLY, MSTR, MU, NOW, QQQ, SLV, SMH, TSLA, USO, WMT

### Quiet stretches — no names IN PLAY

- 09:30–12:51 ET

### Cluster compaction and override changes

- 13:00 ET · IN PLAY: +5 more in semis; +1 more across other clusters
- 13:01 ET · IN PLAY: +2 more in semis
- 13:02 ET · IN PLAY: +1 more in semis
- 13:03 ET · IN PLAY: +3 more in semis
- 13:04 ET · IN PLAY: +2 more in semis; +1 more across other clusters
- 13:05 ET · IN PLAY: +1 more in semis
- 13:07 ET · IN PLAY: +3 more in semis; +1 more across other clusters
- 13:10 ET · IN PLAY: +1 more in semis
- 13:12 ET · IN PLAY: +2 more in semis
- 13:14 ET · IN PLAY: +1 more in semis
- 13:21 ET · IN PLAY: +1 more in semis
- 13:23 ET · IN PLAY: +1 more in semis
- 13:25 ET · IN PLAY: +1 more in semis
- 13:31 ET · IN PLAY: +1 more in semis
- 13:45 ET · IN PLAY: +1 more in semis
- 13:54 ET · IN PLAY: +1 more in semis
- 15:58 ET · IN PLAY: +2 more in semis

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
| AAPL | 08:50 ET | 77.1 | 1 | 7 min | 2 min |

### Reached EMERGING but never IN PLAY

AMAT, AMD, AMZN, ARM, COIN, GDX, GOOGL, HOOD, IWM, LLY, META, MSFT, MSTR, MU, NBIS, NFLX, NVDA, PLTR, PYPL, QQQ, SMCI, SNDK, SOFI, SPY, TSLA, UNH

### Quiet stretches — no names IN PLAY

- 09:30–16:00 ET

### Cluster compaction and override changes

None.


## All WAKING UP symbol-minutes

| Date | Time ET | Symbol | Attention | Velocity/min | State | Freshness | ATR travelled |
|---|---|---|---:|---:|---|---|---:|
| 2025-10-10 | 09:03 | ORCL | 40.5 | 7.57 | EMERGING | Fresh | 0.02 |
| 2025-11-04 | 16:59 | AMD | 49.5 | 9.15 | WATCHING | Fresh | 0.00 |
| 2025-11-04 | 17:23 | AMD | 40.3 | 8.96 | WATCHING | Fresh | 0.32 |
| 2026-02-13 | 09:08 | QQQ | 40.1 | 7.82 | EMERGING | Fresh | 0.44 |
| 2026-02-13 | 09:09 | QQQ | 57.7 | 9.33 | EMERGING | Developing | 0.63 |
| 2026-02-13 | 10:34 | AMAT | 59.1 | 8.27 | WATCHING | Developing | 0.25 |
