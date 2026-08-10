// Tiny in-memory rate limiter (fixed window per key). Good enough for a
// single-instance MVP; swap for Redis if the platform ever scales out.
const g = globalThis as any;

interface Bucket { count: number; resetAt: number }
const buckets: Map<string, Bucket> = (g.__scloud_rl ??= new Map<string, Bucket>());

function bucket(key: string, windowMs: number): Bucket {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
    if (buckets.size > 5000) sweep(now); // keep the map from growing unbounded
  }
  return b;
}

function sweep(now: number): void {
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

// True if this key has already hit the limit in the current window (no increment).
export function over(key: string, limit: number, windowMs: number): boolean {
  return bucket(key, windowMs).count >= limit;
}

export function record(key: string, windowMs: number): void {
  bucket(key, windowMs).count++;
}

export function reset(key: string): void {
  buckets.delete(key);
}

export function retryAfterSec(key: string): number {
  const b = buckets.get(key);
  return b ? Math.max(1, Math.ceil((b.resetAt - Date.now()) / 1000)) : 1;
}

// Best-effort client IP. Caddy sets X-Forwarded-For; take the first hop.
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}
