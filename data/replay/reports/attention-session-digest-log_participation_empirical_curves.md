# Attention Engine — five-session digest (log_participation_empirical_curves)

> This is a description of what the replay engine did. It is not a performance, hit-rate, latency, move-capture, discovery-quality, or correctness evaluation.

> Timing statistics derived from historical pulls assume instantaneous bar availability. Real arrival latency is not represented. Human-relative latency and move-capture figures are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.

Feed: `sip`. Saturation treatment: `log_participation_empirical_curves`; EXPERIMENTAL, NOT PUBLISHED. Rows are ordered by attention velocity in WAKING UP and attention score in IN PLAY. State is membership metadata.
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
| IBIT | 04:20 ET | 100.0 | 1 | 14 min | 6 min |
| IBIT | 04:20 ET | 100.0 | 1 | 39 min | 6 min |
| NKE | 10:45 ET | 100.0 | 2 | 5 min | 2 min |
| GLD | 10:46 ET | 100.0 | 1 | 6 min | 4 min |
| GDX | 10:47 ET | 100.0 | 1 | 6 min | 2 min |
| SMCI | 11:27 ET | 99.6 | 1 | 5 min | 2 min |
| CRM | 11:56 ET | 100.0 | 1 | 4 min | 2 min |
| XOM | 12:35 ET | 100.0 | 1 | 4 min | 2 min |
| IBIT | 12:37 ET | 100.0 | 1 | 4 min | 2 min |
| AMD | 13:58 ET | 100.0 | 1 | 8 min | 2 min |
| SMH | 13:58 ET | 100.0 | 1 | 7 min | 3 min |
| TSM | 13:58 ET | 100.0 | 1 | 13 min | 5 min |

### Reached EMERGING but never IN PLAY

AMAT, ARM, BE, CRWV, DELL, INTC, IWM, LLY, META, MU, NVDA, PANW, PLTR, PYPL, QQQ, SLV, SNAP, SOFI, SPY, TSLA, WDC

### Quiet stretches — no names IN PLAY

- 09:30–10:47 ET
- 10:51–11:29 ET
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
| COIN | 100.0 | 25.77 | IN_PLAY | Extended | 0.66 |
| CRWV | 100.0 | 29.11 | IN_PLAY | Extended | 1.09 |
| QCOM | 100.0 | 23.77 | IN_PLAY | Extended | 1.50 |
| SMH | 100.0 | 6.64 | IN_PLAY | Extended | 2.80 |
| SOFI | 100.0 | 29.11 | IN_PLAY | Extended | 1.06 |
| USO | 100.0 | 29.85 | IN_PLAY | Mature | 0.72 |
| SPY | 100.0 | 1.02 | IN_PLAY | Extended | 3.29 |
| IWM | 99.0 | 4.40 | IN_PLAY | Extended | 2.63 |
| NVDA | 98.1 | 17.25 | IN_PLAY | Extended | 1.34 |
| TSM | 94.2 | 18.64 | IN_PLAY | Extended | 0.11 |

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
| QQQ | 05:00 ET | 97.8 | 1 | 6 min | 4 min |
| AAPL | 10:57 ET | 100.0 | 1 | 9 min | 3 min |
| AMD | 10:57 ET | 100.0 | 2 | 8 min | 3 min |
| AMZN | 10:57 ET | 100.0 | 1 | 10 min | 7 min |
| HOOD | 10:57 ET | 100.0 | 5 | 7 min | 2 min |
| IBIT | 10:57 ET | 100.0 | 7 | 8 min | 5 min |
| IWM | 10:57 ET | 100.0 | 2 | 11 min | 8 min |
| QQQ | 10:57 ET | 99.8 | 5 | 10 min | 8 min |
| QQQ | 10:57 ET | 99.8 | 2 | 15 min | 2 min |
| SMH | 10:57 ET | 100.0 | 2 | 14 min | 7 min |
| SPY | 10:57 ET | 100.0 | 4 | 10 min | 8 min |
| ARM | 10:58 ET | 100.0 | 2 | 8 min | 2 min |
| AVGO | 10:58 ET | 100.0 | 2 | 8 min | 2 min |
| COIN | 10:58 ET | 100.0 | 3 | 7 min | 4 min |
| CRWV | 10:58 ET | 100.0 | 4 | 6 min | 4 min |
| DELL | 10:58 ET | 100.0 | 4 | 11 min | 2 min |
| META | 10:58 ET | 100.0 | 5 | 8 min | 3 min |
| MRVL | 10:58 ET | 100.0 | 9 | 8 min | 2 min |
| NVDA | 10:58 ET | 100.0 | 2 | 9 min | 6 min |
| QCOM | 10:58 ET | 100.0 | 3 | 8 min | 6 min |
| SMCI | 10:58 ET | 100.0 | 14 | 7 min | 2 min |
| SOFI | 10:58 ET | 100.0 | 8 | 8 min | 3 min |
| TSLA | 10:58 ET | 100.0 | 4 | 8 min | 3 min |
| TSM | 10:58 ET | 100.0 | 1 | 10 min | 8 min |
| USO | 10:59 ET | 100.0 | 7 | 5 min | 3 min |
| WMT | 11:15 ET | 100.0 | 5 | 8 min | 2 min |
| WMT | 11:15 ET | 100.0 | 1 | 15 min | 3 min |
| AMZN | 11:17 ET | 100.0 | 1 | 11 min | 8 min |
| SMH | 11:17 ET | 100.0 | 2 | 10 min | 7 min |
| NVDA | 11:18 ET | 100.0 | 2 | 9 min | 6 min |
| QCOM | 11:18 ET | 100.0 | 3 | 10 min | 2 min |
| QQQ | 11:18 ET | 93.8 | 8 | 5 min | 2 min |
| SPY | 11:18 ET | 94.0 | 9 | 8 min | 2 min |
| TSM | 11:18 ET | 100.0 | 5 | 5 min | 2 min |
| COIN | 11:31 ET | 100.0 | 1 | 6 min | 2 min |
| TSLA | 11:31 ET | 100.0 | 2 | 6 min | 4 min |
| QQQ | 11:44 ET | 83.1 | 6 | 4 min | 2 min |
| AMD | 15:10 ET | 100.0 | 1 | 5 min | 2 min |
| IBIT | 16:44 ET | 100.0 | 1 | 54 min | 18 min |
| SPY | 16:47 ET | 99.2 | 3 | 13 min | 6 min |
| IWM | 16:48 ET | 87.9 | 3 | 32 min | 7 min |
| INTC | 16:49 ET | 89.4 | 1 | 16 min | 6 min |
| AAPL | 16:50 ET | 78.5 | 3 | 18 min | 8 min |
| AMD | 16:50 ET | 95.3 | 2 | 13 min | 10 min |
| AMD | 16:50 ET | 95.3 | 1 | 32 min | 3 min |
| AMZN | 16:50 ET | 92.4 | 1 | 34 min | 8 min |
| CRWV | 16:50 ET | 100.0 | 1 | 16 min | 8 min |
| NBIS | 16:50 ET | 87.4 | 4 | 20 min | 5 min |
| NVDA | 16:50 ET | 100.0 | 1 | 16 min | 12 min |
| PLTR | 16:50 ET | 100.0 | 1 | 18 min | 6 min |
| QQQ | 16:50 ET | 96.7 | 2 | 13 min | 10 min |
| TSLA | 16:50 ET | 100.0 | 1 | 11 min | 6 min |
| TSLA | 16:50 ET | 100.0 | 1 | 23 min | 2 min |
| SOFI | 16:51 ET | 100.0 | 1 | 17 min | 8 min |
| SOFI | 16:51 ET | 100.0 | 1 | 43 min | 11 min |
| HOOD | 17:05 ET | 91.0 | 1 | 9 min | 4 min |
| NVDA | 17:38 ET | 100.0 | 1 | 42 min | 5 min |
| AMD | 18:02 ET | 100.0 | 1 | 11 min | 2 min |
| TSLA | 18:07 ET | 100.0 | 2 | 8 min | 3 min |
| QQQ | 18:08 ET | 93.4 | 1 | 7 min | 5 min |
| INTC | 18:10 ET | 100.0 | 1 | 9 min | 2 min |

### Reached EMERGING but never IN PLAY

AAL, AMAT, GLD, GOOGL, IBM, MSFT, MSTR, MU, NKE, ORCL, PANW, PYPL, SLV

### Quiet stretches — no names IN PLAY

- 09:30–10:58 ET
- 11:07–11:09 ET
- 11:11–11:19 ET
- 11:29–11:32 ET
- 11:36–11:45 ET
- 11:47–15:12 ET
- 15:14–16:00 ET

### Cluster compaction and override changes

- 10:59 ET · IN PLAY: +1 more in semis
- 11:00 ET · IN PLAY: +2 more in semis
- 11:02 ET · IN PLAY: +4 more in semis; +1 more in megacap_tech
- 11:04 ET · IN PLAY: +1 more in semis

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
| PLTR | 08:12 ET | 82.7 | 1 | 9 min | 2 min |
| LLY | 10:20 ET | 100.0 | 1 | 14 min | 5 min |
| AAL | 13:36 ET | 100.0 | 1 | 5 min | 2 min |
| PLTR | 13:43 ET | 100.0 | 1 | 4 min | 2 min |
| BE | 13:58 ET | 100.0 | 1 | 5 min | 2 min |
| ORCL | 14:58 ET | 98.4 | 1 | 4 min | 2 min |
| SMCI | 16:01 ET | 100.0 | 1 | 11 min | 5 min |
| AMD | 16:15 ET | 100.0 | 1 | 36 min | 19 min |
| SMCI | 16:15 ET | 65.9 | 1 | 22 min | 2 min |
| NBIS | 16:26 ET | 84.8 | 1 | 15 min | 4 min |
| HOOD | 16:35 ET | 97.9 | 1 | 8 min | 2 min |
| AMD | 19:54 ET | 84.4 | 1 | 6 min | 3 min |

### Reached EMERGING but never IN PLAY

AMZN, GOOGL, IBIT, INTC, META, MSTR, MU, NVDA, PANW, PYPL, QQQ, SNAP, SNDK, SOFI, SPY, TSLA

### Quiet stretches — no names IN PLAY

- 09:30–10:28 ET
- 10:33–13:38 ET
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
| IBIT | 08:47 ET | 93.8 | 1 | 6 min | 2 min |
| SLV | 08:58 ET | 100.0 | 1 | 12 min | 2 min |
| SLV | 08:58 ET | 100.0 | 1 | 21 min | 3 min |
| AAPL | 12:48 ET | 100.0 | 1 | 229 min | 2 min |
| INTC | 12:49 ET | 100.0 | 2 | 6 min | 2 min |
| SMCI | 12:54 ET | 100.0 | 2 | 188 min | 2 min |
| AMZN | 12:55 ET | 96.4 | 4 | 190 min | 3 min |
| GDX | 12:57 ET | 100.0 | 1 | 203 min | 7 min |
| PANW | 12:57 ET | 97.1 | 3 | 3 min | 1 min |
| SMH | 12:57 ET | 98.1 | 2 | 186 min | 2 min |
| SPY | 12:57 ET | 97.0 | 8 | 185 min | 2 min |
| IWM | 12:58 ET | 98.5 | 2 | 206 min | 3 min |
| MSFT | 12:58 ET | 98.1 | 3 | 221 min | 7 min |

### Reached EMERGING but never IN PLAY

ADBE, AMAT, ARM, AVGO, COIN, CRWD, GLD, IBM, KLAC, LLY, META, MSTR, MU, QCOM, TSLA

### Quiet stretches — no names IN PLAY

- 09:30–12:51 ET
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
| IWM | 08:24 ET | 78.0 | 2 | 11 min | 3 min |
| COIN | 08:26 ET | 100.0 | 1 | 18 min | 4 min |
| NVDA | 08:29 ET | 100.0 | 1 | 6 min | 3 min |
| MU | 08:30 ET | 100.0 | 1 | 6 min | 3 min |
| SNDK | 08:30 ET | 94.1 | 1 | 8 min | 2 min |
| SNDK | 08:43 ET | 100.0 | 1 | 13 min | 3 min |
| MU | 08:48 ET | 87.7 | 2 | 8 min | 5 min |
| AAPL | 08:50 ET | 100.0 | 1 | 10 min | 6 min |

### Reached EMERGING but never IN PLAY

AMAT, AMD, AMZN, AVGO, BE, CRWV, GDX, GLD, GOOGL, HOOD, IBIT, LLY, META, MSFT, MSTR, NBIS, PLTR, QQQ, SMCI, SMH, SOFI, SPY, TSLA, UNH

### Quiet stretches — no names IN PLAY

- 09:30–16:00 ET

### Cluster compaction and override changes

None.

