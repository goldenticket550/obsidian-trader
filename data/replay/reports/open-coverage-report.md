# Phase OPEN-COVERAGE report

## Scope

Data-contract repair only. No score formula, normalization curve, threshold, persistence, or state-transition value changed.

## Warm-up rule found

The former builder initialized within each one-day artifact:

```ts
const completedTrueRanges: number[] = [];
let previousBucketClose: number | null = null;
const atrValues = [...completedTrueRanges.slice(-13), trueRange(partialBucket, previousBucketClose)];
const atr = atrValues.length >= 14 ? sum / 14 : null;
```

It could consume same-day premarket prints, but could not cross the artifact/session boundary. Separately, `rangeAtr` and `pathEfficiency` consume the rolling current minute plus the prior four one-minute slots; `pathEfficiency` stays null when total path is below `0.1 * ATR`. The replacement uses 13 completed five-minute true ranges from the prior regular session only as an ATR fallback until 14 same-session ranges exist, and bridges missing 09:26-09:29 rolling-window slots with the final prior-session regular one-minute bars. Current-session prints always win and the bridge expires after 09:34. The first chronological current-session print measures true range against the prior regular close only on the fallback path, so the overnight gap is represented exactly once; no synthetic overnight bar or volume is imputed.

## Identity consequences

- Baseline table: `0a7f4c0b9b8dfe5f0c533541acd144b6436362e465ff3d870ca6542f580ef770` -> `0bdc723e1df978fce3842255a31997e0f1b40d4f3f6c4ed85f6024b2eb817775`
- Universe: `3366aa05771ddbdc321b9aa44ecff3e907e6c91fdf417bc62695a06d480e24a2` -> `da45bb8793968392c2f872da51bc33caa9331a17251426badde96c5e12b077f7`
- IEX regular calibration: `mode-map-v3:measure-v1:curve-v3:state-v3:iex_partial:regular:population-82f216fdd69d` -> `mode-map-v3:measure-v1:curve-v3:state-v3:iex_partial:regular:population-492b6bc31e5e`
- Existing checkpoint: incompatible and intentionally rejected before restart.
- Numerical curve/threshold change: **no**

## Coverage sample

| ET | Before | After |
|---:|---:|---:|
| 09:30 | 0 | 61 |
| 09:35 | 0 | 61 |
| 09:40 | 0 | 61 |
| 09:55 | 3 | 61 |
| 10:00 | 5 | 61 |
| 10:15 | 14 | 61 |
| 10:30 | 30 | 61 |
| 10:35 | 52 | 61 |
| 11:00 | 52 | 61 |
| 12:00 | 52 | 61 |
| 13:00 | 52 | 61 |
| 14:00 | 51 | 61 |
| 15:00 | 52 | 61 |
| 15:59 | 52 | 61 |

The complete 390-minute curve is in `open-coverage-curve.csv`. Opening coverage is 61/61; midday peak is 61/61.

## Equivalence

- Warm-up-only comparison over 2026-08-14: 11941 previously scoreable symbol-minutes; max absolute attention delta **0**.
- Historical/live 09:30 comparison (SPY, 2026-08-14): live 9.55799617837163, historical 9.55799617837163, absolute delta **0**.

## Never-scoreable after both repairs

None.

## Affected-symbol evidence

- **SPY**: corpus scoreable rows 15414; regular IEX bars across 40 sessions 15401; max pPresent 1; unavailable buckets {"volume":0,"dollarVolume":0,"rangeAtr":0,"pathEfficiency":0,"stockMagnitude":0,"sectorMagnitude":0}.
- **QQQ**: corpus scoreable rows 15466; regular IEX bars across 40 sessions 15359; max pPresent 1; unavailable buckets {"volume":0,"dollarVolume":0,"rangeAtr":0,"pathEfficiency":0,"stockMagnitude":0,"sectorMagnitude":0}.
- **IWM**: corpus scoreable rows 15291; regular IEX bars across 40 sessions 15244; max pPresent 1; unavailable buckets {"volume":0,"dollarVolume":0,"rangeAtr":0,"pathEfficiency":0,"stockMagnitude":0,"sectorMagnitude":0}.
- **SMH**: corpus scoreable rows 14205; regular IEX bars across 40 sessions 14208; max pPresent 1; unavailable buckets {"volume":0,"dollarVolume":0,"rangeAtr":0,"pathEfficiency":0,"stockMagnitude":0,"sectorMagnitude":0}.
- **GLD**: corpus scoreable rows 13130; regular IEX bars across 40 sessions 13158; max pPresent 1; unavailable buckets {"volume":0,"dollarVolume":0,"rangeAtr":0,"pathEfficiency":0,"stockMagnitude":0,"sectorMagnitude":0}.
- **SLV**: corpus scoreable rows 14271; regular IEX bars across 40 sessions 14278; max pPresent 1; unavailable buckets {"volume":0,"dollarVolume":0,"rangeAtr":0,"pathEfficiency":0,"stockMagnitude":0,"sectorMagnitude":0}.
- **IBIT**: corpus scoreable rows 15359; regular IEX bars across 40 sessions 15038; max pPresent 1; unavailable buckets {"volume":0,"dollarVolume":0,"rangeAtr":0,"pathEfficiency":0,"stockMagnitude":0,"sectorMagnitude":0}.
- **DRAM**: corpus scoreable rows 3383; regular IEX bars across 40 sessions 4313; max pPresent 1; unavailable buckets {"volume":0,"dollarVolume":0,"rangeAtr":0,"pathEfficiency":0,"stockMagnitude":0,"sectorMagnitude":0}.
- **SPCX**: corpus scoreable rows 1170; regular IEX bars across 40 sessions 1564; max pPresent 1; unavailable buckets {"volume":0,"dollarVolume":0,"rangeAtr":0,"pathEfficiency":0,"stockMagnitude":0,"sectorMagnitude":0}.
