# Attention Engine — five-session digest (empirical_curves)

> This is a description of what the replay engine did. It is not a performance, hit-rate, latency, move-capture, discovery-quality, or correctness evaluation.

> Timing statistics derived from historical pulls assume instantaneous bar availability. Real arrival latency is not represented. Human-relative latency and move-capture figures are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.

Feed: `sip`. Saturation treatment: `empirical_curves`; EXPERIMENTAL, NOT PUBLISHED. Rows are ordered by attention velocity in WAKING UP and attention score in IN PLAY. State is membership metadata.
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
| IBIT | 04:20 ET | 100.0 | 1 | 6 min | 4 min |
| IBIT | 04:20 ET | 100.0 | 1 | 15 min | 5 min |
| IBIT | 04:36 ET | 100.0 | 1 | 22 min | 14 min |
| AMD | 07:05 ET | 67.3 | 1 | 4 min | 2 min |
| SOFI | 07:46 ET | 100.0 | 1 | 15 min | 2 min |
| SPY | 08:15 ET | 53.3 | 1 | 8 min | 2 min |
| BE | 08:54 ET | 100.0 | 1 | 9 min | 4 min |
| ARM | 10:33 ET | 100.0 | 1 | 15 min | 6 min |
| NKE | 10:45 ET | 100.0 | 2 | 8 min | 2 min |
| GLD | 10:46 ET | 100.0 | 1 | 6 min | 4 min |
| GDX | 10:47 ET | 100.0 | 1 | 6 min | 2 min |
| LLY | 11:18 ET | 100.0 | 2 | 4 min | 2 min |
| SMCI | 11:27 ET | 99.9 | 1 | 5 min | 2 min |
| META | 11:59 ET | 100.0 | 1 | 5 min | 2 min |
| IBIT | 12:37 ET | 100.0 | 1 | 4 min | 2 min |
| LLY | 13:38 ET | 100.0 | 1 | 5 min | 2 min |
| AMD | 13:58 ET | 100.0 | 1 | 7 min | 5 min |
| INTC | 13:58 ET | 100.0 | 1 | 9 min | 7 min |
| SMH | 13:58 ET | 100.0 | 2 | 6 min | 3 min |
| TSM | 13:58 ET | 100.0 | 1 | 13 min | 7 min |

### Reached EMERGING but never IN PLAY

AAOI, CCL, CRM, CRWV, DELL, IWM, MU, NVDA, PANW, PYPL, QQQ, SLV, SNAP, WDC, XOM

### Quiet stretches — no names IN PLAY

- 09:30–10:35 ET
- 10:41–10:47 ET
- 10:51–11:19 ET
- 11:21–11:29 ET
- 11:31–12:01 ET
- 12:03–12:38 ET
- 12:40–13:40 ET
- 13:42–13:59 ET
- 14:06–16:00 ET

### Cluster compaction and override changes

- 13:59 ET · IN PLAY: +1 more in semis

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
| AMD | 100.0 | 0.26 | IN_PLAY | Extended | 1.27 |
| COIN | 100.0 | 28.29 | IN_PLAY | Extended | 0.66 |
| CRWV | 100.0 | 30.34 | IN_PLAY | Extended | 1.09 |
| SMH | 100.0 | 18.09 | IN_PLAY | Extended | 2.80 |
| SPY | 100.0 | 1.00 | IN_PLAY | Extended | 3.29 |
| IWM | 100.0 | 4.20 | IN_PLAY | Extended | 2.63 |
| TSM | 96.1 | 22.49 | IN_PLAY | Extended | 0.11 |
| SOFI | 95.9 | 29.23 | IN_PLAY | Extended | 1.06 |
| QCOM | 95.0 | 25.08 | IN_PLAY | Extended | 1.50 |
| AMZN | 91.8 | 15.78 | IN_PLAY | Extended | 2.96 |

Compaction: +2 more in semis.

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
| SNAP | 04:46 ET | 91.7 | 1 | 196 min | 9 min |
| SLV | 05:55 ET | 100.0 | 1 | 14 min | 6 min |
| SLV | 06:14 ET | 100.0 | 1 | 5 min | 2 min |
| AMAT | 10:57 ET | 100.0 | 1 | 10 min | 5 min |
| AMD | 10:57 ET | 100.0 | 1 | 9 min | 7 min |
| AMZN | 10:57 ET | 100.0 | 1 | 10 min | 7 min |
| HOOD | 10:57 ET | 100.0 | 6 | 7 min | 2 min |
| IWM | 10:57 ET | 100.0 | 1 | 18 min | 8 min |
| QQQ | 10:57 ET | 100.0 | 2 | 15 min | 9 min |
| SMH | 10:57 ET | 100.0 | 2 | 14 min | 8 min |
| SPY | 10:57 ET | 100.0 | 4 | 13 min | 8 min |
| ARM | 10:58 ET | 100.0 | 3 | 12 min | 3 min |
| AVGO | 10:58 ET | 100.0 | 4 | 8 min | 2 min |
| COIN | 10:58 ET | 100.0 | 3 | 6 min | 4 min |
| CRWV | 10:58 ET | 100.0 | 4 | 6 min | 4 min |
| DELL | 10:58 ET | 100.0 | 3 | 9 min | 2 min |
| IBIT | 10:58 ET | 100.0 | 6 | 8 min | 2 min |
| META | 10:58 ET | 100.0 | 9 | 8 min | 2 min |
| MRVL | 10:58 ET | 98.6 | 13 | 8 min | 2 min |
| NKE | 10:58 ET | 100.0 | 2 | 8 min | 2 min |
| NVDA | 10:58 ET | 100.0 | 7 | 8 min | 3 min |
| PYPL | 10:58 ET | 100.0 | 3 | 8 min | 2 min |
| QCOM | 10:58 ET | 100.0 | 4 | 8 min | 6 min |
| SMCI | 10:58 ET | 100.0 | 9 | 7 min | 2 min |
| SOFI | 10:58 ET | 100.0 | 9 | 8 min | 3 min |
| TSM | 10:58 ET | 100.0 | 1 | 10 min | 8 min |
| AMZN | 11:17 ET | 100.0 | 1 | 11 min | 8 min |
| SMH | 11:17 ET | 100.0 | 2 | 10 min | 6 min |
| AMD | 11:18 ET | 100.0 | 1 | 9 min | 7 min |
| COIN | 11:18 ET | 94.2 | 3 | 8 min | 2 min |
| NVDA | 11:18 ET | 100.0 | 2 | 9 min | 3 min |
| QCOM | 11:18 ET | 100.0 | 3 | 10 min | 5 min |
| QQQ | 11:18 ET | 95.6 | 6 | 8 min | 2 min |
| SMCI | 11:18 ET | 100.0 | 4 | 6 min | 4 min |
| SPY | 11:18 ET | 96.8 | 7 | 8 min | 3 min |
| TSM | 11:18 ET | 100.0 | 5 | 10 min | 2 min |
| GOOGL | 11:22 ET | 100.0 | 1 | 11 min | 2 min |
| AAOI | 11:30 ET | 96.4 | 3 | 6 min | 4 min |
| SMH | 11:30 ET | 100.0 | 3 | 6 min | 4 min |
| TSM | 11:30 ET | 99.4 | 2 | 9 min | 2 min |
| AMD | 11:31 ET | 100.0 | 1 | 10 min | 2 min |
| MU | 11:31 ET | 100.0 | 1 | 5 min | 2 min |
| PYPL | 11:31 ET | 100.0 | 3 | 6 min | 3 min |
| TSLA | 11:31 ET | 100.0 | 3 | 6 min | 4 min |
| AMD | 11:43 ET | 100.0 | 1 | 5 min | 2 min |
| QQQ | 11:44 ET | 87.2 | 4 | 4 min | 2 min |
| AMD | 15:09 ET | 100.0 | 1 | 6 min | 2 min |
| AAPL | 16:50 ET | 100.0 | 1 | 18 min | 11 min |
| IBIT | 16:50 ET | 100.0 | 2 | 11 min | 2 min |
| IWM | 16:50 ET | 96.8 | 2 | 9 min | 7 min |
| QQQ | 16:50 ET | 92.7 | 1 | 12 min | 6 min |
| SPY | 16:50 ET | 99.3 | 1 | 9 min | 6 min |
| SOFI | 16:55 ET | 98.2 | 1 | 9 min | 2 min |
| IBIT | 17:08 ET | 93.6 | 1 | 26 min | 8 min |
| AMD | 18:03 ET | 100.0 | 1 | 11 min | 4 min |
| NVDA | 18:07 ET | 100.0 | 1 | 20 min | 8 min |
| QQQ | 18:07 ET | 96.5 | 1 | 9 min | 5 min |
| SPY | 18:07 ET | 56.6 | 4 | 7 min | 5 min |
| TSLA | 18:07 ET | 56.1 | 3 | 7 min | 2 min |
| CRWV | 18:10 ET | 67.9 | 4 | 4 min | 2 min |

### Reached EMERGING but never IN PLAY

AAL, COST, GLD, IBM, INTC, MSFT, MSTR, NBIS, ORCL, PANW, PLTR, SNDK, USO, WMT

### Quiet stretches — no names IN PLAY

- 09:30–10:58 ET
- 11:07–11:09 ET
- 11:11–11:19 ET
- 11:28–11:31 ET
- 11:36–11:38 ET
- 11:40–11:45 ET
- 11:47–15:12 ET
- 15:14–16:00 ET

### Cluster compaction and override changes

- 10:59 ET · IN PLAY: +2 more in semis
- 11:02 ET · IN PLAY: +5 more in semis
- 11:04 ET · IN PLAY: +4 more in semis
- 11:20 ET · IN PLAY: +1 more in semis
- 11:22 ET · IN PLAY: +1 more in semis

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
| LLY | 10:20 ET | 100.0 | 1 | 15 min | 8 min |
| AAL | 13:36 ET | 100.0 | 1 | 5 min | 3 min |
| PLTR | 13:43 ET | 100.0 | 1 | 4 min | 2 min |
| BE | 13:59 ET | 100.0 | 1 | 4 min | 2 min |
| ORCL | 14:58 ET | 99.2 | 1 | 4 min | 2 min |
| SMCI | 16:05 ET | 100.0 | 1 | 6 min | 3 min |
| AMD | 16:15 ET | 69.0 | 1 | 15 min | 2 min |
| META | 19:45 ET | 89.2 | 1 | 13 min | 2 min |

### Reached EMERGING but never IN PLAY

HOOD, MSTR, MU, PANW, PYPL, SMH, SNAP, SNDK, SOFI, SPY, UBER

### Quiet stretches — no names IN PLAY

- 09:30–10:21 ET
- 10:23–10:28 ET
- 10:34–13:37 ET
- 13:40–13:44 ET
- 13:46–14:00 ET
- 14:02–14:59 ET
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
| LLY | 08:57 ET | 70.2 | 1 | 28 min | 2 min |
| SLV | 08:58 ET | 100.0 | 1 | 12 min | 4 min |
| SLV | 08:58 ET | 100.0 | 1 | 22 min | 3 min |
| INTC | 12:49 ET | 100.0 | 1 | 6 min | 2 min |
| AAPL | 12:50 ET | 100.0 | 1 | 227 min | 2 min |
| CRWD | 12:53 ET | 100.0 | 1 | 7 min | 2 min |
| QCOM | 12:53 ET | 100.0 | 2 | 7 min | 4 min |
| AMAT | 12:54 ET | 100.0 | 1 | 6 min | 2 min |
| SMCI | 12:54 ET | 100.0 | 3 | 188 min | 2 min |
| AMZN | 12:55 ET | 90.8 | 5 | 190 min | 3 min |
| SMH | 12:55 ET | 100.0 | 4 | 188 min | 2 min |
| GDX | 12:56 ET | 100.0 | 3 | 204 min | 7 min |
| ARM | 12:57 ET | 100.0 | 1 | 3 min | 1 min |
| PANW | 12:57 ET | 100.0 | 4 | 3 min | 1 min |
| SPY | 12:57 ET | 98.1 | 12 | 185 min | 2 min |
| IWM | 12:58 ET | 99.4 | 1 | 206 min | 3 min |
| MSFT | 12:58 ET | 98.1 | 2 | 221 min | 7 min |

### Reached EMERGING but never IN PLAY

ADBE, AVGO, COIN, IBIT, KLAC, META, MRVL, SNAP, WDC

### Quiet stretches — no names IN PLAY

- 09:30–12:51 ET
- 12:53–12:55 ET

### Cluster compaction and override changes

- 12:59 ET · IN PLAY: +1 more in semis

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
| COIN | 08:26 ET | 100.0 | 1 | 19 min | 6 min |
| IWM | 08:28 ET | 92.4 | 1 | 10 min | 4 min |
| AAPL | 08:50 ET | 100.0 | 1 | 7 min | 3 min |
| UNH | 18:08 ET | 59.5 | 1 | 112 min | 6 min |

### Reached EMERGING but never IN PLAY

BE, GDX, META, MU, NBIS, NVDA, QQQ, SMCI, SNDK, SOFI, SPY

### Quiet stretches — no names IN PLAY

- 09:30–16:00 ET

### Cluster compaction and override changes

None.

