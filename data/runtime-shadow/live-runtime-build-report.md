# Live Attention runtime — local shadow build report

Status: **RUNNING LOCALLY IN SHADOW MODE.** This is not deployed. The Supabase migration was designed but not applied. No paid data subscription was purchased. Attention delivery is disabled and the legacy alert engine remains enabled.

## Final authenticated free-IEX cycle

- Continuous-worker verification minute: 2026-08-18 11:54 ET
- Checkpoint sequence: verified through 9, restored across separate worker processes; a 90-second lease-expiry defect found at sequence 5 was fixed with reconciliation heartbeats, then sequences 6 and 7 advanced normally
- Ingestion: `iex_rest_polling`, one explicit `feed=iex`, `adjustment=split`, 68-symbol `getCandlesMulti` path
- Universe: 68 fetched = 61 tradeable + 7 reference-only; reference-only symbols did not rank
- Health/readiness: `ready=true`, guard clear
- Scored at sequence 7 sample: 40 tradeable symbols
- Explicitly `insufficient_reference` at sequence 7 sample: 21. This set changes minute to minute with IEX prints; unavailable is never represented as quiet.
- Attention events stored: 0
- Delivery envelopes: 0
- Runtime controls: Attention delivery off; legacy on

The unavailable rows are not interpreted as quiet. At that IEX minute they lacked a synchronized target/benchmark/sector observation with a usable same-time baseline. IEX Participation remains display-only and carries zero scoring weight. Volume-derived ACCELERATION is disabled under Path B.

## WebSocket entitlement probe

The authenticated account acknowledged all 68 requested IEX bar subscriptions. That contradicts the published Basic-plan limit of 30. The acknowledgement is evidence of current account behavior, not evidence of a durable entitlement or SIP access. The free shadow runtime therefore conservatively uses complete-universe REST polling; it never runs a partial WebSocket universe and never shards around a limit.

## Delivery

- PRIMARY `NOW_IN_PLAY`: individual delivery within the four-envelope rolling 15-minute budget; PRIMARY overflow digest retained; material override applies only to PRIMARY.
- SECONDARY `KEY_LEVEL_EVENT` / `ACCELERATION`: never individual; one digest per 15-minute collection window.
- Digest rows are updateable only while pending and become notifier-eligible when the window closes.
- The native Windows desktop notifier is the out-of-band consumer. It checks §0.7 controls before leasing, preserves tiers, retries with bounded backoff, and retains terminal failures.
- The dashboard reads durable snapshots through `/api/attention/live`; it does not advance engine state.

## Recovery and safety

Lease fencing, checksum/config/universe/calibration compatibility, complete A3/Event state restoration, idempotent event/outbox writes, watermark gap replay, inferred IEX halt/resume guarding, and no-catch-up-alert recovery are implemented. Five nonregular IEX windows remain dark as `unavailable_on_partial_feed`.

Verification: TypeScript passed. Full suite: 123 files, 1,558 tests passed; the post-heartbeat runtime suite also passed. At sequence 7 the mutable live artifacts hashed to `6a2eeb5e4314c770720639f0da5204f1639bbc6e47985c451091466e385c100b` (last run) and `46cebbb398f47ac985e9679e2a34501545a0bb291cb17779a3e294b1b08bb572` (state). They continue changing while the worker runs.

> Timing statistics derived from historical pulls assume instantaneous bar availability. Real arrival latency is not represented. Human-relative latency and move-capture figures are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.
