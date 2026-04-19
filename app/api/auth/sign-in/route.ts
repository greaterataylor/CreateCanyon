import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword, createSessionCookie } from '@/lib/auth'
import { signInSchema } from '@/lib/validation'
import { consumeSharedRateLimit, getClientIp, resetRateLimit } from '@/lib/security'
import { signInLockoutResponse, recordSignInFailure, recordSignInSuccess } from '@/lib/auth-attempts'
import { withJsonAuth } from '@/lib/route-auth'

export const POST = withJsonAuth(async (req: NextRequest) => {
  const body = await req.json()
  const parsed = signInSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const email = parsed.data.email.trim().toLowerCase()
  const password = parsed.data.password
  const ip = getClientIp(req)
  const [globalLimit, credentialLimit] = await Promise.all([
    consumeSharedRateLimit({ bucket: 'auth:sign-in:ip', key: ip, max: 25, windowMs: 15 * 60 * 1000 }),
    consumeSharedRateLimit({ bucket: 'auth:sign-in:credential', key: `${ip}:${email}`, max: 8, windowMs: 15 * 60 * 1000 }),
  ])
  const blocked = !globalLimit.ok ? globalLimit : !credentialLimit.ok ? credentialLimit : null
  if (blocked) {
    return NextResponse.json(
      { error: 'Too many sign-in attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(blocked.retryAfterSeconds) } },
    )
  }

  const lockout = await signInLockoutResponse(req, email)
  if (lockout) return lockout

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    await recordSignInFailure(req, email, 'user_not_found')
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const ok = await verifyPassword(password, user.passwordHash)
  if (!ok) {
    await recordSignInFailure(req, email, 'invalid_password')
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  await createSessionCookie({ userId: user.id, role: user.role })
  await resetRateLimit(`auth:sign-in:credential:${ip}:${email}`)
  await recordSignInSuccess(req, email, user.id)
  return NextResponse.json({ ok: true })
})
