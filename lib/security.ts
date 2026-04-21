import { NextRequest } from 'next/server'
import { prisma } from './prisma'

export type RateLimitResult = {
  ok: boolean
  remaining: number
  retryAfterSeconds: number
}

type CounterRecord = {
  count: number
  resetAt: number
}

type RateLimitInput = {
  key: string
  max: number
  windowMs: number
}

type SharedRateLimitInput = RateLimitInput & {
  bucket: string
}

const globalStore = globalThis as typeof globalThis & {
  __createCanyonRateLimits?: Map<string, CounterRecord>
}

function getStore() {
  if (!globalStore.__createCanyonRateLimits) globalStore.__createCanyonRateLimits = new Map<string, CounterRecord>()
  return globalStore.__createCanyonRateLimits
}

function now() {
  return Date.now()
}

function cleanExpired() {
  const store = getStore()
  const ts = now()
  for (const [key, value] of store.entries()) {
    if (value.resetAt <= ts) store.delete(key)
  }
}

function sharedRateLimitEntityId(bucket: string, key: string) {
  return `${bucket}:${key}`.slice(0, 191)
}

export function getClientIp(req: NextRequest) {
  const forwarded = req.headers.get('x-forwarded-for') || ''
  const firstForwarded = forwarded.split(',').map((value: string) => value.trim()).find(Boolean)
  return firstForwarded || req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip') || 'unknown'
}

export function consumeRateLimit(input: RateLimitInput): RateLimitResult {
  cleanExpired()
  const store = getStore()
  const ts = now()
  const existing = store.get(input.key)

  if (!existing || existing.resetAt <= ts) {
    store.set(input.key, { count: 1, resetAt: ts + input.windowMs })
    return { ok: true, remaining: Math.max(input.max - 1, 0), retryAfterSeconds: Math.ceil(input.windowMs / 1000) }
  }

  if (existing.count >= input.max) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(Math.ceil((existing.resetAt - ts) / 1000), 1),
    }
  }

  existing.count += 1
  store.set(input.key, existing)
  return {
    ok: true,
    remaining: Math.max(input.max - existing.count, 0),
    retryAfterSeconds: Math.max(Math.ceil((existing.resetAt - ts) / 1000), 1),
  }
}

export async function consumeSharedRateLimit(input: SharedRateLimitInput): Promise<RateLimitResult> {
  const localResult = consumeRateLimit({ key: `${input.bucket}:${input.key}`, max: input.max, windowMs: input.windowMs })
  if (!localResult.ok) return localResult

  const windowStart = new Date(Date.now() - input.windowMs)
  const entityId = sharedRateLimitEntityId(input.bucket, input.key)

  try {
    const recentHits = await prisma.auditLog.findMany({
      where: {
        entityType: 'rate_limit',
        entityId,
        action: 'rate_limit.hit',
        createdAt: { gte: windowStart },
      },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: input.max,
    })

    if (recentHits.length >= input.max) {
      const retryAfterSeconds = Math.max(
        Math.ceil((recentHits[0].createdAt.getTime() + input.windowMs - Date.now()) / 1000),
        1,
      )
      return {
        ok: false,
        remaining: 0,
        retryAfterSeconds,
      }
    }

    await prisma.auditLog.create({
      data: {
        entityType: 'rate_limit',
        entityId,
        action: 'rate_limit.hit',
        details: {
          bucket: input.bucket,
          key: input.key,
          max: input.max,
          windowMs: input.windowMs,
        } as any,
      },
    })

    return {
      ok: true,
      remaining: Math.min(localResult.remaining, Math.max(input.max - recentHits.length - 1, 0)),
      retryAfterSeconds: Math.max(localResult.retryAfterSeconds, 1),
    }
  } catch {
    return localResult
  }
}

export async function resetRateLimit(key: string) {
  getStore().delete(key)
  try {
    await prisma.auditLog.deleteMany({
      where: {
        entityType: 'rate_limit',
        entityId: key.slice(0, 191),
        action: 'rate_limit.hit',
      },
    })
  } catch {
    // best effort shared reset
  }
}
