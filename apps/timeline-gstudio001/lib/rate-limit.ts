/**
 * A fixed-window rate limiter, in process memory.
 *
 * Deliberately NOT distributed. On a serverless platform each instance keeps
 * its own counters, so the effective ceiling is `limit × instances` rather
 * than `limit` — which is the honest trade for a limiter that needs no
 * infrastructure and cannot itself fail a request. It turns "unlimited" into
 * "bounded per instance", which is the difference that matters for the
 * endpoint it guards; a hard global ceiling belongs at the edge (a WAF rule),
 * and this does not pretend to be one.
 *
 * Pure and dependency-free so the window arithmetic is unit-testable.
 */

export type RateLimitVerdict = Readonly<{
  allowed: boolean;
  /** Seconds until this key's window resets — the `Retry-After` value. */
  retryAfterSeconds: number;
}>;

export type RateLimiter = Readonly<{
  check: (key: string, now?: number) => RateLimitVerdict;
}>;

type Window = { count: number; resetAt: number };

export function createRateLimiter(
  options: Readonly<{ limit: number; windowMs: number; maxKeys?: number }>,
): RateLimiter {
  const { limit, windowMs, maxKeys = 10_000 } = options;
  const windows = new Map<string, Window>();

  /** Bounded so a flood of distinct keys (one per spoofed IP) cannot grow this
   *  map without limit — dropping the oldest insertions first. */
  const evictIfNeeded = (now: number) => {
    if (windows.size < maxKeys) return;
    for (const [key, window] of windows) {
      if (window.resetAt <= now) windows.delete(key);
    }
    while (windows.size >= maxKeys) {
      const oldest = windows.keys().next();
      if (oldest.done) break;
      windows.delete(oldest.value);
    }
  };

  return {
    check: (key, now = Date.now()) => {
      const existing = windows.get(key);
      if (!existing || existing.resetAt <= now) {
        evictIfNeeded(now);
        windows.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, retryAfterSeconds: Math.ceil(windowMs / 1000) };
      }
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      if (existing.count >= limit) {
        return { allowed: false, retryAfterSeconds };
      }
      existing.count += 1;
      return { allowed: true, retryAfterSeconds };
    },
  };
}

/**
 * The caller's address, from the proxy headers Vercel sets.
 *
 * `x-forwarded-for` is client-controllable on a server reached directly, so
 * this is a best-effort bucket key, not an identity — which is why the login
 * route rate-limits on the ADDRESS too. The LEFTMOST entry is the client per
 * the header's own convention.
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip")?.trim() || "unknown";
}
