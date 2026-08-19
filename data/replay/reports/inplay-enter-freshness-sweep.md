# IN PLAY entry threshold — freshness diagnostic

> Timing statistics derived from historical pulls assume instantaneous bar availability. Real arrival latency is not represented. Human-relative latency and move-capture figures are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.

> Population behavior only. Ground-truth quality, hit rate, latency, move capture, and profitability conclusions are refused.

SIP regular only. Published entry remains 0.80. Fixed exit is 0.66; therefore 0.60/0.50/0.40 are diagnostic qualification levels, not valid publishable state configurations. No calibration identity was changed.

| Enter | Split | Fresh | Developing | Mature | Extended | Travel ATR median [IQR] | EMA9 ATR median [IQR] | Alerts/session median [IQR] | Delivered/session median [IQR] | Conversion to 0.80 | Lead min median [IQR] | Corpus quiet 3/3 | Valid with exit 0.66 |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 0.80 | train | 0.0% | 0.0% | 1.6% | 98.4% | 1.85 [1.14–2.86] | 1.65 [1.20–2.19] | 1.50 [0.00–5.50] | 1.50 [0.00–5.00] | 100.0% | 0.00 [0.00–0.00] | yes | yes |
| 0.80 | holdout | 0.0% | 2.6% | 2.6% | 94.7% | 1.13 [0.62–1.83] | 1.11 [0.91–1.52] | 2.50 [1.00–4.50] | 2.50 [1.00–4.50] | 100.0% | 0.00 [0.00–0.00] | yes | yes |
| 0.70 | train | 0.0% | 0.0% | 4.8% | 95.2% | 1.32 [0.58–1.99] | 1.30 [0.86–1.85] | 5.00 [2.00–15.00] | 5.00 [2.00–9.00] | 68.2% | 0.00 [0.00–1.00] | NO | yes |
| 0.70 | holdout | 0.0% | 0.9% | 2.7% | 96.4% | 0.87 [0.47–1.56] | 1.04 [0.78–1.37] | 7.00 [5.25–11.50] | 6.50 [5.25–10.00] | 60.0% | 0.00 [0.00–0.00] | NO | yes |
| 0.60 | train | 0.2% | 0.4% | 3.6% | 95.9% | 0.84 [0.40–1.49] | 1.05 [0.74–1.60] | 11.50 [8.00–31.25] | 10.00 [8.00–15.00] | 46.3% | 0.00 [0.00–2.00] | NO | no |
| 0.60 | holdout | 0.7% | 0.4% | 1.5% | 97.4% | 0.62 [0.36–1.14] | 0.92 [0.66–1.22] | 18.00 [14.75–23.75] | 15.00 [13.25–17.50] | 34.3% | 0.00 [0.00–1.00] | NO | no |
| 0.50 | train | 0.1% | 0.6% | 4.0% | 95.2% | 0.68 [0.30–1.34] | 0.93 [0.67–1.35] | 21.50 [11.00–42.50] | 16.50 [11.00–22.50] | 33.5% | 0.00 [0.00–2.00] | NO | no |
| 0.50 | holdout | 0.5% | 0.2% | 1.6% | 97.7% | 0.56 [0.30–0.95] | 0.87 [0.61–1.15] | 35.50 [26.50–41.25] | 24.00 [21.75–27.50] | 23.2% | 0.00 [0.00–2.00] | NO | no |
| 0.40 | train | 0.2% | 0.8% | 3.1% | 95.8% | 0.57 [0.25–1.10] | 0.83 [0.59–1.23] | 28.00 [16.50–53.00] | 22.50 [15.00–29.25] | 27.3% | 1.00 [0.00–2.00] | NO | no |
| 0.40 | holdout | 0.4% | 0.4% | 1.3% | 98.0% | 0.53 [0.28–0.86] | 0.80 [0.56–1.10] | 45.50 [35.00–50.25] | 31.00 [25.00–33.50] | 19.3% | 0.00 [0.00–2.75] | NO | no |

All three mandated quiet dates are in the training split. Holdout quiet fields are therefore `n/a`; the table reports the corpus-wide result to avoid treating an absent date as a pass.

## Recommendation

No lower threshold is recommendable from this sweep. At 0.70, Extended remains 95.16% train / 96.36% holdout, conversion falls to 68.17% / 60.00%, median lead remains 0 minutes, and 2026-04-20 plus 2026-05-06 cease to be quiet. The 0.60–0.40 rows are not publishable with exit 0.66 and do not solve freshness anyway.

The current 0.80 threshold remains unchanged only because no candidate passed the stated constraints—not because its 96% Extended output is accepted. The evidence points back to the pending freshness/extension-classification diagnosis: lowering activity level alone does not make qualification actionable.

The rate limiter changes delivery only; qualification, episode state, storage, and standing lists are not compacted.

Artifact: `67b96d330389ced3b586abff7848e783cd4e02761f1a0e1fc48bc0bed643d2ee`. Published threshold: unchanged at 0.80.
