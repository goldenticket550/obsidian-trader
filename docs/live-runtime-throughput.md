# Live runtime throughput contract

The accelerated 390-minute mock soak is a sequencing test only. It omits provider and production processor work and is not throughput acceptance evidence.

## Measured unoptimized cycle

Real free-IEX REST poll, 68 symbols, 40 historical baseline sessions, completed minute 2026-08-18 14:56 ET:

| Stage | Wall time |
|---|---:|
| Provider fetch | 3,079.97 ms |
| Bar reconciliation | 4.90 ms |
| Baseline resolution | 12,647.19 ms |
| Axis computation | 422.62 ms |
| Scoring | 0.28 ms |
| State machine | 13.96 ms |
| Episode/event | 0.14 ms |
| Atomic checkpoint + snapshot commit | 4.07 ms |
| Separate snapshot publish | 0 ms (not a separate physical operation in the local store) |
| Total cycle | 17,004.27 ms |

Baseline reconstruction consumed 74.4% of the cycle. Gap recovery multiplied that work once for every missing minute and was the cause of the stalled watermark.

## Published correction

`iex-live-baseline-table.json` is built once from the 40-session IEX calibration corpus. It contains one fitted baseline record per tradeable symbol and regular-session minute. The worker loads the table once and performs direct lookups; it never rebuilds archive medians or MADs in the per-minute path.

- Table identity: `0a7f4c0b9b8dfe5f0c533541acd144b6436362e465ff3d870ca6542f580ef770`
- Sessions: 40
- Buckets: 23,790 (61 tradeable × 390 regular-session minutes)
- Build time: 9,392.30 ms
- Feed/adjustment: `iex_partial` / `split`

The table ID is part of `RuntimeIdentity`, the durable checkpoint, and the processor checkpoint. A changed or corrupted table fails restart compatibility rather than silently reusing state.

## Same-batch equivalence and speed

On the same real IEX batch at 2026-08-18 15:05 ET:

- Dynamic processor: 14,607.31 ms
- Static-table processor: 458.22 ms
- Speedup: 31.88×
- Scored rows: 41 vs 41
- Score/core differences: 0
- Static baseline lookup: 0.32 ms

## Operational budget

- A completed cycle logs the full stage breakdown with every heartbeat.
- A cycle above 20 seconds emits `cycle_budget_breach` and marks runtime health degraded.
- A cycle crossing a minute boundary, or a watermark more than 60 seconds late, emits `watermark_lag_warning` and is shown prominently in the dashboard.
- Local persistence is one atomic checkpoint+snapshot commit. It is reported under checkpoint write; separate snapshot publish is correctly recorded as zero.
- A full-session acceptance requires 390/390 real regular-session heartbeats, cycle p50/p95/max, maximum watermark lag, restart count, and no unexplained gaps. The mock sequencing test cannot satisfy this contract.

No threshold, universe, or scoring configuration changed. No subscription, deployment, or migration was performed.
