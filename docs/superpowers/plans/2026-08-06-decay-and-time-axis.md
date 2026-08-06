# Level decay, the 1d above-price deficit, and a real time axis

## 2. Debugging first: why 1d looks sparse above price

Four measurement passes over live Bybit data, running the real engine functions
(`scripts/debug-1d*.ts`). XRPUSDT, price ~1.044, 1000 candles each on 1d and 4h.

### H-b — "shorts aren't being seeded" — REFUTED

Mass seeded above the then-current price over the whole walk, versus below:

| interval | seeded above | seeded below | ratio |
|---|---|---|---|
| 1d | $377.80B | $390.80B | **0.967** |
| 4h | $24.16B | $24.19B | 0.999 |

Both sides are seeded to within 3%. Not the cause.

### H-a — "daily ranges wipe everything near price" — REFUTED AS AN ASYMMETRY, real as a 1d/4h difference

Share of a candle's own seeds still alive after the very next candle clears:

| interval | above | below |
|---|---|---|
| 1d | 90.9% | 90.8% |
| 4h | 99.5% | 99.6% |

Symmetric to within 0.1pp, so it cannot produce an above-price deficit. It *is* a genuine
1d-versus-4h difference, localised to the near-price tiers:

| | 1d | 4h |
|---|---|---|
| median candle range | 4.6% of close | 1.4% |
| candles whose range exceeds the 25× liq distance (4%) | **60.3%** | 3.5% |
| candles whose range exceeds the 10× liq distance (10%) | 11.0% | 0.0% |
| median lifetime of a fresh 25× level (candles) | 5 above / 3 below | 45 / 31 |

On a daily chart the only tier that can populate the ±5% band dies within a handful of
candles, because a daily range is wider than its liquidation distance six days in ten. That
starves **both** sides near price, which is why it is not the reported asymmetry.

### H-c — "rendering suppression" — CONFIRMED, and it is the primary cause

Not by the guessed mechanism. Class breaks are already computed over visible cells only
(`computeVmax` / `classBreaks` take a bucket range), so the off-screen shelf never inflated
them. The real mechanism is **per-bucket density against a shared percentile scale**.

Price sits near the bottom of the 200-day range, so the default window is 253 buckets above
price and 28 below. Measured over that window:

| | above price | below price |
|---|---|---|
| on-screen mass, final column | **$28.16B** | $10.75B |
| painted cells | 41552 / 50600 (82.1%) | 5253 / 5600 (93.8%) |
| class 0 (faintest) | 45.2% | 9.4% |
| class 4 (heaviest) | **0.6%** | **20.1%** |
| hot cells (class ≥ 3) | **3.9%** | **49.2%** |

The above side holds **2.6× more mass** and renders with **1/12.6th the hot-cell density**.
One shared percentile ladder is dominated by the below-price cluster squeezed into 28
buckets, so the entire upper structure collapses into the two faintest classes. The render
is hiding more than it shows.

### Secondary engine cause: ghosts (this is issue 1)

Active book above price, by age and distance:

| age since seeded | above | below |
|---|---|---|
| < 30d | $6.87B (5.8%) | $23.19B (49.5%) |
| 180–365d | **$81.06B (67.9%)** | $0 |
| > 365d | $10.67B (8.9%) | $20.53B (43.8%) |

76.4% of all above-price mass is off screen, parked at 3.72–4.14 (≈4× price) and last
seeded 300–390 days ago. Because displayed USD is calibrated by rescaling the *whole* active
book to open interest, those ghosts were absorbing most of the USD budget.

### Fixes evaluated

Prototyped and swept before writing any engine code (`scripts/debug-1d-stage4.ts`):

| fix | ghost mass >2× price | hot-cell density above / below |
|---|---|---|
| baseline | $91.53B | 3.9% / 49.2% |
| + wick retention 0.25–0.55 | $92.6–95.0B | 4.5–4.9% / 44–48% |
| + decay | **$1.25B** | 5.3% / 34.9% |
| + decay + per-side breaks | $1.25B | **8.1% / 9.1%** |

**Wick-strength clearing is rejected by measurement.** It moves the near-price above:below
ratio from 0.007 to 0.006 — it preserves mass on both sides equally, so it cannot correct an
asymmetry. Not shipped.

**Sub-candle clearing is rejected on cost.** The union of six 4h ranges is the daily range,
so it barely changes what gets cleared; it would cost 6× the data (6000 candles past a
1000-candle page limit) for a change to seed anchor placement, not to the indicted metric.

**Shipping: decay + per-side class breaks.** Decay removes the ghost shelf (73× less mass
above 2× price) and frees the OI budget for recent levels; per-side breaks restore the upper
structure the shared ladder was erasing.

## 1. Level decay

Positions mostly close *without* liquidating, so a level that was never swept is not
evidence of a standing position. Each tier ages exponentially per candle:

    factor = 2 ^ -(candleDuration / halfLife)

Half-lives, scaled to realistic holding periods by leverage — high leverage cannot be held
long because ordinary noise liquidates it:

| mode | tier | half-life |
|---|---|---|
| scalping | 10× | 5d |
| | 25× | 2d |
| | 50× | 1d |
| | 100× | 12h |
| swing | 3× | 60d |
| | 5× | 30d |
| | 10× | 14d |
| | 25× | 5d |

Applied in the same pass as clearing (decay → clear → seed) so historical columns are
consistent and a 2024 level visibly fades across columns. Values under 1e-6 of the column
max are floored to zero to keep the matrices sparse.

Settings toggle "Level decay", on by default; off must reproduce current output bit-for-bit.

## 3. Time axis

`src/ui/timeAxis.ts` — pure `timeTicks(t0, t1, widthPx)` returning
`{ time, label, major }[]`. Step chosen from a calendar ladder (minute → year) by zoom;
boundaries aligned to local calendar units so a tick stays glued to its date under pan and
through a backfill prepend. Year starts label "2025" and month starts "Mar" as major ticks;
day numbers and HH:mm between.

## Verification

Tests + build green, deploy, then live on XRPUSDT 1d/4h and BTCUSDT 4h: ghost shelves faded
with decay on and restored with it off; above/below painted-area and hot-density ratios
stated before and after; axis dates on real boundaries, stable under pan and prepend.
