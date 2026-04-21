import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, createSessionCookie } from '@/lib/auth'
import { signUpSchema } from '@/lib/validation'
import { consumeSharedRateLimit, getClientIp, resetRateLimit } from '@/lib/security'
import { signUpLockoutResponse, recordSignUpFailure, recordSignUpSuccess } from '@/lib/auth-attempts'
import { withJsonAuth } from '@/lib/route-auth'

export const POST = withJsonAuth(async (req: NextRequest) => {
  const body = await req.json()
  const parsed = signUpSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const email = parsed.data.email.trim().toLowerCase()
  const name = parsed.data.name.trim()
  const password = parsed.data.password
  const ip = getClientIp(req)
  const [globalLimit, identityLimit] = await Promise.all([
    consumeSharedRateLimit({ bucket: 'auth:sign-up:ip', key: ip, max: 10, windowMs: 30 * 60 * 1000 }),
    consumeSharedRateLimit({ bucket: 'auth:sign-up:email', key: `${ip}:${email}`, max: 3, windowMs: 30 * 60 * 1000 }),
  ])
  const blocked = !globalLimit.ok ? globalLimit : !identityLimit.ok ? identityLimit : null
  if (blocked) {
    return NextResponse.json(
      { error: 'Too many sign-up attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(blocked.retryAfterSeconds) } },
    )
  }

  const lockout = await signUpLockoutResponse(req, email)
  if (lockout) return lockout

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    await recordSignUpFailure(req, email, 'email_in_use')
    return NextResponse.json({ error: 'Email already in use' }, { status: 400 })
  }

  const passwordHash = await hashPassword(password)
  const user = await prisma.user.create({ data: { email, name, passwordHash } })
  await createSessionCookie({ userId: user.id, role: user.role })
  await resetRateLimit(`auth:sign-up:email:${ip}:${email}`)
  await recordSignUpSuccess(req, email, user.id)
  return NextResponse.json({ ok: true })
})
