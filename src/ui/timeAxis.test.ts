import { describe, it, expect } from 'vitest';
import { timeTicks } from './timeAxis';

const at = (iso: string) => new Date(iso).getTime();
const DAY = 864e5;

/** Local-time helpers: ticks align to the viewer's calendar, not to UTC. */
const isMidnight = (t: number) => {
  const d = new Date(t);
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
};
const isMonthStart = (t: number) => isMidnight(t) && new Date(t).getDate() === 1;
const isYearStart = (t: number) => isMonthStart(t) && new Date(t).getMonth() === 0;

describe('tick placement', () => {
  it('returns ticks in ascending order, all inside the range', () => {
    const t0 = at('2026-03-11T00:00:00');
    const t1 = at('2026-05-02T00:00:00');
    const ticks = timeTicks(t0, t1, 900);

    expect(ticks.length).toBeGreaterThan(1);
    for (let i = 0; i < ticks.length; i++) {
      expect(ticks[i].time).toBeGreaterThanOrEqual(t0);
      expect(ticks[i].time).toBeLessThanOrEqual(t1);
      if (i > 0) expect(ticks[i].time).toBeGreaterThan(ticks[i - 1].time);
    }
  });

  it('lands on real calendar boundaries, never on arbitrary offsets', () => {
    // Two months across 900px: the generator should pick whole days or weeks, and every
    // tick must sit at local midnight rather than at "start + k * span/8".
    const ticks = timeTicks(at('2026-03-11T13:47:00'), at('2026-05-02T09:12:00'), 900);
    expect(ticks.length).toBeGreaterThan(2);
    for (const t of ticks) expect(isMidnight(t.time)).toBe(true);
  });

  it('uses month boundaries over a multi-year span', () => {
    const ticks = timeTicks(at('2024-02-05T00:00:00'), at('2026-08-06T00:00:00'), 900);
    expect(ticks.length).toBeGreaterThan(2);
    for (const t of ticks) expect(isMonthStart(t.time)).toBe(true);
  });

  it('uses year boundaries over a decade', () => {
    const ticks = timeTicks(at('2016-04-01T00:00:00'), at('2026-08-06T00:00:00'), 900);
    for (const t of ticks) expect(isYearStart(t.time)).toBe(true);
  });

  it('uses clock times when zoomed into a single day', () => {
    const ticks = timeTicks(at('2026-08-06T02:00:00'), at('2026-08-06T20:00:00'), 900);
    expect(ticks.length).toBeGreaterThan(2);
    // Whole hours, and at least one that is not midnight — otherwise it fell back to days.
    for (const t of ticks) {
      const d = new Date(t.time);
      expect(d.getMinutes()).toBe(0);
      expect(d.getSeconds()).toBe(0);
    }
    expect(ticks.some((t) => !isMidnight(t.time))).toBe(true);
  });

  it('uses minutes when zoomed into a couple of hours', () => {
    const ticks = timeTicks(at('2026-08-06T09:00:00'), at('2026-08-06T11:00:00'), 900);
    expect(ticks.length).toBeGreaterThan(2);
    for (const t of ticks) expect(new Date(t.time).getSeconds()).toBe(0);
    expect(ticks.some((t) => new Date(t.time).getMinutes() !== 0)).toBe(true);
  });
});

describe('density', () => {
  it('honours the minimum label gap, so labels never collide', () => {
    const t0 = at('2026-01-01T00:00:00');
    const t1 = at('2026-07-01T00:00:00');
    for (const width of [320, 640, 900, 1600]) {
      const ticks = timeTicks(t0, t1, width, 90);
      const minSpacing = ((ticks.at(-1)!.time - ticks[0].time) / Math.max(1, ticks.length - 1))
        * (width / (t1 - t0));
      if (ticks.length > 1) expect(minSpacing).toBeGreaterThanOrEqual(88);
    }
  });

  it('gets denser in time as you zoom in', () => {
    const wide = timeTicks(at('2026-01-01T00:00:00'), at('2026-12-31T00:00:00'), 900);
    const tight = timeTicks(at('2026-03-01T00:00:00'), at('2026-03-20T00:00:00'), 900);
    const step = (t: ReturnType<typeof timeTicks>) => t[1].time - t[0].time;
    expect(step(tight)).toBeLessThan(step(wide));
  });

  it('gives a wider chart more ticks over the same range', () => {
    const t0 = at('2026-01-01T00:00:00');
    const t1 = at('2026-07-01T00:00:00');
    expect(timeTicks(t0, t1, 1600).length).toBeGreaterThan(timeTicks(t0, t1, 400).length);
  });
});

describe('labels', () => {
  it('emphasises year and month starts', () => {
    const ticks = timeTicks(at('2025-11-01T00:00:00'), at('2026-06-01T00:00:00'), 900);
    const jan = ticks.find((t) => isYearStart(t.time));
    expect(jan?.label).toBe('2026');
    expect(jan?.major).toBe(true);

    const march = ticks.find((t) => {
      const d = new Date(t.time);
      return d.getMonth() === 2 && d.getDate() === 1;
    });
    expect(march?.label).toBe('Mar');
    expect(march?.major).toBe(true);
  });

  it('labels intermediate ticks with the day number', () => {
    const ticks = timeTicks(at('2026-03-02T00:00:00'), at('2026-03-20T00:00:00'), 900);
    const plain = ticks.filter((t) => !t.major);
    expect(plain.length).toBeGreaterThan(0);
    for (const t of plain) expect(t.label).toBe(String(new Date(t.time).getDate()));
  });

  it('labels intraday ticks with the clock time', () => {
    const ticks = timeTicks(at('2026-08-06T02:00:00'), at('2026-08-06T20:00:00'), 900);
    const plain = ticks.filter((t) => !t.major);
    expect(plain.length).toBeGreaterThan(0);
    for (const t of plain) expect(t.label).toMatch(/^\d{2}:\d{2}$/);
  });

  const RANGES: Array<[string, string]> = [
    ['2026-03-11T00:00:00', '2026-05-02T00:00:00'],
    ['2025-01-05T00:00:00', '2026-08-06T00:00:00'],
    ['2026-08-01T00:00:00', '2026-08-07T00:00:00'],
    ['2026-08-06T00:00:00', '2026-08-06T18:00:00'],
    ['2024-01-01T00:00:00', '2026-08-06T00:00:00'],
    ['2026-06-14T00:00:00', '2026-09-28T00:00:00'],
  ];

  it('never repeats a label back to back, which is what index-stepping used to do', () => {
    // The reported symptom was two neighbouring "6/8" ticks.
    for (const [a, b] of RANGES) {
      const labels = timeTicks(at(a), at(b), 900).map((t) => t.label);
      for (let i = 1; i < labels.length; i++) expect(labels[i]).not.toBe(labels[i - 1]);
    }
  });

  it('never repeats a label within a single year', () => {
    // "Apr" may appear in 2025 and again in 2026 — the year tick between them disambiguates.
    // Two identical labels with no year boundary between them would not be readable.
    for (const [a, b] of RANGES) {
      const seen = new Set<string>();
      for (const t of timeTicks(at(a), at(b), 900)) {
        if (/^\d{4}$/.test(t.label)) seen.clear();
        expect(seen.has(t.label)).toBe(false);
        seen.add(t.label);
      }
    }
  });

  it('labels an instant the same way wherever it falls in the window', () => {
    // Purity is what makes the axis stable: the label is a property of the date, not of the
    // tick's position in the list. Labelling relative to the previous tick fails this.
    const target = at('2026-04-01T00:00:00');
    const seen = new Set<string>();
    for (const shift of [0, 1, 2, 3, 5, 9]) {
      const ticks = timeTicks(
        at('2026-03-01T00:00:00') + shift * DAY,
        at('2026-06-01T00:00:00') + shift * DAY,
        900,
      );
      const hit = ticks.find((t) => t.time === target);
      if (hit) seen.add(`${hit.label}|${hit.major}`);
    }
    expect(seen.size).toBe(1);
  });
});

describe('stability under pan', () => {
  it('keeps a tick glued to its date as the window slides', () => {
    const t0 = at('2026-03-01T00:00:00');
    const t1 = at('2026-06-01T00:00:00');

    const base = timeTicks(t0, t1, 900);
    for (const shiftDays of [1, 3, 7, 11, 30]) {
      const shifted = timeTicks(t0 + shiftDays * DAY, t1 + shiftDays * DAY, 900);
      const overlap = base.filter((b) => shifted.some((s) => s.time === b.time));
      // A pure pan keeps the span, so every boundary still in view must survive.
      expect(overlap.length).toBeGreaterThan(0);
      for (const b of overlap) {
        const match = shifted.find((s) => s.time === b.time)!;
        expect(match.label).toBe(b.label);
      }
    }
  });

  it('does not move a tick when the range grows on the left, as a backfill prepend does', () => {
    const t1 = at('2026-08-06T00:00:00');
    const before = timeTicks(at('2026-07-01T00:00:00'), t1, 900);
    const after = timeTicks(at('2026-05-01T00:00:00'), t1, 900);
    // Prepending history coarsens the step, but whatever ticks remain must still sit on the
    // same instants — the axis must not slide sideways under the chart.
    for (const a of after) {
      const sameDay = before.find((b) => b.time === a.time);
      if (sameDay) expect(sameDay.label).toBe(a.label);
    }
    expect(after.every((t) => isMidnight(t.time))).toBe(true);
  });
});

describe('degenerate input', () => {
  it('returns nothing for a zero-width or inverted range', () => {
    expect(timeTicks(1000, 1000, 900)).toEqual([]);
    expect(timeTicks(2000, 1000, 900)).toEqual([]);
    expect(timeTicks(at('2026-01-01T00:00:00'), at('2026-02-01T00:00:00'), 0)).toEqual([]);
  });

  it('survives a range far narrower than one tick step', () => {
    const t0 = at('2026-08-06T10:00:00');
    const ticks = timeTicks(t0, t0 + 1000, 900);
    expect(Array.isArray(ticks)).toBe(true);
    for (const t of ticks) {
      expect(t.time).toBeGreaterThanOrEqual(t0);
      expect(t.time).toBeLessThanOrEqual(t0 + 1000);
    }
  });
});
