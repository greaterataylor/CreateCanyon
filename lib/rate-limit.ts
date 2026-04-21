type RateLimitBucket = {
  count: number
  windowStartedAt: number
  blockedUntil: number
}

declare global {
  // eslint-disable-next-line no-var
  var __simpleRateLimitBuckets: Map<string, RateLimitBucket> | undefined
}

const buckets = globalThis.__simpleRateLimitBuckets || new Map<string, RateLimitBucket>()

if (!globalThis.__simpleRateLimitBuckets) {
  globalThis.__simpleRateLimitBuckets = buckets
}

function currentBucket(now: number, windowMs: number, existing?: RateLimitBucket) {
  if (!existing || now - existing.windowStartedAt >= windowMs) {
    return { count: 0, windowStartedAt: now, blockedUntil: 0 }
  }
  return existing
}

function pruneExpired(now: number) {
  for (const [key, value] of buckets.entries()) {
    if (value.blockedUntil && value.blockedUntil > now) continue
    if (now - value.windowStartedAt > 24 * 60 * 60 * 1000) buckets.delete(key)
  }
}

export function consumeRateLimit(key: string, options: { windowMs: number; max: number; blockMs?: number }) {
  const now = Date.now()
  pruneExpired(now)
  const active = currentBucket(now, options.windowMs, buckets.get(key))

  if (active.blockedUntil && active.blockedUntil > now) {
    buckets.set(key, active)
    return {
      ok: false,
      remaining: 0,
      retryAfterMs: active.blockedUntil - now,
    }
  }

  active.count += 1

  if (active.count > options.max) {
    active.blockedUntil = now + (options.blockMs || options.windowMs)
    buckets.set(key, active)
    return {
      ok: false,
      remaining: 0,
      retryAfterMs: active.blockedUntil - now,
    }
  }

  buckets.set(key, active)
  return {
    ok: true,
    remaining: Math.max(options.max - active.count, 0),
    retryAfterMs: 0,
  }
}

export function resetRateLimit(key: string) {
  buckets.delete(key)
}

export function clientAddress(headers: Headers) {
  const forwardedFor = headers.get('x-forwarded-for') || headers.get('x-real-ip') || headers.get('cf-connecting-ip') || ''
  const firstHop = forwardedFor.split(',')[0]?.trim()
  return firstHop || 'unknown'
}

export function clientIpAddress(input: { headers: Headers } | Headers) {
  return input instanceof Headers ? clientAddress(input) : clientAddress(input.headers)
}

export function hitRateLimit(input: { bucket: string; key: string; limit: number; windowMs: number; blockMs?: number }) {
  const result = consumeRateLimit(`${input.bucket}:${input.key}`, {
    max: input.limit,
    windowMs: input.windowMs,
    blockMs: input.blockMs,
  })
  return {
    ok: result.ok,
    remaining: result.remaining,
    retryAfterMs: result.retryAfterMs,
    retryAfterSeconds: Math.max(Math.ceil(result.retryAfterMs / 1000), 1),
  }
}

export function clearRateLimit(bucket: string, key: string) {
  resetRateLimit(`${bucket}:${key}`)
}
