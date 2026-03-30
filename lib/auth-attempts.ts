import { NextRequest, NextResponse } from 'next/server'
import { prisma } from './prisma'
import { createAuditLog } from './audit'

const SIGN_IN_WINDOW_MS = 15 * 60 * 1000
const SIGN_IN_FAILURE_LIMIT = 10
const SIGN_UP_WINDOW_MS = 30 * 60 * 1000
const SIGN_UP_FAILURE_LIMIT = 5

type AuthAttemptKind = 'sign-in' | 'sign-up'

type AuthAttemptConfig = {
  windowMs: number
  maxFailures: number
  ipEntityType: string
  emailEntityType: string
}

const AUTH_ATTEMPT_CONFIG: Record<AuthAttemptKind, AuthAttemptConfig> = {
  'sign-in': {
    windowMs: SIGN_IN_WINDOW_MS,
    maxFailures: SIGN_IN_FAILURE_LIMIT,
    ipEntityType: 'auth_sign_in_ip',
    emailEntityType: 'auth_sign_in_email',
  },
  'sign-up': {
    windowMs: SIGN_UP_WINDOW_MS,
    maxFailures: SIGN_UP_FAILURE_LIMIT,
    ipEntityType: 'auth_sign_up_ip',
    emailEntityType: 'auth_sign_up_email',
  },
}

function normalizeEmail(email: string) {
  return String(email || '').trim().toLowerCase()
}

export function getClientIp(req: NextRequest) {
  const forwarded = req.headers.get('x-forwarded-for') || ''
  const firstHop = forwarded.split(',').map((value) => value.trim()).find(Boolean)
  return firstHop || req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip') || 'unknown'
}

async function latestSuccessAt(entityType: string, entityId: string, windowStart: Date) {
  if (!entityId) return null
  const latest = await prisma.auditLog.findFirst({
    where: {
      entityType,
      entityId,
      action: 'auth.success',
      createdAt: { gte: windowStart },
    },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  }).catch(() => null)

  return latest?.createdAt || null
}

async function failureCount(entityType: string, entityId: string, startAt: Date) {
  if (!entityId) return 0
  return prisma.auditLog.count({
    where: {
      entityType,
      entityId,
      action: 'auth.failure',
      createdAt: { gte: startAt },
    },
  }).catch(() => 0)
}

function lockedResponse(kind: AuthAttemptKind, retryAfterSeconds: number) {
  const message = kind === 'sign-in'
    ? 'Too many sign-in attempts. Please try again later.'
    : 'Too many sign-up attempts. Please try again later.'
  return NextResponse.json(
    { error: message },
    { status: 429, headers: { 'Retry-After': String(Math.max(retryAfterSeconds, 1)) } },
  )
}

async function lockoutResponse(kind: AuthAttemptKind, req: NextRequest, email: string) {
  const config = AUTH_ATTEMPT_CONFIG[kind]
  const normalizedEmail = normalizeEmail(email)
  const ip = getClientIp(req)
  const windowStart = new Date(Date.now() - config.windowMs)

  const [ipSuccessAt, emailSuccessAt] = await Promise.all([
    latestSuccessAt(config.ipEntityType, ip, windowStart),
    normalizedEmail ? latestSuccessAt(config.emailEntityType, normalizedEmail, windowStart) : Promise.resolve(null),
  ])

  const ipStart = ipSuccessAt && ipSuccessAt > windowStart ? ipSuccessAt : windowStart
  const emailStart = emailSuccessAt && emailSuccessAt > windowStart ? emailSuccessAt : windowStart

  const [ipFailures, emailFailures] = await Promise.all([
    failureCount(config.ipEntityType, ip, ipStart),
    normalizedEmail ? failureCount(config.emailEntityType, normalizedEmail, emailStart) : Promise.resolve(0),
  ])

  if (ipFailures >= config.maxFailures || emailFailures >= config.maxFailures) {
    const anchor = [ipStart, emailStart].filter(Boolean).sort((a, b) => +a - +b).pop() || windowStart
    const retryAfterSeconds = Math.ceil((anchor.getTime() + config.windowMs - Date.now()) / 1000)
    return lockedResponse(kind, retryAfterSeconds)
  }

  return null
}

async function recordAttempt(kind: AuthAttemptKind, action: 'auth.failure' | 'auth.success', req: NextRequest, email: string, details?: Record<string, unknown>) {
  const config = AUTH_ATTEMPT_CONFIG[kind]
  const normalizedEmail = normalizeEmail(email)
  const ip = getClientIp(req)

  await Promise.all([
    createAuditLog({ entityType: config.ipEntityType, entityId: ip, action, details: { email: normalizedEmail || null, ...details } }),
    normalizedEmail
      ? createAuditLog({ entityType: config.emailEntityType, entityId: normalizedEmail, action, details: { ip, ...details } })
      : Promise.resolve(),
  ])
}

export function signInLockoutResponse(req: NextRequest, email: string) {
  return lockoutResponse('sign-in', req, email)
}

export function signUpLockoutResponse(req: NextRequest, email: string) {
  return lockoutResponse('sign-up', req, email)
}

export function recordSignInFailure(req: NextRequest, email: string, reason = 'invalid_credentials') {
  return recordAttempt('sign-in', 'auth.failure', req, email, { reason })
}

export function recordSignInSuccess(req: NextRequest, email: string, userId?: string | null) {
  return recordAttempt('sign-in', 'auth.success', req, email, { userId: userId || null })
}

export function recordSignUpFailure(req: NextRequest, email: string, reason = 'invalid_signup') {
  return recordAttempt('sign-up', 'auth.failure', req, email, { reason })
}

export function recordSignUpSuccess(req: NextRequest, email: string, userId?: string | null) {
  return recordAttempt('sign-up', 'auth.success', req, email, { userId: userId || null })
}
