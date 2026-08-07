# Tuning notes — XRPUSDT 4h vs the reference tool

2026-08-07, build `1ee8ade`, price 1.0228 at measurement time. Engine numbers below were
extracted with the shipped `buildHeatmap` from live Bybit data and independently
re-derived to the digit by a second pass before being written down.

## Cluster comparison

Top-8 active-book clusters (final column, all four tiers), share of total book:

| # | decay OFF | share | decay ON | share | side |
|---|---|---|---|---|---|
| 1 | 1.5501–1.9442 (peak 1.6122) | 36.9% | 0.8245–0.9969 (peak 0.9067) | 28.3% | OFF above / ON below |
| 2 | 0.8352–1.0076 (peak 0.9067) | 28.4% | 1.2441–1.5447 (peak 1.4559) | 26.8% | OFF below / ON above |
| 3 | 1.2361–1.5501 (peak 1.4639) | 19.8% | 0.6869–0.7737 (peak 0.7236) | 15.3% | above / below |
| 4 | 0.6869–0.7925 (peak 0.7597) | 7.9% | 1.7452–1.9456 (peak 1.9075) | 13.1% | below / above |
| 5 | 1.1639–1.2361 (peak 1.2234) | 2.3% | 1.5447–1.6837 (peak 1.6122) | 4.9% | above |
| 6 | 0.7925–0.8352 (peak 0.8265) | 1.3% | 1.1519–1.2361 (peak 1.2247) | 2.5% | below / above |
| 7 | 1.9442–1.9736 (peak 1.9529) | 1.0% | 1.6837–1.7452 (peak 1.6910) | 2.3% | above |
| 8 | 1.9736–1.9923 (peak 1.9850) | 0.5% | 1.9456–1.9923 (peak 1.9529) | 1.3% | above |

Against the reference's two named features:

| reference feature | ours (decay OFF) | ours (decay ON) | verdict |
|---|---|---|---|
| 0.90–0.95 shelf | dominant below-price cluster, peak **0.9067**, 28.4% | same peak, 28.3% | **HIT** — same price, same rank (top below-price pool) |
| heaviest band just below price, 1.00–1.02 | 3.17% of book in [0.98, 1.03] | 2.52% | **MISS** — present but ~6× lighter than our 0.88–0.96 shelf, not dominant |
| — | 60.5% of book in above-price clusters 1.16–1.99 | 50.9% (of a book 32% the size) | **EXTRA** — far-above short-liq shelf the reference de-emphasises; decay ON shrinks it ~5.4× in absolute mass |

## Why the 1.00–1.02 band is missing, and which knob recovers it

With price at 1.0228, a long liquidation at 1.00–1.02 sits **0.8–2.2% below price**, which
requires leverage `L = 1/distance ≈ 45–125×`. The 4h chart uses the swing ladder
`3/5/10/25×`, whose nearest fresh long band is 4% below entry — from current-price entries
that lands at ≈0.982, not 1.00–1.02. The band the reference draws there is, by its own
distance, the **50×/100× bracket seeded from entries at or near the current price**
(50× from 1.0228 → 1.0023; 100× → 1.0126). Two compounding reasons we show little there:

1. **Ladder cut-off (the knob that matters).** 50× and 100× exist only on the scalping
   ladder (≤1h). Nothing seeded on 4h can land 1–2% from its entry.
2. **Clearing (working as designed).** Price wicked to 0.9923 within the measured window,
   sweeping [0.9923, ~1.03]; the audit's four both-empty rows at 1.02–1.05 are that sweep.
   Levels re-seeded since sit at ≥4% distances. The reference either does not clear on
   sweep or re-populates the band instantly from high-leverage brackets.

Knobs that CANNOT recover it, checked: decay half-lives (rescale existing mass, cannot
create levels where none are seeded), the OI factor (per-column scalar, same), anchor
weights (anchors move entries by ~one candle range ≈1.4%; a 25× liq from any recent entry
still lands ≤0.98).

## Recommendation (not applied)

Extend the swing ladder with a high-leverage tail: `[3, 5, 10, 25, 50]` with capital split
`[0.32, 0.27, 0.18, 0.13, 0.10]` (sums to 1, so USD conservation and OI calibration are
untouched). Quantified effect at measurement time: ~10% of each candle's seeded notional
would land at 2% distance — from the last few candles' entries (1.02–1.03) that is
1.000–1.010, directly under the reference's band, and ~0.5–1.5% of the total book after
clearing — enough to rank it as a distinct near-price cluster without displacing the
0.90–0.95 shelf.

Why it is a recommendation rather than a change: it redefines what the four tier toggles
mean (every `enabledTiers` array, the tier colour ramps and the Map panel labels are
4-wide), and it moves the model's stated position that swing timeframes exclude
scalper leverage — a product call, not a bug fix. No conservation or OI test would break;
the UI and the model's documentation would both need deliberate updating.

## Honest-comparison caveats

The reference is a different venue (Binance vs our Bybit) and a different, undisclosed
model; colour/unit equality is out of scope. Its screenshots are not in this repo — the
comparison above is against the two features named in the task brief. Drop the crop into
`docs/reference/` (see its README) to tighten this table.
