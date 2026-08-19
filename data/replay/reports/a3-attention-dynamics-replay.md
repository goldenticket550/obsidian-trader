# Phase A3 attention dynamics replay report

> Timing statistics derived from historical pulls assume instantaneous bar availability. Real arrival latency is not represented. Human-relative latency and move-capture figures are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.

## VALIDATION STATUS — REFUSED

> All curves and state/velocity thresholds remain `pending_calibration`. A3 uses explicit provisional values only. No performance, discovery, state-quality, timing, or threshold conclusion is permitted.

Curves and thresholds remain one calibration system and must be calibrated together against labelled sessions after A3.

## Determinism

- First sequence: `4dfc9b9b41fa04d151de7ece3b0f5c372d401c614f7b87079be7e4a019296101`
- Second sequence: `4dfc9b9b41fa04d151de7ece3b0f5c372d401c614f7b87079be7e4a019296101`
- Per-minute hashes identical: yes
- Artifact hash: `43b451c59e3b8599b9d313e1bfb8f4d2179af9b7a97d11a7aac4633e027a21f5`

## Contract replay result

- State transitions: WATCHING → EMERGING → IN_PLAY
- Episode back-dated to first contiguous activity minute: pass
- Final WAKING UP: AAOI
- Final IN PLAY: AAOI
- WAKING UP ordering input: attention score velocity; IN PLAY ordering input: attention score.
- Raw rank is stored for display context and is not consumed by transitions, freshness, cooling, or list gates.
- IN_PLAY core > WATCHING core was asserted on every replay frame; any violation throws.

## 09:30 measurement boundary

- Velocity reset: pass
- Velocity-derived behavior suppressed by transition guard: pass
- Episode identity preserved: pass
- Episode transition marker: sparse → dense
- A newly qualifying post-open episode stops back-dating at an earlier pending-calibration window; this is covered by the explicit 09:30 truncation regression.

## Provisional state thresholds

Exit / enter pairs are separate and live inside the same versioned feed/window calibration identity as the curves.

| Feed | Sub-window | Calibration ID | WATCHING exit/enter | EMERGING exit/enter | IN PLAY exit/enter | velocity/min |
|---|---|---|---:|---:|---:|---:|
| sip | premarket_early | mode-map-v3:curve-v1:state-v1:sip:premarket_early | 0.20 / 0.25 | 0.40 / 0.50 | 0.60 / 0.70 | 2.00 |
| sip | premarket_core | mode-map-v3:curve-v1:state-v1:sip:premarket_core | 0.20 / 0.25 | 0.40 / 0.50 | 0.60 / 0.70 | 2.00 |
| sip | premarket_final | mode-map-v3:curve-v1:state-v1:sip:premarket_final | 0.20 / 0.25 | 0.40 / 0.50 | 0.60 / 0.70 | 2.00 |
| sip | regular | mode-map-v3:curve-v1:state-v1:sip:regular | 0.20 / 0.25 | 0.40 / 0.50 | 0.60 / 0.70 | 2.00 |
| sip | after_hours_core | mode-map-v3:curve-v1:state-v1:sip:after_hours_core | 0.20 / 0.25 | 0.40 / 0.50 | 0.60 / 0.70 | 2.00 |
| sip | after_hours_late | mode-map-v3:curve-v1:state-v1:sip:after_hours_late | 0.20 / 0.25 | 0.40 / 0.50 | 0.60 / 0.70 | 2.00 |
| iex_partial | premarket_early | mode-map-v3:curve-v1:state-v1:iex_partial:premarket_early | 0.20 / 0.25 | 0.40 / 0.50 | 0.60 / 0.70 | 2.00 |
| iex_partial | premarket_core | mode-map-v3:curve-v1:state-v1:iex_partial:premarket_core | 0.20 / 0.25 | 0.40 / 0.50 | 0.60 / 0.70 | 2.00 |
| iex_partial | premarket_final | mode-map-v3:curve-v1:state-v1:iex_partial:premarket_final | 0.20 / 0.25 | 0.40 / 0.50 | 0.60 / 0.70 | 2.00 |
| iex_partial | regular | mode-map-v3:curve-v1:state-v1:iex_partial:regular | 0.20 / 0.25 | 0.40 / 0.50 | 0.60 / 0.70 | 2.00 |
| iex_partial | after_hours_core | mode-map-v3:curve-v1:state-v1:iex_partial:after_hours_core | 0.20 / 0.25 | 0.40 / 0.50 | 0.60 / 0.70 | 2.00 |
| iex_partial | after_hours_late | mode-map-v3:curve-v1:state-v1:iex_partial:after_hours_late | 0.20 / 0.25 | 0.40 / 0.50 | 0.60 / 0.70 | 2.00 |

## Scope fence

No Market Map, event or alert engine, direction state, regime, advanced TA, subscription, live wiring, deployment, or migration is included.
