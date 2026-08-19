# Attention runtime full-session liveness

This is an operational liveness report, not ground-truth scanner validation.

- Trading date: 2026-08-18 (regular)
- Status: **FAIL_INCOMPLETE_SESSION**
- Heartbeat coverage: 48/390 minutes (12.31%)
- First completed minute: 2026-08-18T19:11:00.000Z
- Last completed minute: 2026-08-18T19:59:00.000Z
- Maximum consecutive missing minutes: 341
- Maximum completion lag: 107.8 seconds
- Maximum logged watermark lag: 47.7 seconds
- Cycle time p50 / p95 / max: 4444.1 / 6637.9 / 6834.8 ms
- Worker exits during session: 16
- Persistent supervised restart count: 20

A full-session pass requires one heartbeat for every scheduled regular-session minute. Process presence alone does not count as uptime.
