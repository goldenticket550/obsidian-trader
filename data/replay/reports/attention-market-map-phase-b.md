# Attention Engine Phase B — Market Map

> Timing statistics derived from historical pulls assume instantaneous bar availability. Real arrival latency is not represented. Human-relative latency and move-capture figures are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.

## Status

Phase B is implemented as a deterministic completed-bar module and a display component. It is not
wired to a live feed. This report describes the implementation contract; it is not a performance,
hit-rate, latency, move-capture, discovery-quality, or correctness evaluation.

## Full-universe cheap state

Every fetched symbol can maintain current price, VWAP, literal HOD, and literal LOD. Detailed map work
is computed only for the caller-supplied active subset.

## Detailed active-name map

- Static/session levels: PMH, PML, PDH, PDL, prior close, ORH, ORL, VWAP.
- Dynamic levels: literal HOD/LOD, meaningful confirmed swing highs/lows, and confirmed consolidation
  boundaries.
- Opening range: one configuration, default 15 minutes, supporting only 5/15/30. It is anchored to
  the exchange-calendar open and remains unavailable until the clock window closes. A missing 09:30
  bar cannot move the range.
- Swings: reuse `confirmedPivotLevels`/`findPivots`; causal confirmation plus ATR and time separation.
- Relevance: reactions, interaction volume, rejection strength, reclaims, recency, and unbroken status
  are exposed. Premarket automatic priority decays; accumulated observed reactions do not.
- References: nearest and next above/below with price, percent distance, ATR distance, expected-move
  fraction when available, and relevance.

Allowed language is “Nearest upside reference” or “Next downside reference.” References describe
location. They never claim that price will reach or “target” a level.

## Scope fence

No event generation, alerts, direction state, regime classification, advanced TA, subscription,
deployment, migration, or live wiring is included. Phase C has not started.
