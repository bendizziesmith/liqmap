/**
 * Calendar tick generation for a time axis.
 *
 * The axis used to step by column index — `col = c0 + i * (c1 - c0) / n` — which put labels
 * on whatever dates happened to fall at those indices. They landed on arbitrary days, two
 * neighbouring ticks could round to the same label, and every backfill prepend shifted the
 * whole row sideways because the indices moved under it.
 *
 * Ticks here come from the time domain instead: a step is chosen from a calendar ladder to
 * suit the zoom, and boundaries are aligned to local calendar units. A tick is therefore a
 * property of the date, not of the viewport, so it stays glued to its date under pan and
 * survives a prepend untouched.
 */

export interface TimeTick {
  /** Epoch ms of the boundary. */
  time: number;
  label: string;
  /** Year and month starts, plus the leftmost tick. Drawn brighter — they anchor the eye. */
  major: boolean;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The ladder of steps a chart axis is allowed to use, coarsest last.
 *
 * `unit` decides how boundaries are walked: fixed-length steps drift off the clock across a
 * DST change, and months and years have no fixed length at all, so anything a day or longer
 * is stepped with calendar arithmetic instead of by adding milliseconds.
 */
type Unit = 'minute' | 'hour' | 'day' | 'month' | 'year';
interface Step {
  unit: Unit;
  /** How many of `unit` per step. */
  n: number;
  /** Nominal length, used only to pick a step for a given zoom. */
  approx: number;
}

const LADDER: Step[] = [
  { unit: 'minute', n: 1, approx: MINUTE },
  { unit: 'minute', n: 5, approx: 5 * MINUTE },
  { unit: 'minute', n: 15, approx: 15 * MINUTE },
  { unit: 'minute', n: 30, approx: 30 * MINUTE },
  { unit: 'hour', n: 1, approx: HOUR },
  { unit: 'hour', n: 3, approx: 3 * HOUR },
  { unit: 'hour', n: 6, approx: 6 * HOUR },
  { unit: 'hour', n: 12, approx: 12 * HOUR },
  { unit: 'day', n: 1, approx: DAY },
  { unit: 'day', n: 2, approx: 2 * DAY },
  { unit: 'day', n: 7, approx: 7 * DAY },
  { unit: 'day', n: 14, approx: 14 * DAY },
  { unit: 'month', n: 1, approx: 30.4 * DAY },
  { unit: 'month', n: 3, approx: 91 * DAY },
  { unit: 'month', n: 6, approx: 182 * DAY },
  { unit: 'year', n: 1, approx: 365 * DAY },
  { unit: 'year', n: 2, approx: 730 * DAY },
  { unit: 'year', n: 5, approx: 1826 * DAY },
  { unit: 'year', n: 10, approx: 3652 * DAY },
];

/** First boundary of `step` at or after `t`, in local time. */
function firstBoundary(t: number, step: Step): number {
  const d = new Date(t);
  switch (step.unit) {
    case 'minute': {
      d.setSeconds(0, 0);
      const m = d.getMinutes();
      const up = Math.ceil(m / step.n) * step.n;
      d.setMinutes(up);
      break;
    }
    case 'hour': {
      d.setMinutes(0, 0, 0);
      const h = d.getHours();
      const up = Math.ceil(h / step.n) * step.n;
      d.setHours(up);
      break;
    }
    case 'day': {
      d.setHours(0, 0, 0, 0);
      if (step.n === 1) break;
      // Anchored to the month so day steps stay put as the window pans: "every 7th day from
      // wherever the view starts" would slide, "the 1st, 8th, 15th…" does not.
      const day = d.getDate() - 1;
      const up = Math.ceil(day / step.n) * step.n;
      d.setDate(up + 1);
      break;
    }
    case 'month': {
      d.setHours(0, 0, 0, 0);
      d.setDate(1);
      const up = Math.ceil(d.getMonth() / step.n) * step.n;
      d.setMonth(up);
      break;
    }
    case 'year': {
      d.setHours(0, 0, 0, 0);
      d.setMonth(0, 1);
      d.setFullYear(Math.ceil(d.getFullYear() / step.n) * step.n);
      break;
    }
  }
  return d.getTime() < t ? advance(d.getTime(), step) : d.getTime();
}

/** Next boundary after `t`, walked in calendar units so DST and month lengths behave. */
function advance(t: number, step: Step): number {
  const d = new Date(t);
  switch (step.unit) {
    case 'minute':
      // Trailing args zero the seconds and ms only — the minutes are the thing being set.
      d.setMinutes(d.getMinutes() + step.n, 0, 0);
      break;
    case 'hour':
      d.setHours(d.getHours() + step.n, 0, 0, 0);
      break;
    case 'day': {
      if (step.n === 1) {
        d.setDate(d.getDate() + 1);
        d.setHours(0, 0, 0, 0);
        break;
      }
      // Re-anchor at each month start rather than letting the stride run across the
      // boundary, so the same dates are always chosen regardless of where the view begins.
      const next = d.getDate() - 1 + step.n;
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      if (next >= daysInMonth) {
        d.setMonth(d.getMonth() + 1, 1);
      } else {
        d.setDate(next + 1);
      }
      d.setHours(0, 0, 0, 0);
      break;
    }
    case 'month':
      d.setMonth(d.getMonth() + step.n, 1);
      d.setHours(0, 0, 0, 0);
      break;
    case 'year':
      d.setFullYear(d.getFullYear() + step.n, 0, 1);
      d.setHours(0, 0, 0, 0);
      break;
  }
  return d.getTime();
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Ticks for the time range `[t0, t1]` across `width` pixels.
 *
 * `minGapPx` is the closest two labels may sit; the step is the finest ladder entry that
 * still respects it, so zooming in reveals finer units without labels ever colliding.
 */
export function timeTicks(t0: number, t1: number, width: number, minGapPx = 90): TimeTick[] {
  const span = t1 - t0;
  if (!(span > 0) || !(width > 0)) return [];

  const maxTicks = Math.max(1, Math.floor(width / minGapPx));
  const wanted = span / maxTicks;
  const step = LADDER.find((s) => s.approx >= wanted) ?? LADDER[LADDER.length - 1];

  const times: number[] = [];
  for (let t = firstBoundary(t0, step); t <= t1; t = advance(t, step)) {
    times.push(t);
    if (times.length > 512) break; // guard against a pathological range
  }

  return times.map((time) => label(time, step));
}

/**
 * A tick's label, derived from its own date alone.
 *
 * Deliberately not a function of the neighbouring ticks. Labelling relative to the previous
 * tick ("promote whichever tick opens a new month") reads well but is not stable: pan by one
 * step and the tick that used to be second becomes first, so its label changes under a chart
 * that has not otherwise moved. Keying on the date means a tick is glued to it.
 */
function label(time: number, step: Step): TimeTick {
  const d = new Date(time);
  const midnight = d.getHours() === 0 && d.getMinutes() === 0;

  if (midnight && d.getDate() === 1) {
    // Whole years read as the year; every other month start as its name.
    return d.getMonth() === 0
      ? { time, label: String(d.getFullYear()), major: true }
      : { time, label: MONTHS[d.getMonth()], major: true };
  }

  if (step.approx >= DAY) {
    // A weekly stride walks past enough months for bare day numbers to repeat, so those
    // carry their month. Finer strides cannot span two months' worth of the same number.
    return step.approx >= 7 * DAY
      ? { time, label: `${MONTHS[d.getMonth()]} ${d.getDate()}`, major: false }
      : { time, label: String(d.getDate()), major: false };
  }

  // Intraday: midnight is the one tick that has to say which day it opens.
  if (midnight) {
    return { time, label: `${MONTHS[d.getMonth()]} ${d.getDate()}`, major: true };
  }
  return { time, label: `${pad(d.getHours())}:${pad(d.getMinutes())}`, major: false };
}
