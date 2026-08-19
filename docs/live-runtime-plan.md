# Live Runtime — reviewed plan and local shadow build

Status: **BUILD ITEMS 1–7 IMPLEMENTED LOCALLY IN SHADOW MODE — NOT DEPLOYED.** Phase C is complete. Phase E is not started. No paid feed was purchased and migration `0010_attention_live_runtime.sql` is review-only and unapplied.

## 1. Fixed runtime decisions

- A dedicated always-on worker owns ingestion, completed-minute ordering, quality guards, Attention Engine state, checkpoints, detection, delivery compaction, and snapshot publication.
- Next.js is an authenticated dashboard/control surface. It reads durable worker output; it never advances live engine state.
- Supabase is the durable handoff. A single-writer lease with a fencing token prevents two workers from publishing the same engine instance.
- Initial feed mode is `iex_partial`, regular session only. Five nonregular windows remain visibly `unavailable_by_construction`.
- Target host is **Railway Hobby**, subject to a one-week shadow cost measurement before any deployment decision.
- Initial out-of-band channel is a **native desktop notifier** consuming the durable outbox. Browser notification is supplementary, not sufficient by itself.
- Legacy alerts remain active during shadow operation. Attention and legacy never share a delivery channel or appear under the same visual identity.
- Live Attention alerting is fail-closed and defaults off.

```text
Alpaca IEX stream OR getCandlesMulti polling
                    |
                    v
          always-on attention worker
 ingest -> reconcile -> score -> state -> detect -> tier/compact
                    |                         |
                    +--------- Supabase ------+
                                  |
                   +--------------+---------------+
                   v                              v
           Next.js dashboard              desktop notifier
```

## 2. Work packages

### LR1 — typed worker shell, host, and ownership

- Add a separate long-running worker entry point. Validate provider, feed, adjustment, universe hash, calibration identity, calendar version, Supabase credentials, ingestion capability, and rollback state before readiness.
- Acquire a renewable single-writer lease. Every write carries `engineInstanceId`, `runId`, checkpoint sequence, and fencing token. A stale writer cannot commit after losing the lease.
- Process one canonical completed minute at a time. Fetch all 68 symbols; the seven reference-only symbols feed Idiosyncrasy but never rank or emit candidates.
- Separate liveness from readiness. Readiness requires the lease, exact identities, provider capability, a valid calendar, and restored or initialized state.

**Hosting recommendation and cost.** Use Railway Hobby for the first shadow deployment. Current Railway pricing is a $5/month minimum with $5 included resource usage; RAM is $10/GB-month, CPU $20/vCPU-month, and egress $0.05/GB. At an illustrative 0.5 GB and 0.1 sustained vCPU, regular-session operation for roughly 152 hours/month is about $1.46 of resource usage; 04:00–20:15 ET weekday operation is about $3.43. Both fit inside the $5 minimum. The same illustrative footprint running 24/7 is about $7/month before egress. These are planning estimates, not a quote: measure one shadow week, set a Railway usage alert/hard budget, and publish actual CPU/RAM/egress before authorizing continuous operation. Pricing source: https://docs.railway.com/pricing/plans.

Exit gate: two workers cannot both write; forced restart cannot duplicate a minute, episode, event, or envelope; measured cost is reported before any deployment authorization.

### LR2 — capability-negotiated live ingestion

#### Verified account result

On 2026-08-18 an authenticated probe connected to `wss://stream.data.alpaca.markets/v2/iex`, authenticated, and requested one-minute bars for the exact 68-symbol authored universe. Alpaca acknowledged a subscription containing all 68 symbols. No order, subscription purchase, or account mutation occurred.

This conflicts with Alpaca's published Basic-plan table, which currently states a 30-symbol WebSocket limit (https://docs.alpaca.markets/us/docs/about-market-data-api). Therefore neither the documented Basic limit nor today's permissive account behavior is a safe architectural constant. `ALPACA_PAID_PLAN=false` also remains unchanged; accepting 68 IEX symbols is not evidence of SIP entitlement.

At every startup the worker must capability-negotiate the exact universe:

1. Authenticate to IEX and request all 68 bar subscriptions.
2. Require an acknowledgement containing every symbol within a deadline.
3. If complete, select `iex_websocket` for that run and record the acknowledged symbol set.
4. If rejected, partial, timed out, or later revoked, select `iex_rest_polling`; never run a partial universe and never shard around an entitlement limit with multiple connections.

#### WebSocket failure surface

- Retain raw provider payload and receipt time in an append-only ingestion log.
- Buffer by provider timestamp; deduplicate `(feed, symbol, timeframe, barStart)` and commit completed minutes only.
- On connection/auth/subscription failure or staleness, mark degraded, stop affected decisions, reconnect with bounded backoff, and historical-backfill from the durable watermark.
- Keep the backfill guard active until reconciliation proves a contiguous clean window. State may recover; alerts and cross-gap velocity behavior remain suppressed.

#### REST-polling failure surface

- Poll one-minute bars with mandatory `getCandlesMulti`, all 68 symbols, explicit `feed=iex` and `adjustment=split`. Expected load is roughly 1–2 requests/minute, well below 200/minute.
- Schedule against completed provider minutes, not wall-clock guesses. Each result must prove the requested symbol/time range and feed; partial batches are unavailable, not zero volume.
- Treat deadline, 429, 5xx, authentication, partial-response, missing-minute, and stale-latest-bar failures explicitly. Retry with bounded backoff and jitter, then re-poll the missing interval.
- REST has no reconnect state. Its equivalent guards are `poll_failed`, `poll_stale`, `partial_batch`, and `gap_reconciliation`; alerting remains suppressed until the same contiguous-window criterion passes.
- Historical polling cannot measure true bar-arrival latency. Its timestamps remain optimistically biased and cannot validate live arrival fidelity.

Both modes write the same canonical completed-bar contract and must produce identical engine hashes for identical bars. A mode switch is audited and activates the data-quality/backfill guard; it cannot silently alter feed mode or calibration identity.

Exit gate: deterministic tests cover both failure surfaces separately. WebSocket tests cover disconnect/auth/partial subscription/reconnect; REST tests cover timeouts/429/5xx/partial batch/staleness/re-poll. A cross-mode fixture proves identical completed bars yield identical engine output.

### LR3 — IEX operating envelope and inferred halts

- Runtime feed mode is `iex_partial`: Participation is display-only and labelled `IEX PARTIAL`; Path B core uses Displacement and Idiosyncrasy; Participation scoring and volume-derived acceleration are disabled.
- Score only with the IEX regular calibration. `premarket_early`, `premarket_core`, `premarket_final`, `after_hours_core`, and `after_hours_late` remain `unavailable_by_construction`.
- Publish **Unavailable on partial feed** (`insufficient_reference`) in those windows. Publish no score, quiet-state claim, candidate, event, or SIP fallback.
- A feed-mode or calibration-identity change stops scoring until an exact calibrated set exists.

Until SIP trading-status messages are available, §3.18 halt inference is active on IEX. A qualifying zero-volume/no-print run followed by a gapped resume produces data-quality state `halt_inferred` and then `resume_inferred`. It must never be labelled a confirmed exchange halt. The resume window keeps the halt/resume acceleration guard active so the restart discontinuity cannot emit ACCELERATION. A later SIP status message may classify a halt as confirmed, but inference is retained in the audit trail.

Exit gate: a full calendar-day test proves regular-only scoring and five dark windows. Halt tests distinguish inferred from confirmed, keep the resume guard active for its configured window, and never reinterpret an ordinary sparse bucket as a confirmed halt.

### LR4 — durable state and restart recovery

- Separate immutable ingestion/event records from replaceable current snapshots. Checkpoints include history, smoothed cores, pending transitions, episodes/cooling, Market Map, event identities/cooldowns, pending alerts, tiered compaction windows, quality guards, watermarks, ingestion mode, and exact configuration/calibration/universe identities.
- Checkpoint at completed-minute boundaries transactionally with that minute's snapshot and outbox rows. Use deterministic idempotency keys.
- On restart, verify checksum and identities, reconcile after the watermark, and replay forward before readiness. Corrupt/incompatible state fails closed; never start empty mid-session.
- Retain enough checkpoints/raw minutes for incident replay. Retention is a later decision; the first release has no destructive pruning job.

Exit gate: kill/restart at pre-open, mid-minute, poll/stream recovery, pending alert, and compaction points reproduces uninterrupted hashes, event IDs, and tiered envelopes.

### LR5 — Supabase handoff and delivery outbox (migration designed, not applied)

Design a new migration for review only. Do not overload legacy `scan_snapshots` or `alert_events`.

- `attention_engine_instances`: scope, identities, ingestion mode, lease/fencing token, heartbeat/readiness, health, last minute.
- `attention_engine_checkpoints`: sequence, watermark, schema version, identities, checksum, state blob.
- `attention_live_snapshots`: current ranking, badges, dark-window status, as-of minute, staleness.
- `attention_events`: immutable qualifying payload/timestamps, identity, suppression/audit data.
- `attention_delivery_outbox`: immutable envelope payload plus tier, idempotency key, status (`pending | leased | delivered | retrying | failed`), attempt count, next attempt, last error, provider acknowledgement, and delivered time.
- `attention_ingestion_audit`: capability probe, modes, gaps, request/connection failures, backfills, duplicates, late bars, inferred/confirmed halt state, and integrity failures.
- `attention_runtime_controls`: versioned rollback and engine-coexistence controls.

Detection is stored before delivery. Tiering is fixed:

- **PRIMARY — NOW_IN_PLAY:** existing four-envelope/rolling-15-minute budget, normally individual, with the existing overflow digest. Material override applies only to PRIMARY.
- **SECONDARY — KEY_LEVEL_EVENT and ACCELERATION:** never individual; at most one update-in-place digest starts per rolling 15 minutes, and it lists every secondary event in that window.

Worker writes use service-role scope; dashboard/notifier reads use narrowly scoped RLS or a dedicated authenticated API. Supabase Realtime may prompt reads but durable cursor-based reads remain authoritative.

Exit gate: schema/RLS review, local migration test, idempotency tests, and restore test. Application requires separate authorization.

### LR6 — dashboard plus out-of-band delivery consumer

#### Dashboard

- Replace Attention's client-triggered scans with authenticated snapshot reads. Poll first; Realtime may prompt refresh but is not truth.
- Render `asOf`, heartbeat, ingestion mode, feed/calibration identity, recovery health, rollback/legacy state, and staleness. Freeze and mark stale data rather than presenting it as live.
- Keep score ordering and state badges. Display caps remain presentation-only.
- Render **Unavailable on partial feed** in the five nonregular IEX windows.
- Read full detections separately from envelopes so every digest links to its complete event list.

#### Channel evaluation

| Channel | Expected latency | Reliability / limitation | Decision |
|---|---:|---|---|
| Browser notification | ~1–3s while the dashboard/PWA is active | Permission-dependent; ordinary page notifications are unreliable when the browser/device is closed | Supplement only |
| Native desktop notifier | ~1–5s via Realtime prompt plus polling fallback | Works with dashboard closed; requires workstation online, notifier autostart, and network | **Initial recommended channel** |
| Email | Tens of seconds to minutes, sometimes longer | Provider queues and spam filtering make it unsuitable for NOW IN PLAY | Failure escalation only, not initial |
| External push service | Commonly seconds | Best off-workstation reach, but introduces vendor credentials, dependency, and possibly cost | Evaluate after desktop shadow results |

The desktop notifier leases pending envelopes, shows native OS notifications, and acknowledges by idempotency key. It consumes PRIMARY individual/overflow envelopes and SECONDARY digests exactly as stored; it never re-compacts. If delivery fails, the outbox retains the envelope, records the error, and retries with bounded exponential backoff. After the retry horizon it remains `failed`, appears prominently in dashboard health, and can be manually replayed only while still actionable. It is never silently deleted. Session-expired envelopes are retained for audit but are not pushed late. Rollback-off blocks leasing and delivery.

Exit gate: browser tests cover staleness/dark windows/legacy fallback. Notifier tests cover dashboard closed, restart, duplicate acknowledgement, offline recovery, provider failure, tier preservation, rollback, and permanent visible failure.

### LR7 — explicit legacy coexistence and §0.7 rollback

During **shadow operation**, the existing Vercel legacy cron remains enabled and remains the only user-facing alert engine. Its records stay in `scan_snapshots` / legacy `alert_events`, use the existing legacy UI identity, and never enter `attention_delivery_outbox`. Attention publishes snapshots labelled **SHADOW — ALERTING DISABLED** and generates/stores/surfaces no alerts under §0.7.

Activation requires one atomic runtime-control transition:

- `attentionLiveAlertingEnabled=true`
- `legacyAlertingEnabled=false`

The Vercel schedule may continue invoking the cron route, but the route checks `legacyAlertingEnabled` before provider work and becomes an audited no-op. This avoids a redeploy and preserves immediate rollback. The dashboard and desktop notifier show only the active engine's alerts, with distinct typed source fields so historical records cannot be mixed.

Rollback performs the safe order atomically: disable Attention first, clear pending Attention delivery leases, then enable legacy alerting. If the control is missing, stale, invalid, or unreadable, Attention fails off and legacy remains/restores on. Re-enabling Attention starts at the next completed minute and never emits catch-up alerts.

Every control change records actor, time, old/new values, reason, and configuration identity. The worker refreshes controls at least once per minute and by notification when available.

Exit gate: rollback takes effect by the next completed-minute boundary without redeploy, produces no orphaned/delayed Attention alert, and restores legacy alerts without a shared delivery channel.

## 3. Observability

Metrics cover capability-probe result, active ingestion mode, connection/request health, raw/completed timestamps, symbol lag, partial batches, gaps, recovery guards, inferred/confirmed halts, checkpoint age/sequence, snapshot lag, score availability, primary/secondary detections, primary direct/overflow envelopes, secondary digests, outbox attempts/age/failures, rollback/legacy state, notifier health, and dashboard staleness. Logs correlate run, instance, date/minute, symbol, feed/calibration/config identities, checkpoint sequence, and event identity without exposing secrets.

## 4. Build order after explicit authorization

1. Contracts, lease, checkpoint versioning, coexistence controls, and rollback.
2. Worker against deterministic mock stream and polling inputs with no external persistence.
3. Reviewed Supabase migration/adapters; apply only with separate approval.
4. Capability negotiation plus WebSocket and REST failure tests in shadow mode.
5. Durable restart recovery and uninterrupted/restarted hash equivalence.
6. Snapshot/outbox publication, dashboard reads, and desktop notifier with tier preservation.
7. Free-IEX regular-session shadow runs: legacy on, Attention alerts off.
8. **Single paid-feed gate:** only after items 1–7 pass and separate trader authorization, subscribe to real-time SIP and begin raw WebSocket validation recordings. No paid subscription is permitted before build item 8.
9. Validate real SIP reconnect/backfill/halt-resume/arrival integrity before any go-live decision.

## 5. Authorization gates

- No Phase E, direction/regime, advanced TA expansion, execution, or ground-truth claims.
- No paid subscription before build item 8 and separate authorization.
- No deployment or migration application without separate authorization.
- No live Attention alerting until shadow validation passes and the trader authorizes the atomic engine switch.
- Historical-pull timing remains optimistically biased and cannot validate live arrival behavior.
## 6. Local implementation record — 2026-08-18

Build items 1–7 are present and verified locally. The authenticated account acknowledged all 68 requested IEX WebSocket symbols despite the published Basic-plan limit of 30. This permissive acknowledgement is recorded but not treated as a durable entitlement contract; the free-IEX shadow worker deliberately uses one complete-universe `getCandlesMulti` REST poll with explicit `feed=iex` and `adjustment=split`.

The worker recovered state across separate processes through checkpoint sequence 9, with exact universe/calibration/config checksums and fencing. Shadow exposed and then verified a fix for lease expiry during long gap reconciliation: the worker now heartbeats inside reconciliation and before commit. The sequence-7 completed-minute snapshot was ready in the regular session, requested all 68 symbols, scored 40 of 61 tradeable symbols, and represented 21 unavailable symbols explicitly as `insufficient_reference`;

The durable outbox now has a concrete consumer: a native Windows desktop notifier. It leases only while §0.7 says Attention is the active live engine, preserves PRIMARY/SECONDARY tiering, acknowledges idempotently, retries with bounded exponential backoff, and leaves terminal failures visible. The authenticated dashboard reads snapshots from the new handoff tables. Supabase schema/RPCs are designed in migration 0009 but were not applied.

Artifacts: `data/runtime-shadow/last-run.json` and `data/runtime-shadow/runtime-state.json`. The continuous local entry point is `npm run runtime:worker`; the one-cycle verification entry point is `npm run runtime:shadow`.