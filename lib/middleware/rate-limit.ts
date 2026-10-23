/**
 * lib/middleware/rate-limit.ts
 *
 * Simple in-memory sliding window rate limiter.
 * Uses a Map keyed by IP address. Works in Node.js / Vercel Edge-compatible
 * serverless environments (resets per cold-start, which is acceptable for v1).
 *
 * For production scaling (multi-region), swap the Map for a Redis-backed store.
 */

interface Window {
  count: number;
  resetAt: number; // Unix ms
}

const store = new Map<string, Window>();

/**
 * Check and record a rate-limit hit.
 *
 * @param key    Unique key (e.g. `login:${ip}`)
 * @param limit  Max requests allowed in the window
 * @param windowMs  Window duration in milliseconds
 * @returns `{ allowed: true }` or `{ allowed: false, retryAfterMs: number }`
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfterMs?: number; remaining: number } {
  const now = Date.now();

  // Purge expired entries to prevent unbounded memory growth
  if (store.size > 10_000) {
    for (const [k, w] of store.entries()) {
      if (w.resetAt < now) store.delete(k);
    }
  }

  let window = store.get(key);
  if (!window || window.resetAt < now) {
    window = { count: 1, resetAt: now + windowMs };
    store.set(key, window);
    return { allowed: true, remaining: limit - 1 };
  }

  window.count += 1;

  if (window.count > limit) {
    const retryAfterMs = window.resetAt - now;
    return { allowed: false, retryAfterMs, remaining: 0 };
  }

  return { allowed: true, remaining: limit - window.count };
}

/**
 * Extract the real client IP from Next.js request headers.
 * Prefers `x-forwarded-for` (set by Vercel/proxies) then falls back to a
 * synthetic key so the limiter always has something to key on.
 */
export function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}
