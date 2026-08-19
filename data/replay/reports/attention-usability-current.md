# Attention usability baseline — before approved rescale/log transform

> Timing statistics derived from historical pulls assume instantaneous bar availability. Real arrival latency is not represented. Human-relative latency and move-capture figures are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.

This freezes the current production replay before changing measurement or dwell controls. It is population behavior, not ground-truth validation.

- Regular minutes with >=1 IN PLAY: 449/15420 (2.91%)
- Regular minutes with >=1 WAKING UP: 0/15420 (0.00%)
- IN PLAY occupancy: median 3 min; IQR 2–5 min
- EMERGING occupancy: median 2 min; IQR 2–3 min
- Gaps between IN PLAY periods: median 31.5 min; IQR 10.75–70.75 min
- All-day zero-IN-PLAY sessions: 2026-02-13, 2026-04-20, 2026-05-06
