interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * A small in-memory TTL cache. Intentionally simple (no external
 * dependency, no persistence) — this is process-local caching to avoid
 * hammering a provider on every dashboard refresh, not a distributed
 * cache. Fine for a single Next.js server instance; would need Redis or
 * similar if this ever runs across multiple instances.
 */
export class TtlCache<T> {
  private store = new Map<string, CacheEntry<T>>();

  constructor(private readonly defaultTtlMs: number) {}

  get(key: string, now: number = Date.now()): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number = this.defaultTtlMs, now: number = Date.now()): void {
    this.store.set(key, { value, expiresAt: now + ttlMs });
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

/**
 * Suggested TTLs per timeframe — shorter timeframes go stale faster and
 * are worth refreshing more often; daily candles barely change intraday.
 */
export const CANDLE_CACHE_TTL_MS = {
  "5m": 30_000,
  "15m": 60_000,
  "1d": 5 * 60_000,
} as const;
