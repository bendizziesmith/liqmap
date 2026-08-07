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

## What actually remains between us and the reference

With the ladder question closed, the residual is model-family, not parameters:

- TD's book at **0.95 is nearly empty** (tooltip: 25× $0.61M, all others 0) while ours
  carries its heaviest below-price shelf at 0.88–0.96 (16–18% of book) — turnover seeded
  from July's high-volume trading that TD evidently discards or re-weights. Their wall at
  1.00–1.04 is consistent with **recent** (Aug 1–6) 25× entries only.
- A recency-weighted seed (weight turnover by age at seed time, not only by decay
  afterwards) would move mass from the July shelf toward the recent band — that is the
  next hypothesis worth a measurement pass, ahead of any ladder change.
