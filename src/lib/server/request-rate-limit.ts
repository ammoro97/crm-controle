type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterSeconds: number;
  resetAt: number;
};

type EnforceRateLimitInput = {
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __crmRateLimitStore: Map<string, RateLimitBucket> | undefined;
}

const RATE_LIMIT_STORE_MAX_ENTRIES = 20_000;

function getStore(): Map<string, RateLimitBucket> {
  if (!globalThis.__crmRateLimitStore) {
    globalThis.__crmRateLimitStore = new Map<string, RateLimitBucket>();
  }
  return globalThis.__crmRateLimitStore;
}

function cleanupExpiredBuckets(store: Map<string, RateLimitBucket>, now: number) {
  for (const [key, bucket] of store.entries()) {
    if (bucket.resetAt <= now) {
      store.delete(key);
    }
  }
}

function cleanupStoreSize(store: Map<string, RateLimitBucket>) {
  if (store.size <= RATE_LIMIT_STORE_MAX_ENTRIES) return;
  const overflow = store.size - RATE_LIMIT_STORE_MAX_ENTRIES;
  let removed = 0;
  for (const key of store.keys()) {
    store.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

export function getRequestClientIdentifier(request: Request): string {
  const forwardedFor = String(request.headers.get("x-forwarded-for") || "")
    .split(",")[0]
    .trim();
  const realIp = String(request.headers.get("x-real-ip") || "").trim();
  const cfIp = String(request.headers.get("cf-connecting-ip") || "").trim();
  const fallbackIp = "unknown-ip";
  const ip = forwardedFor || realIp || cfIp || fallbackIp;
  const userAgent = String(request.headers.get("user-agent") || "unknown-agent").slice(0, 120);
  return `${ip}:${userAgent}`;
}

export function enforceRateLimit(input: EnforceRateLimitInput): RateLimitResult {
  const now = input.now ?? Date.now();
  const store = getStore();
  cleanupExpiredBuckets(store, now);
  cleanupStoreSize(store);

  const key = input.key;
  const existing = store.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + input.windowMs;
    store.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: Math.max(0, input.limit - 1),
      limit: input.limit,
      retryAfterSeconds: Math.ceil(input.windowMs / 1000),
      resetAt,
    };
  }

  const nextCount = existing.count + 1;
  const limited = nextCount > input.limit;
  store.set(key, { count: nextCount, resetAt: existing.resetAt });

  const retryAfterMs = Math.max(0, existing.resetAt - now);
  return {
    allowed: !limited,
    remaining: Math.max(0, input.limit - nextCount),
    limit: input.limit,
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    resetAt: existing.resetAt,
  };
}
