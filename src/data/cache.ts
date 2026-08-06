interface Entry<T> {
  value: Promise<T>;
  expires: number;
}

/**
 * Promise-level TTL memo.
 *
 * Caching the promise rather than the value means five watchlist rows mounting at once
 * share one in-flight request instead of racing Bybit's rate limiter. A rejected lookup is
 * evicted immediately so a transient failure is not cached for the full TTL.
 */
export class TtlCache<T> {
  private entries = new Map<string, Entry<T>>();

  constructor(private ttlMs: number) {}

  get(key: string, produce: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && hit.expires > now) return hit.value;

    const value = produce();
    this.entries.set(key, { value, expires: now + this.ttlMs });

    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });

    return value;
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
