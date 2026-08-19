# Phase LR8 — on-page live alert feed report

Generated 2026-08-18 ET. This is a local-only implementation report. It is not alert-quality or ground-truth validation.

## Outcome

The on-page feed is implemented and the supervised shadow worker is running the LR8 code. Valid minutes now advance the event engine and persist detections even while out-of-band delivery is disabled. Delivery controls govern envelope creation only. Guard-active, incomplete, and non-regular minutes remain detection-suppressed and are identified as such in the snapshot/API/UI.

The required post-change 390-minute regular-session observation is **not complete**. LR8 was loaded after the 2026-08-18 close. The worker is intentionally left running to accumulate the next session; after-close minutes are reported as `non_regular`, not quiet.

## Verification

- Typecheck: pass (`tsc --noEmit`).
- Full suite: pass, 129 test files / 1,573 tests.
- Production build: pass (`next build`, local handoff opt-in set).
- Catch-up regression: pass. Twenty shadow minutes store detections with zero envelopes; enabling delivery creates four envelopes (three PRIMARY direct + one PRIMARY digest) containing only the eight current-minute event ids and no shadow-backlog id.
- Trimming equivalence: pass over 390 minutes. Bounded incremental state produces the same current-minute delivery output as the original untrimmed whole-session compactor. The test caught and rejected a naive rolling-suffix implementation because it changed direct/digest phase.
- API auth: authenticated local owner receives the same runtime snapshot/events file; unauthenticated returns 401; deployed-production guard returns 403 with `local_runtime_refused_in_production`; unreadable file uses the single new `runtime_file_unreadable` status.
- Page: snapshot and events share one load function and one 15-second poll timer; the independent one-second clock, focus refresh, visibility refresh, sign-out state, stored event freshness/context, and persistent shadow label are covered by component tests.

## Measured runtime state after LR8 restart

At the first inspection after restart:

- Snapshot sequence: 77.
- Health: `dark_window`; ready: false.
- Detection: `suppressed / non_regular`.
- Detection counters: 2 processed, 0 detection-ran, 2 non-regular.
- Stored events: 0.
- Outbox envelopes: 0.
- `liveDeliveryEnabled`: false.
- Legacy alerting: true.
- LR8 child exits/restarts after the controlled start: 0. Persistent supervisor restart counter: 20 (historical and controlled prior runs retained).

Five post-restart dark-window cycles measured p50 1.490 s / p95 2.783 s / max 2.803 s. These do not execute regular-session scoring/event detection and therefore are **not** used as the requested cycle-cost acceptance comparison.

The 2026-08-18 liveness log contains only 48/390 regular-session heartbeats, from 15:11–15:59 ET before LR8 loaded. Its cycle distribution was p50 4.444 s / p95 6.638 s / max 6.835 s, but detection was still structurally gated then. It is reported as `FAIL_INCOMPLETE_SESSION`, not LR8 evidence. The required comparison against 3.79 / 5.16 / 5.56 seconds remains pending a complete post-change session.

## Source diff summary

- `lib/attention-runtime/iexStaticProcessor.ts`, `iexProcessor.ts`: execute the existing event state machine on every valid regular minute, independent of delivery controls. No event thresholds or transitions changed.
- `lib/attention-runtime/worker.ts`, `contracts.ts`: split detection validity from delivery enablement; persist detection counters/reasons; store valid shadow events; filter delivery to current-minute qualifications; preserve processor checkpoint state; checkpoint bounded delivery state.
- `lib/attention/incrementalAlertDelivery.ts`: bounded, checkpointable form of the existing tier compactor, behavior-equivalent to the original whole-session function.
- `lib/attention-runtime/localRuntimeHandoff.ts`: guarded local-file reader, explicit Eastern half-open day range, bounded newest-first event filtering.
- `app/api/attention/live/route.ts`, `app/api/attention/events/route.ts`: authenticated snapshot/event APIs backed by the same atomic local runtime file.
- `components/attention/LiveAttentionPage.tsx`, `app/attention/page.tsx`: always-visible alert feed, freshness column, new-row highlight, distinct quiet/suppressed/down/signed-out states, independent liveness clock and refetch handlers.
- `docs/live-session-runbook.md`: exact production-build local startup and sign-in procedure.
- `scripts/profile-attention-live-minute.ts`: additive snapshot fields required by the LR8 contract; profiling behavior unchanged.
- Tests: `attentionAlertDelivery`, `attentionRuntimeShadowEvents`, `attentionEventsApi`, and `liveAttentionPage` cover the required regressions.

Operational files under `data/runtime-shadow` changed because the authorized local worker and liveness reporter ran. No replay archive, calibration artifact, threshold file, or universe file was changed.

## Standing constraints

- `attentionLiveAlertingEnabled` remains false.
- Active control engine remains legacy; no desktop notifier or other out-of-band consumer was enabled.
- Free IEX REST polling remains in use; no paid subscription was purchased or enabled.
- `supabase/migrations/0010_attention_live_runtime.sql` remains unapplied with its `REVIEW ONLY` header.
- Nothing was deployed.
- No threshold, universe entry, calibration id, scoring value, state transition, persistence, cooldown, or hysteresis rule changed. The existing event state machine now executes in shadow; its behavior was not retuned.
