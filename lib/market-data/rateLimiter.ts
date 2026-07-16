/**
 * A simple sliding-window rate limiter. Tracks request timestamps in memory
 * and refuses new requests once the limit is hit within the window,
 * instead of silently sending them and getting a 429 back from the
 * provider. Per-provider instances should be sized to that provider's
 * documented limit (e.g. Alpaca free tier: 200 requests/minute).
 */
export class RateLimiter {
  private timestamps: number[] = [];

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  /** Returns true if a request can be made right now without exceeding the limit. */
  canProceed(now: number = Date.now()): boolean {
    this.prune(now);
    return this.timestamps.length < this.maxRequests;
  }

  /** Records a request. Call this only after canProceed() returned true. */
  recordRequest(now: number = Date.now()): void {
    this.timestamps.push(now);
  }

  /** How many requests are still available in the current window. */
  remaining(now: number = Date.now()): number {
    this.prune(now);
    return Math.max(0, this.maxRequests - this.timestamps.length);
  }

  /** Milliseconds until the oldest tracked request falls out of the window. */
  msUntilNextSlot(now: number = Date.now()): number {
    this.prune(now);
    if (this.timestamps.length < this.maxRequests) return 0;
    const oldest = this.timestamps[0];
    return Math.max(0, oldest + this.windowMs - now);
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
  }
}
