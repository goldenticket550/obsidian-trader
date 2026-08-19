# Phase A2 Attention Score replay report

> Timing statistics derived from historical pulls assume instantaneous bar availability. Real arrival latency is not represented. Human-relative latency and move-capture figures are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.

## VALIDATION STATUS — REFUSED

> All 12 calibration sets—including normalization curves and thresholds—are `pending_calibration`. These provisional values and contract scenarios cannot support performance, threshold, latency, or discovery conclusions.

Normalization curves and thresholds are one calibration system. They must be calibrated together against the same labelled post-A3 sessions; changing a curve invalidates that set's thresholds and calibration identity.

## Feed-mode contract replay

| Feed mode | Core | Participation weight | Volume acceleration | Modifier | Attention |
|---|---|---:|---|---:|---:|
| sip | participation × displacement | 1 | enabled | 1.0100 | 71.1461 |
| iex_partial | displacement × idiosyncrasy | 0 (display-only) | disabled | 1.0000 | 25.8382 |

Identical axis observations intentionally produce different scores because the feed modes use different two-axis cores. Path B applies no modifier because Idiosyncrasy is already inside its core.

## §11.1 scenario 20 — exact regression

With participation and displacement curves pinned inline to z50=2.0, k=1.2, Path A inputs participationZ=3.0, displacementZ=2.5, idiosyncrasyZ=0.2 produce attention=71.1461; exact four-decimal expectation=71.1461 (pass).

## Arithmetic guards

| Feed mode | z=0 attention | z=0 core | Below deadStockCeiling=15 | Below provisional WATCHING core=0.25 | z=6 attention | <=100 |
|---|---:|---:|---|---|---:|---|
| sip | 8.3173 | 0.0832 | pass | pass | 100.0000 | pass |
| iex_partial | 8.3173 | 0.0832 | pass | pass | 99.1837 | pass |

## Published provisional normalization curves

Each row is the exact versioned curve stored beside its feed/window thresholds. `participation_presence` consumes surprise bits; the other rows consume z.

| Feed mode | Sub-window | Axis/input | Curve v | z50 | k | norm(0) | norm(1) | norm(2) | norm(3) | norm(4) | norm(6) |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| sip | premarket_early | participation_dense (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| sip | premarket_early | participation_presence (surprise_bits) | 1 | 3.00 | 1.30 | 0.0198 | 0.0691 | 0.2142 | 0.5000 | 0.7858 | 0.9802 |
| sip | premarket_early | displacement (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| sip | premarket_early | idiosyncrasy (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| sip | premarket_core | participation_dense (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| sip | premarket_core | participation_presence (surprise_bits) | 1 | 3.00 | 1.30 | 0.0198 | 0.0691 | 0.2142 | 0.5000 | 0.7858 | 0.9802 |
| sip | premarket_core | displacement (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| sip | premarket_core | idiosyncrasy (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| sip | premarket_final | participation_dense (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| sip | premarket_final | participation_presence (surprise_bits) | 1 | 3.00 | 1.30 | 0.0198 | 0.0691 | 0.2142 | 0.5000 | 0.7858 | 0.9802 |
| sip | premarket_final | displacement (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| sip | premarket_final | idiosyncrasy (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| sip | regular | participation_dense (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| sip | regular | participation_presence (surprise_bits) | 1 | 3.00 | 1.30 | 0.0198 | 0.0691 | 0.2142 | 0.5000 | 0.7858 | 0.9802 |
| sip | regular | displacement (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| sip | regular | idiosyncrasy (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| sip | after_hours_core | participation_dense (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| sip | after_hours_core | participation_presence (surprise_bits) | 1 | 3.00 | 1.30 | 0.0198 | 0.0691 | 0.2142 | 0.5000 | 0.7858 | 0.9802 |
| sip | after_hours_core | displacement (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| sip | after_hours_core | idiosyncrasy (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| sip | after_hours_late | participation_dense (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| sip | after_hours_late | participation_presence (surprise_bits) | 1 | 3.00 | 1.30 | 0.0198 | 0.0691 | 0.2142 | 0.5000 | 0.7858 | 0.9802 |
| sip | after_hours_late | displacement (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| sip | after_hours_late | idiosyncrasy (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| iex_partial | premarket_early | participation_dense (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| iex_partial | premarket_early | participation_presence (surprise_bits) | 1 | 3.00 | 1.30 | 0.0198 | 0.0691 | 0.2142 | 0.5000 | 0.7858 | 0.9802 |
| iex_partial | premarket_early | displacement (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| iex_partial | premarket_early | idiosyncrasy (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| iex_partial | premarket_core | participation_dense (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| iex_partial | premarket_core | participation_presence (surprise_bits) | 1 | 3.00 | 1.30 | 0.0198 | 0.0691 | 0.2142 | 0.5000 | 0.7858 | 0.9802 |
| iex_partial | premarket_core | displacement (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| iex_partial | premarket_core | idiosyncrasy (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| iex_partial | premarket_final | participation_dense (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| iex_partial | premarket_final | participation_presence (surprise_bits) | 1 | 3.00 | 1.30 | 0.0198 | 0.0691 | 0.2142 | 0.5000 | 0.7858 | 0.9802 |
| iex_partial | premarket_final | displacement (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| iex_partial | premarket_final | idiosyncrasy (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| iex_partial | regular | participation_dense (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| iex_partial | regular | participation_presence (surprise_bits) | 1 | 3.00 | 1.30 | 0.0198 | 0.0691 | 0.2142 | 0.5000 | 0.7858 | 0.9802 |
| iex_partial | regular | displacement (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| iex_partial | regular | idiosyncrasy (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| iex_partial | after_hours_core | participation_dense (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| iex_partial | after_hours_core | participation_presence (surprise_bits) | 1 | 3.00 | 1.30 | 0.0198 | 0.0691 | 0.2142 | 0.5000 | 0.7858 | 0.9802 |
| iex_partial | after_hours_core | displacement (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| iex_partial | after_hours_core | idiosyncrasy (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| iex_partial | after_hours_late | participation_dense (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| iex_partial | after_hours_late | participation_presence (surprise_bits) | 1 | 3.00 | 1.30 | 0.0198 | 0.0691 | 0.2142 | 0.5000 | 0.7858 | 0.9802 |
| iex_partial | after_hours_late | displacement (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |
| iex_partial | after_hours_late | idiosyncrasy (z) | 1 | 2.00 | 1.20 | 0.0832 | 0.2315 | 0.5000 | 0.7685 | 0.9168 | 0.9918 |

## Explainability and provenance

- Deterministic artifact hash: `caa5fc13df927aa5402723e34f36d1b61480884e86da1823f6a07b76b103affd`
- Every result contains calibrationId, normalizationVersion/status, feedMode, sub-window, raw axis inputs, baseline statistics, normalization parameters, normalized values, core, modifier, and final.
- Path B volume presentation is labelled `IEX PARTIAL`.
- `first_bar` means first bar in provider history; it is not presented as an exchange listing date.

## Scope fence

No history, velocity, state machine, episode, WAKING UP, event, or live-scanner wiring is present in this A2 replay.
