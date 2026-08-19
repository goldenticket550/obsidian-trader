# Attention Engine — five-session digest (log_participation)

> This is a description of what the replay engine did. It is not a performance, hit-rate, latency, move-capture, discovery-quality, or correctness evaluation.

> Timing statistics derived from historical pulls assume instantaneous bar availability. Real arrival latency is not represented. Human-relative latency and move-capture figures are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.

Feed: `sip`. Saturation treatment: `log_participation`; EXPERIMENTAL, NOT PUBLISHED. Rows are ordered by attention velocity in WAKING UP and attention score in IN PLAY. State is membership metadata.
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
| IBIT | 04:20 ET | 92.6 | 1 | 14 min | 2 min |
| NVDA | 10:36 ET | 99.8 | 1 | 4 min | 2 min |
| NKE | 10:45 ET | 100.0 | 2 | 6 min | 2 min |
| GLD | 10:46 ET | 100.0 | 1 | 6 min | 4 min |
| GDX | 10:47 ET | 100.0 | 1 | 6 min | 2 min |
| SMCI | 11:27 ET | 100.0 | 1 | 5 min | 3 min |
| CRM | 11:56 ET | 100.0 | 1 | 4 min | 2 min |
| XOM | 12:35 ET | 100.0 | 1 | 5 min | 3 min |
| IBIT | 12:37 ET | 100.0 | 1 | 4 min | 2 min |
| AMD | 13:58 ET | 100.0 | 1 | 8 min | 2 min |
| SMH | 13:58 ET | 100.0 | 1 | 6 min | 4 min |
| TSM | 13:58 ET | 100.0 | 1 | 13 min | 5 min |

### Reached EMERGING but never IN PLAY

AAL, AMAT, AMZN, ARM, BE, CRWV, INTC, IWM, LLY, META, MU, PANW, PLTR, PYPL, QQQ, SLV, SNAP, SOFI, SPY, USO, WDC

### Quiet stretches — no names IN PLAY

- 09:30–10:37 ET
- 10:39–10:47 ET
- 10:51–11:28 ET
- 11:31–11:57 ET
- 11:59–12:36 ET
- 12:40–13:59 ET
- 14:05–16:00 ET

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
| COIN | 100.0 | 19.03 | IN_PLAY | Extended | 0.66 |
| CRWV | 100.0 | 21.86 | IN_PLAY | Extended | 1.09 |
| SMH | 100.0 | 4.36 | IN_PLAY | Extended | 2.80 |
| USO | 99.6 | 23.37 | IN_PLAY | Mature | 0.72 |
| SOFI | 99.3 | 22.29 | IN_PLAY | Extended | 1.06 |
| SPY | 98.3 | 0.50 | IN_PLAY | Extended | 3.29 |
| QCOM | 97.9 | 14.66 | IN_PLAY | Extended | 1.50 |
| NVDA | 96.3 | 9.72 | IN_PLAY | Extended | 1.34 |
| IWM | 95.7 | 4.21 | IN_PLAY | Extended | 2.63 |
| TSM | 93.4 | 10.77 | IN_PLAY | Extended | 0.11 |

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
| SNAP | 04:46 ET | 94.8 | 1 | 196 min | 9 min |
| AMD | 10:57 ET | 97.4 | 9 | 9 min | 4 min |
| AMZN | 10:57 ET | 100.0 | 1 | 10 min | 7 min |
| HOOD | 10:57 ET | 100.0 | 4 | 7 min | 2 min |
| IBIT | 10:57 ET | 100.0 | 4 | 8 min | 5 min |
| IWM | 10:57 ET | 98.5 | 1 | 18 min | 8 min |
| QQQ | 10:57 ET | 98.0 | 2 | 15 min | 11 min |
| SMH | 10:57 ET | 100.0 | 2 | 14 min | 8 min |
| SPY | 10:57 ET | 99.2 | 4 | 10 min | 8 min |
| ARM | 10:58 ET | 98.2 | 8 | 8 min | 2 min |
| AVGO | 10:58 ET | 100.0 | 2 | 8 min | 2 min |
| COIN | 10:58 ET | 100.0 | 2 | 7 min | 4 min |
| CRWV | 10:58 ET | 100.0 | 3 | 6 min | 4 min |
| DELL | 10:58 ET | 100.0 | 3 | 11 min | 2 min |
| META | 10:58 ET | 100.0 | 4 | 8 min | 3 min |
| MRVL | 10:58 ET | 100.0 | 5 | 8 min | 2 min |
| NVDA | 10:58 ET | 100.0 | 5 | 9 min | 6 min |
| QCOM | 10:58 ET | 100.0 | 2 | 8 min | 6 min |
| SMCI | 10:58 ET | 100.0 | 10 | 7 min | 2 min |
| SOFI | 10:58 ET | 100.0 | 4 | 8 min | 3 min |
| TSLA | 10:58 ET | 100.0 | 3 | 8 min | 3 min |
| TSM | 10:58 ET | 100.0 | 1 | 10 min | 8 min |
| USO | 10:59 ET | 100.0 | 6 | 5 min | 3 min |
| WMT | 11:15 ET | 100.0 | 5 | 8 min | 2 min |
| WMT | 11:15 ET | 100.0 | 1 | 15 min | 3 min |
| AMZN | 11:17 ET | 100.0 | 1 | 11 min | 8 min |
| SMH | 11:17 ET | 100.0 | 1 | 10 min | 7 min |
| NVDA | 11:18 ET | 100.0 | 2 | 10 min | 7 min |
| QCOM | 11:18 ET | 100.0 | 3 | 10 min | 2 min |
| QQQ | 11:18 ET | 91.2 | 6 | 8 min | 2 min |
| SPY | 11:18 ET | 94.7 | 10 | 8 min | 4 min |
| TSM | 11:18 ET | 100.0 | 5 | 5 min | 2 min |
| AMAT | 11:29 ET | 100.0 | 1 | 5 min | 2 min |
| SMH | 11:30 ET | 100.0 | 2 | 6 min | 4 min |
| COIN | 11:31 ET | 100.0 | 1 | 6 min | 2 min |
| TSLA | 11:31 ET | 100.0 | 2 | 6 min | 4 min |
| NVDA | 11:43 ET | 99.5 | 1 | 5 min | 2 min |
| QQQ | 11:44 ET | 83.6 | 7 | 4 min | 2 min |
| SMH | 11:44 ET | 96.2 | 1 | 5 min | 3 min |
| AMD | 15:10 ET | 100.0 | 1 | 5 min | 2 min |
| AMZN | 16:50 ET | 100.0 | 1 | 34 min | 5 min |
| CRWV | 16:50 ET | 99.1 | 2 | 16 min | 2 min |
| NVDA | 16:50 ET | 100.0 | 1 | 16 min | 12 min |
| PLTR | 16:50 ET | 95.8 | 1 | 18 min | 2 min |
| QQQ | 16:50 ET | 85.3 | 3 | 12 min | 6 min |
| TSLA | 16:50 ET | 100.0 | 1 | 15 min | 6 min |
| SOFI | 16:51 ET | 100.0 | 1 | 16 min | 4 min |
| IBIT | 17:08 ET | 100.0 | 1 | 20 min | 5 min |
| TSLA | 17:15 ET | 88.7 | 1 | 9 min | 4 min |

### Reached EMERGING but never IN PLAY

AAL, AAPL, GLD, GOOGL, IBM, INTC, MSFT, MSTR, MU, NBIS, NKE, ORCL, PANW, PYPL, SLV, UNH

### Quiet stretches — no names IN PLAY

- 09:30–10:58 ET
- 11:07–11:09 ET
- 11:11–11:19 ET
- 11:29–11:31 ET
- 11:36–11:45 ET
- 11:48–15:12 ET
- 15:14–16:00 ET

### Cluster compaction and override changes

- 10:59 ET · IN PLAY: +1 more in semis
- 11:00 ET · IN PLAY: +2 more in semis
- 11:02 ET · IN PLAY: +4 more in semis
- 11:04 ET · IN PLAY: +2 more in semis

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
| LLY | 10:20 ET | 100.0 | 1 | 14 min | 5 min |
| PLTR | 13:43 ET | 100.0 | 1 | 4 min | 2 min |
| BE | 13:58 ET | 98.9 | 1 | 5 min | 2 min |
| ORCL | 14:58 ET | 95.8 | 1 | 4 min | 2 min |
| SMCI | 16:01 ET | 100.0 | 1 | 11 min | 2 min |
| AMD | 16:15 ET | 100.0 | 1 | 36 min | 16 min |

### Reached EMERGING but never IN PLAY

AAL, AVGO, CRWV, GDX, GOOGL, HOOD, IBIT, INTC, MSTR, MU, NBIS, NVDA, PANW, PYPL, QQQ, SNAP, SNDK, SOFI, TSLA, UNH

### Quiet stretches — no names IN PLAY

- 09:30–10:28 ET
- 10:33–13:44 ET
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
| SLV | 08:58 ET | 100.0 | 1 | 22 min | 2 min |
| AAPL | 12:48 ET | 100.0 | 1 | 229 min | 2 min |
| INTC | 12:49 ET | 100.0 | 1 | 6 min | 3 min |
| AMAT | 12:54 ET | 99.2 | 9 | 6 min | 2 min |
| SMCI | 12:54 ET | 100.0 | 1 | 188 min | 2 min |
| AMZN | 12:55 ET | 94.4 | 4 | 190 min | 3 min |
| GDX | 12:57 ET | 100.0 | 1 | 203 min | 8 min |
| PANW | 12:57 ET | 98.6 | 4 | 3 min | 1 min |
| SMH | 12:57 ET | 95.2 | 1 | 186 min | 2 min |
| SPY | 12:57 ET | 94.7 | 12 | 185 min | 3 min |
| MSFT | 12:58 ET | 100.0 | 3 | 221 min | 7 min |

### Reached EMERGING but never IN PLAY

ADBE, ARM, AVGO, BE, COIN, CRWD, GLD, HOOD, IBIT, IBM, IWM, KLAC, LLY, META, MSTR, MU, QCOM, TSLA, USO

### Quiet stretches — no names IN PLAY

- 09:30–12:50 ET
- 12:53–12:55 ET
- 12:57–12:58 ET

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
| AAPL | 08:50 ET | 94.1 | 1 | 7 min | 2 min |

### Reached EMERGING but never IN PLAY

AMAT, AMD, AMZN, ARM, BE, COIN, CRWV, GDX, GOOGL, HOOD, IWM, LLY, META, MSFT, MSTR, MU, NBIS, NFLX, NVDA, PLTR, PYPL, QQQ, SMCI, SNDK, SOFI, SPY, TSLA, UNH

### Quiet stretches — no names IN PLAY

- 09:30–16:00 ET

### Cluster compaction and override changes

None.

