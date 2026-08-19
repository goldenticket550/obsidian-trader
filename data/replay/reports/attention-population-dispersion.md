# Attention Engine population dispersion and fit comparison

> Population calibration is not ground-truth validation. This report describes state populations only; it makes no performance, hit-rate, latency, move-capture, discovery-quality, or correctness claim.

## Decision

**Retain the accepted mean-target fit.** The median alternative confirms that session populations are fat-tailed and moves the typical training session toward the nominal target. It is not better justified operationally: SIP holdout IN PLAY median rises to 11.5, the extreme rises from 40 to 46, and full-session zero-IN-PLAY days fall from three to one. Conservative generalization and the demonstrated ability to say nothing take priority over exact median targeting.

## Mean versus median target — regular session

| Feed | Split | Fit | EMERGING median [IQR] | IN PLAY median [IQR] | IN PLAY min/max | Zero IN PLAY sessions |
|---|---|---|---:|---:|---:|---:|
| sip | train | **mean (published)** | 9 [6.50–19] | 3.50 [1–8.75] | 0/40 | 3 |
| sip | train | median alternative | 12 [8–20.50] | 6.50 [4–17.50] | 0/46 | 1 |
| sip | holdout | **mean (published)** | 14.50 [10.25–17.50] | 4 [2.75–6.50] | 1/13 | 0 |
| sip | holdout | median alternative | 17 [12–23] | 11.50 [9–18] | 2/28 | 0 |
| iex_partial | train | **mean (published)** | 8.50 [5.75–15.25] | 3 [2.50–8] | 0/35 | 3 |
| iex_partial | train | median alternative | 12 [7–17.25] | 6.50 [4–11] | 1/41 | 0 |
| iex_partial | holdout | **mean (published)** | 11 [10–19] | 6 [3–7.75] | 2/12 | 0 |
| iex_partial | holdout | median alternative | 14 [12.25–19.75] | 8.50 [5.75–14.50] | 3/22 | 0 |

## Published-fit regular dispersion

| Feed | Split | E median | E IQR | E min (n) | E max (n) | E zero | I median | I IQR | I min (n) | I max (n) | I zero |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| sip | train | 9 | 6.50–19 | 1 (1) | 34 (1) | 0 | 3.50 | 1–8.75 | 0 (3) | 40 (1) | 3 |
| sip | holdout | 14.50 | 10.25–17.50 | 5 (1) | 32 (1) | 0 | 4 | 2.75–6.50 | 1 (1) | 13 (1) | 0 |
| iex_partial | train | 8.50 | 5.75–15.25 | 2 (2) | 30 (1) | 0 | 3 | 2.50–8 | 0 (3) | 35 (1) | 3 |
| iex_partial | holdout | 11 | 10–19 | 4 (1) | 31 (1) | 0 | 6 | 3–7.75 | 2 (1) | 12 (1) | 0 |

## Train/holdout assessment

- **sip:** EMERGING median gap 5.50 versus IQR scale 12.50; IN PLAY median gap 0.50 versus IQR scale 7.75. Ranges overlap: yes. Both gaps are **within session-to-session variance**.
- **iex_partial:** EMERGING median gap 2.50 versus IQR scale 9.50; IN PLAY median gap 3 versus IQR scale 5.50. Ranges overlap: yes. Both gaps are **within session-to-session variance**.

The mixed mean movement was therefore a regime-composition effect inside ordinary session variance, not evidence requiring another refit.

## NO NAMES IN PLAY

**3 SIP training sessions held zero IN PLAY names for every regular-session minute:** 2026-02-13, 2026-04-20, 2026-05-06. This empirical result remains a headline calibration invariant.

## Regular-session state dwell dispersion (symbol-minutes)

| Feed | Split | State | Median | IQR | Min (n) | Max (n) | Zero sessions |
|---|---|---|---:|---:|---:|---:|---:|
| sip | train | COOLING | 3 | 1–15.50 | 0 (3) | 69 (1) | 3 |
| sip | train | EMERGING | 22.50 | 13.75–62.50 | 1 (1) | 143 (1) | 0 |
| sip | train | IN_PLAY | 13 | 2–33.50 | 0 (3) | 192 (1) | 3 |
| sip | train | LOW_PRIORITY | 22895 | 22714.50–23031.75 | 12303 (1) | 23683 (1) | 0 |
| sip | train | WATCHING | 76 | 41.25–123.50 | 27 (1) | 240 (1) | 0 |
| sip | holdout | COOLING | 5 | 2.75–10 | 1 (1) | 18 (1) | 0 |
| sip | holdout | EMERGING | 42 | 26.50–58.50 | 14 (1) | 97 (1) | 0 |
| sip | holdout | IN_PLAY | 13.50 | 8.25–23.75 | 4 (2) | 46 (1) | 0 |
| sip | holdout | LOW_PRIORITY | 22891.50 | 22832–23169.75 | 22652 (1) | 23679 (1) | 0 |
| sip | holdout | WATCHING | 102.50 | 80.25–132.50 | 42 (1) | 264 (1) | 0 |
| iex_partial | train | COOLING | 4 | 2.50–9.25 | 0 (3) | 46 (1) | 3 |
| iex_partial | train | EMERGING | 25 | 16.75–47 | 3 (1) | 95 (1) | 0 |
| iex_partial | train | IN_PLAY | 10 | 5–25 | 0 (3) | 148 (1) | 3 |
| iex_partial | train | LOW_PRIORITY | 19448.50 | 18740.75–19966 | 10486 (1) | 20938 (1) | 0 |
| iex_partial | train | WATCHING | 60 | 34.50–81 | 6 (1) | 167 (1) | 0 |
| iex_partial | holdout | COOLING | 7.50 | 4.75–11.25 | 2 (1) | 14 (2) | 0 |
| iex_partial | holdout | EMERGING | 41 | 23.75–52.50 | 10 (1) | 120 (1) | 0 |
| iex_partial | holdout | IN_PLAY | 21 | 12.75–27 | 8 (1) | 43 (1) | 0 |
| iex_partial | holdout | LOW_PRIORITY | 19496 | 19203–19980.25 | 17678 (1) | 20696 (1) | 0 |
| iex_partial | holdout | WATCHING | 81 | 62.75–93.75 | 24 (1) | 175 (1) | 0 |

## Regular-session transition-count dispersion

| Feed | Split | Median | IQR | Min (n) | Max (n) | Zero sessions |
|---|---|---:|---:|---:|---:|---:|
| sip | train | 78.50 | 56.25–169 | 31 (2) | 384 (1) | 0 |
| sip | holdout | 128.50 | 91.25–154.75 | 52 (1) | 308 (1) | 0 |
| iex_partial | train | 70 | 54–113.25 | 20 (1) | 285 (1) | 0 |
| iex_partial | holdout | 107.50 | 85.50–139.50 | 36 (1) | 254 (1) | 0 |

Per-transition-type dispersion for every viable feed/window/split is in the JSON artifact.

## Full regular per-session distribution

| Date | Feed | Split | EMERGING | IN PLAY | State dwell minutes | Transitions |
|---|---|---|---:|---:|---|---:|
| 2025-10-10 | sip | train | 34 | 30 | LOW_PRIORITY=22311; WATCHING=240; EMERGING=143; IN_PLAY=164; COOLING=47 | 384 |
| 2025-10-24 | sip | train | 8 | 1 | LOW_PRIORITY=22716; WATCHING=42; EMERGING=29; IN_PLAY=2; COOLING=1 | 51 |
| 2025-10-28 | sip | train | 21 | 11 | LOW_PRIORITY=22569; WATCHING=107; EMERGING=75; IN_PLAY=35; COOLING=15 | 166 |
| 2025-11-04 | sip | train | 5 | 4 | LOW_PRIORITY=22909; WATCHING=54; EMERGING=13; IN_PLAY=14; COOLING=6 | 69 |
| 2025-11-14 | sip | train | 1 | 2 | LOW_PRIORITY=22955; WATCHING=31; EMERGING=1; IN_PLAY=2; COOLING=2 | 31 |
| 2025-11-20 | sip | train | 19 | 7 | LOW_PRIORITY=22789; WATCHING=126; EMERGING=59; IN_PLAY=25; COOLING=8 | 148 |
| 2025-11-24 | sip | train | 4 | 4 | LOW_PRIORITY=22902; WATCHING=37; EMERGING=14; IN_PLAY=23; COOLING=6 | 54 |
| 2025-11-28 | sip | train | 16 | 6 | LOW_PRIORITY=12303; WATCHING=39; EMERGING=37; IN_PLAY=8; COOLING=0 | 58 |
| 2025-12-09 | sip | train | 4 | 3 | LOW_PRIORITY=22873; WATCHING=63; EMERGING=11; IN_PLAY=12; COOLING=3 | 57 |
| 2025-12-10 | sip | train | 25 | 8 | LOW_PRIORITY=22650; WATCHING=177; EMERGING=91; IN_PLAY=33; COOLING=17 | 215 |
| 2025-12-17 | sip | train | 7 | 2 | LOW_PRIORITY=22888; WATCHING=79; EMERGING=19; IN_PLAY=4; COOLING=2 | 81 |
| 2025-12-30 | sip | train | 5 | 1 | LOW_PRIORITY=22876; WATCHING=29; EMERGING=12; IN_PLAY=3; COOLING=1 | 33 |
| 2026-01-20 | sip | train | 10 | 2 | LOW_PRIORITY=22907; WATCHING=76; EMERGING=18; IN_PLAY=3; COOLING=2 | 81 |
| 2026-01-21 | sip | train | 30 | 21 | LOW_PRIORITY=22579; WATCHING=209; EMERGING=88; IN_PLAY=86; COOLING=36 | 293 |
| 2026-01-29 | sip | train | 19 | 6 | LOW_PRIORITY=22757; WATCHING=138; EMERGING=74; IN_PLAY=23; COOLING=14 | 178 |
| 2026-02-06 | sip | train | 10 | 1 | LOW_PRIORITY=22913; WATCHING=73; EMERGING=18; IN_PLAY=2; COOLING=1 | 75 |
| 2026-02-13 | sip | train | 3 | 0 | LOW_PRIORITY=22955; WATCHING=33; EMERGING=6; IN_PLAY=0; COOLING=0 | 31 |
| 2026-03-09 | sip | train | 18 | 17 | LOW_PRIORITY=22710; WATCHING=125; EMERGING=70; IN_PLAY=78; COOLING=24 | 180 |
| 2026-03-10 | sip | train | 15 | 11 | LOW_PRIORITY=22786; WATCHING=108; EMERGING=45; IN_PLAY=43; COOLING=19 | 150 |
| 2026-03-27 | sip | train | 7 | 1 | LOW_PRIORITY=22903; WATCHING=76; EMERGING=12; IN_PLAY=2; COOLING=3 | 72 |
| 2026-03-31 | sip | train | 24 | 40 | LOW_PRIORITY=22541; WATCHING=123; EMERGING=60; IN_PLAY=192; COOLING=69 | 244 |
| 2026-04-20 | sip | train | 8 | 0 | LOW_PRIORITY=23319; WATCHING=33; EMERGING=16; IN_PLAY=0; COOLING=1 | 45 |
| 2026-05-06 | sip | train | 8 | 0 | LOW_PRIORITY=23308; WATCHING=73; EMERGING=16; IN_PLAY=0; COOLING=0 | 71 |
| 2026-05-27 | sip | train | 5 | 2 | LOW_PRIORITY=23347; WATCHING=27; EMERGING=8; IN_PLAY=15; COOLING=3 | 42 |
| 2026-06-02 | sip | train | 8 | 1 | LOW_PRIORITY=23285; WATCHING=91; EMERGING=18; IN_PLAY=2; COOLING=1 | 85 |
| 2026-06-26 | sip | train | 9 | 4 | LOW_PRIORITY=23262; WATCHING=92; EMERGING=27; IN_PLAY=15; COOLING=4 | 97 |
| 2026-07-22 | sip | train | 9 | 1 | LOW_PRIORITY=23683; WATCHING=67; EMERGING=26; IN_PLAY=3; COOLING=1 | 76 |
| 2026-07-29 | sip | train | 27 | 15 | LOW_PRIORITY=23464; WATCHING=141; EMERGING=80; IN_PLAY=76; COOLING=26 | 214 |
| 2025-10-01 | sip | holdout | 22 | 8 | LOW_PRIORITY=22652; WATCHING=148; EMERGING=67; IN_PLAY=30; COOLING=10 | 178 |
| 2026-01-27 | sip | holdout | 8 | 2 | LOW_PRIORITY=22877; WATCHING=83; EMERGING=25; IN_PLAY=6; COOLING=2 | 93 |
| 2026-01-30 | sip | holdout | 14 | 3 | LOW_PRIORITY=22826; WATCHING=129; EMERGING=42; IN_PLAY=9; COOLING=3 | 141 |
| 2026-02-02 | sip | holdout | 19 | 3 | LOW_PRIORITY=22832; WATCHING=100; EMERGING=60; IN_PLAY=10; COOLING=3 | 134 |
| 2026-02-12 | sip | holdout | 14 | 3 | LOW_PRIORITY=22848; WATCHING=105; EMERGING=31; IN_PLAY=10; COOLING=4 | 109 |
| 2026-02-25 | sip | holdout | 5 | 1 | LOW_PRIORITY=22906; WATCHING=42; EMERGING=14; IN_PLAY=4; COOLING=1 | 52 |
| 2026-04-02 | sip | holdout | 15 | 11 | LOW_PRIORITY=22832; WATCHING=78; EMERGING=42; IN_PLAY=26; COOLING=14 | 123 |
| 2026-04-21 | sip | holdout | 15 | 6 | LOW_PRIORITY=23181; WATCHING=118; EMERGING=46; IN_PLAY=19; COOLING=10 | 148 |
| 2026-04-22 | sip | holdout | 11 | 2 | LOW_PRIORITY=23234; WATCHING=81; EMERGING=27; IN_PLAY=4; COOLING=2 | 86 |
| 2026-05-07 | sip | holdout | 17 | 6 | LOW_PRIORITY=23166; WATCHING=143; EMERGING=58; IN_PLAY=23; COOLING=8 | 175 |
| 2026-06-09 | sip | holdout | 32 | 13 | LOW_PRIORITY=22974; WATCHING=264; EMERGING=97; IN_PLAY=46; COOLING=18 | 308 |
| 2026-08-14 | sip | holdout | 7 | 5 | LOW_PRIORITY=23679; WATCHING=50; EMERGING=19; IN_PLAY=17; COOLING=6 | 69 |
| 2025-10-10 | iex_partial | train | 30 | 26 | LOW_PRIORITY=17665; WATCHING=167; EMERGING=95; IN_PLAY=108; COOLING=45 | 285 |
| 2025-10-24 | iex_partial | train | 4 | 1 | LOW_PRIORITY=16806; WATCHING=35; EMERGING=11; IN_PLAY=2; COOLING=1 | 41 |
| 2025-10-28 | iex_partial | train | 18 | 8 | LOW_PRIORITY=17074; WATCHING=80; EMERGING=52; IN_PLAY=21; COOLING=9 | 126 |
| 2025-11-04 | iex_partial | train | 15 | 3 | LOW_PRIORITY=18434; WATCHING=33; EMERGING=39; IN_PLAY=7; COOLING=4 | 66 |
| 2025-11-14 | iex_partial | train | 2 | 0 | LOW_PRIORITY=18883; WATCHING=22; EMERGING=5; IN_PLAY=0; COOLING=0 | 22 |
| 2025-11-20 | iex_partial | train | 10 | 4 | LOW_PRIORITY=19696; WATCHING=84; EMERGING=26; IN_PLAY=11; COOLING=4 | 91 |
| 2025-11-24 | iex_partial | train | 7 | 5 | LOW_PRIORITY=19081; WATCHING=44; EMERGING=18; IN_PLAY=25; COOLING=9 | 70 |
| 2025-11-28 | iex_partial | train | 4 | 1 | LOW_PRIORITY=10486; WATCHING=14; EMERGING=6; IN_PLAY=2; COOLING=1 | 20 |
| 2025-12-09 | iex_partial | train | 7 | 3 | LOW_PRIORITY=18004; WATCHING=20; EMERGING=25; IN_PLAY=10; COOLING=3 | 37 |
| 2025-12-10 | iex_partial | train | 15 | 3 | LOW_PRIORITY=18843; WATCHING=72; EMERGING=46; IN_PLAY=9; COOLING=9 | 99 |
| 2025-12-17 | iex_partial | train | 8 | 3 | LOW_PRIORITY=19338; WATCHING=31; EMERGING=26; IN_PLAY=8; COOLING=3 | 54 |
| 2025-12-30 | iex_partial | train | 2 | 3 | LOW_PRIORITY=16937; WATCHING=6; EMERGING=3; IN_PLAY=12; COOLING=4 | 21 |
| 2026-01-20 | iex_partial | train | 5 | 0 | LOW_PRIORITY=19223; WATCHING=56; EMERGING=13; IN_PLAY=0; COOLING=0 | 61 |
| 2026-01-21 | iex_partial | train | 28 | 27 | LOW_PRIORITY=19279; WATCHING=123; EMERGING=74; IN_PLAY=104; COOLING=33 | 238 |
| 2026-01-29 | iex_partial | train | 18 | 8 | LOW_PRIORITY=19941; WATCHING=93; EMERGING=65; IN_PLAY=29; COOLING=12 | 144 |
| 2026-02-06 | iex_partial | train | 5 | 3 | LOW_PRIORITY=20118; WATCHING=73; EMERGING=12; IN_PLAY=7; COOLING=3 | 74 |
| 2026-02-13 | iex_partial | train | 7 | 1 | LOW_PRIORITY=19963; WATCHING=75; EMERGING=21; IN_PLAY=2; COOLING=1 | 68 |
| 2026-03-09 | iex_partial | train | 22 | 17 | LOW_PRIORITY=19975; WATCHING=105; EMERGING=61; IN_PLAY=58; COOLING=26 | 171 |
| 2026-03-10 | iex_partial | train | 11 | 4 | LOW_PRIORITY=19559; WATCHING=64; EMERGING=40; IN_PLAY=17; COOLING=7 | 96 |
| 2026-03-27 | iex_partial | train | 6 | 0 | LOW_PRIORITY=19776; WATCHING=48; EMERGING=20; IN_PLAY=0; COOLING=0 | 58 |
| 2026-03-31 | iex_partial | train | 24 | 35 | LOW_PRIORITY=19805; WATCHING=63; EMERGING=56; IN_PLAY=148; COOLING=46 | 196 |
| 2026-04-20 | iex_partial | train | 5 | 1 | LOW_PRIORITY=19115; WATCHING=18; EMERGING=11; IN_PLAY=2; COOLING=1 | 29 |
| 2026-05-06 | iex_partial | train | 14 | 3 | LOW_PRIORITY=20174; WATCHING=93; EMERGING=35; IN_PLAY=9; COOLING=3 | 109 |
| 2026-05-27 | iex_partial | train | 6 | 3 | LOW_PRIORITY=20056; WATCHING=38; EMERGING=18; IN_PLAY=14; COOLING=3 | 54 |
| 2026-06-02 | iex_partial | train | 8 | 3 | LOW_PRIORITY=19943; WATCHING=57; EMERGING=18; IN_PLAY=6; COOLING=3 | 70 |
| 2026-06-26 | iex_partial | train | 10 | 9 | LOW_PRIORITY=20718; WATCHING=69; EMERGING=21; IN_PLAY=25; COOLING=10 | 97 |
| 2026-07-22 | iex_partial | train | 9 | 4 | LOW_PRIORITY=20383; WATCHING=44; EMERGING=25; IN_PLAY=10; COOLING=4 | 64 |
| 2026-07-29 | iex_partial | train | 16 | 19 | LOW_PRIORITY=20938; WATCHING=94; EMERGING=50; IN_PLAY=91; COOLING=27 | 182 |
| 2025-10-01 | iex_partial | holdout | 11 | 7 | LOW_PRIORITY=17678; WATCHING=116; EMERGING=46; IN_PLAY=24; COOLING=9 | 139 |
| 2026-01-27 | iex_partial | holdout | 11 | 3 | LOW_PRIORITY=19032; WATCHING=63; EMERGING=32; IN_PLAY=12; COOLING=4 | 88 |
| 2026-01-30 | iex_partial | holdout | 11 | 2 | LOW_PRIORITY=19744; WATCHING=93; EMERGING=36; IN_PLAY=8; COOLING=2 | 101 |
| 2026-02-02 | iex_partial | holdout | 19 | 12 | LOW_PRIORITY=19611; WATCHING=96; EMERGING=57; IN_PLAY=43; COOLING=14 | 142 |
| 2026-02-12 | iex_partial | holdout | 10 | 6 | LOW_PRIORITY=20251; WATCHING=73; EMERGING=24; IN_PLAY=27; COOLING=7 | 92 |
| 2026-02-25 | iex_partial | holdout | 4 | 3 | LOW_PRIORITY=19228; WATCHING=30; EMERGING=10; IN_PLAY=9; COOLING=3 | 36 |
| 2026-04-02 | iex_partial | holdout | 15 | 7 | LOW_PRIORITY=19366; WATCHING=88; EMERGING=47; IN_PLAY=19; COOLING=8 | 114 |
| 2026-04-21 | iex_partial | holdout | 22 | 10 | LOW_PRIORITY=19128; WATCHING=75; EMERGING=51; IN_PLAY=37; COOLING=14 | 141 |
| 2026-04-22 | iex_partial | holdout | 10 | 3 | LOW_PRIORITY=19381; WATCHING=62; EMERGING=23; IN_PLAY=13; COOLING=5 | 78 |
| 2026-05-07 | iex_partial | holdout | 19 | 6 | LOW_PRIORITY=20351; WATCHING=87; EMERGING=59; IN_PLAY=23; COOLING=11 | 137 |
| 2026-06-09 | iex_partial | holdout | 31 | 11 | LOW_PRIORITY=20696; WATCHING=175; EMERGING=120; IN_PLAY=27; COOLING=12 | 254 |
| 2026-08-14 | iex_partial | holdout | 6 | 4 | LOW_PRIORITY=19890; WATCHING=24; EMERGING=22; IN_PLAY=15; COOLING=7 | 49 |

Artifact: 6d7028909104cf3a92664e1566a4b8593be9faa0009e29f06fbb654f41c4df34.

