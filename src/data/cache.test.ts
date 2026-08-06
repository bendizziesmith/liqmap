import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TtlCache } from './cache';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('TtlCache', () => {
  it('produces a value on first request', async () => {
    const cache = new TtlCache<number>(1000);
    expect(await cache.get('k', async () => 42)).toBe(42);
  });

  it('serves repeat requests without re-producing', async () => {
    const cache = new TtlCache<number>(1000);
    const produce = vi.fn(async () => 42);

    await cache.get('k', produce);
    await cache.get('k', produce);
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight promise between concurrent callers', async () => {
    const cache = new TtlCache<number>(1000);
    const produce = vi.fn(() => Promise.resolve(7));

    const [a, b] = await Promise.all([cache.get('k', produce), cache.get('k', produce)]);
    expect(produce).toHaveBeenCalledTimes(1);
    expect([a, b]).toEqual([7, 7]);
  });

  it('re-produces once the TTL has elapsed', async () => {
    const cache = new TtlCache<number>(1000);
    const produce = vi.fn(async () => 42);

    await cache.get('k', produce);
    vi.advanceTimersByTime(1001);
    await cache.get('k', produce);
    expect(produce).toHaveBeenCalledTimes(2);
  });

  it('keys entries independently', async () => {
    const cache = new TtlCache<string>(1000);
    expect(await cache.get('a', async () => 'A')).toBe('A');
    expect(await cache.get('b', async () => 'B')).toBe('B');
  });

  it('does not cache a rejection', async () => {
    const cache = new TtlCache<number>(1000);
    const produce = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(99);

    await expect(cache.get('k', produce)).rejects.toThrow('boom');
    expect(await cache.get('k', produce)).toBe(99);
  });

  it('drops an entry on invalidate', async () => {
    const cache = new TtlCache<number>(1000);
    const produce = vi.fn(async () => 1);

    await cache.get('k', produce);
    cache.invalidate('k');
    await cache.get('k', produce);
    expect(produce).toHaveBeenCalledTimes(2);
  });
});
