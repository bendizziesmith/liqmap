# Tuning notes — XRPUSDT 4h vs the reference tool

2026-08-07, updated after the wick-clearing measurement (build `1ee8ade` → this branch).
The reference crop is now in `docs/reference/td-xrpusdt-4h-swing-2026-08-06.png`:
Trading Different, BINANCE/XRPUSDT, **Swing 3×/5×/10×/25×** — captured Aug 6 ~18:00 with
their current price 1.0449.

## Correction: the leverage-ceiling explanation was wrong

The previous version of this file attributed the missing 1.00–1.02 band to a leverage
ceiling ("needs 45–125× from current-price entries") and recommended a 50× swing tier.
**Both retracted, on two pieces of evidence:**

1. The reference's own crop shows its ladder is the **same 3/5/10/25** as ours. Whatever
   builds their wall, it is not high leverage.
2. Entries come from every historical candle, not from current price: measured over the
   whole walk, our own ladder seeded **$1.71B** into [0.98, 1.03] (25× from ~1.05 entries,
   10× from ~1.12, 5× from ~1.26 — all traded this year). The band was never unreachable;
   it was seeded and then removed.

## Where the $1.71B went (the Step-1 measurement)

| | decay OFF | decay ON (default) |
|---|---|---|
| (a) seeded into [0.98, 1.03] over the walk | $1.71B | $1.71B |
| (b) cleared out | $697M | $314M |
| — of which by candle **bodies** | $103M (14.8%) | $31M (9.8%) |
| — of which by **wicks only** | **$594M (85.2%)** | **$283M (90.2%)** |
| lost to decay | — | **$1.14B** |
| (c) surviving now | $1.01B (3.10% of book) | $259M (2.46%) |

The named sweep: **Jun 25 12:00** (O 1.0714, H 1.0791, L 1.0111, C 1.0343) — one candle
whose lower wick removed $460.7M from the band at 100% wick share, two thirds of all
clearing it ever suffered.

So **H1 (wick clearing) holds for the clearing that occurred** — but with decay on, decay
removes 3.6× more from the band than clearing does: what a wick spares in June is ~8
half-lives old for the 25× tier by August.

**Timing caveat:** the Aug-7 00:00 and 04:00 candles (lows 1.0185/1.0144) swept exactly
this band *after* the reference crop was captured (Aug 6 ~18:00). Part of today's gap is
simply that our book is post-wick and the crop is pre-wick — no model change closes that.

## The retention sweep (Step 3)

Shipped engine, whole-book rebuilds, price 1.0266 at run time:

| decay | retention | [1.00, 1.02] | [0.98, 1.03] | above [1.16, 1.99] | 0.90s shelf rank | band rank (below-price) |
|---|---|---|---|---|---|---|
| OFF | 0.00 | 0.86% | 3.10% | 60.51% | 1 | 4 |
| OFF | 0.25 | 0.93% | 3.15% | 60.73% | 1 | 4 |
| OFF | 0.50 | 1.04% | 3.24% | 60.94% | 1 | 4 |
| OFF | 0.75 | 1.27% | 3.45% | 61.10% | 1 | 4 |
| ON | 0.00 | 0.59% | 2.46% | 51.03% | 1 | 5 |
| ON | 0.25 | 0.65% | 2.51% | 51.01% | 1 | 5 |
| ON | 0.50 | 0.73% | 2.60% | 50.98% | 1 | 5 |
| ON | 0.75 | 0.88% | 2.74% | 50.93% | 1 | 5 |

Retention never inflates the far-above extras (flat to −0.1pp with decay on) and never
demotes the 0.90–0.95 shelf — but it also never lifts the near band's rank. The mechanism
is the decay interaction: what the Jun-25 wick spares has decayed to nothing by now, so
retention only compounds on the recent (Aug 6–7) sweeps, which are small.

Half-life sensitivity, same run (decay on): softening swing 25× 5d→14d and 10× 14d→21d
plus retention 0.5 lifts [1.00, 1.02] to 1.02% — the strongest combination measured, still
short of changing the ranking, with extras flat (51.3%).

## Decision

Per the decision rule — pick a value only if it recovers the band without side effects —
**no value qualifies, so the shipped default is `wickClearing: 'full'`**. The setting
stays available ('partial' = 0.5 retention) because the mechanism is real and measured;
it just is not sufficient here.

## H2 closed: recency-weighted seeding — rejected without measurement

Weighting turnover by age at seed time double-counts what decay already does: a deposit
seeded at time t and observed at time T carries `2^-((T-t)/halfLife)` — that IS the
recency weight, applied continuously and per tier. Adding a second age weight at seed time
would discount the same days twice. H2 is closed on that argument; no experiment needed.

## H3 confirmed: standing mass = seedWeight × halfLife (2026-08-07)

Under decay, a tier fed a constant flow converges on `deposit / (1 - f)` — proportional to
seedWeight × halfLife (asserted analytically and end-to-end in `decay.test.ts`). The
legacy [0.35, 0.30, 0.20, 0.15] × [60, 30, 14, 5]d is therefore an **effective standing
split of ~62/27/8/2 toward 3×** — measured live on XRPUSDT 4h as **67.3/25.4/6.2/1.0**
(clearing trims the near tiers harder than the far shelf, explaining the residual). A 3×
long liquidates 33% below entry; the standing book was parked far from price by
construction — no seeding, clearing or lookback error involved.

Per-tier at TD's quoted prices (same 3/5/10/25 ladder both sides):

| price zone | TD (crop/tooltip) | ours, legacy split | ours, highLeverage |
|---|---|---|---|
| 0.95 | ~empty, 25×-only ($0.61M) | 78/7/14/0 toward 3×, 2.3% of book | 25/7/68/0, 2.4% |
| 1.00–1.04 | dominant wall, 25×-heavy | 19/9/50/21, **0.59%** of book | 1/1/34/**64**, **4.19%** |

### The standing-share sweep (decay on)

| share | [1.00,1.04] | below-price rank | 0.88–0.96 shelf | extras 1.16–1.99 |
|---|---|---|---|---|
| current (62/27/8/2) | 0.59% | 5 | 16.6% (top cluster) | 51.0% |
| flat (25/25/25/25) | 2.95% | 1 | 14.3% | 45.3% |
| **highLeverage (15/20/30/35)** | **4.19%** | **1** | 12.8% | **41.6%** |

`highLeverage` wins on every reference observable at once: the near wall becomes the top
below-price cluster (TD's shape) at 64% 25× composition (TD's colour), the 0.95 shelf
demotes (TD shows it nearly empty — the earlier "0.90–0.95 shelf HIT" was scored from the
brief's description before the crop landed; the crop shows TD's below-price mass hugging
0.98–1.045, so demoting the shelf is convergence, not damage), and the far-above extras
improve. Seed weights derive as `share / halfLife` (renormalized), so conservation is
exact — asserted, along with byte-identity of the 'current' option to the legacy build.

**Shipped default: `standingShare: 'highLeverage'`** — the declared split now matches how
perp open interest actually distributes across leverage brackets, and the accidental
61/26/8/2 remains available as 'Legacy' for comparison.

### H4 (shorter lookback): secondary, not shipped

Truncating the walk (highLeverage, decay on): full 167d → 30d moves [1.00,1.04] only
4.19% → 5.42% and the shelf 12.8% → 8.6%, with no rank changes. Decay already acts as a
soft lookback; hard truncation refines at the margin. **H3 dominates.**
