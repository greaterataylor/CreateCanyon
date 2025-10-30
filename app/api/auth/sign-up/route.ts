//app/api/auth/sign-up/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, createSessionCookie } from '@/lib/auth'
import { signUpSchema } from '@/lib/validation'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const parsed = signUpSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const { email, name, password } = parsed.data
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) return NextResponse.json({ error: 'Email already in use' }, { status: 400 })
  const passwordHash = await hashPassword(password)
  const user = await prisma.user.create({ data: { email, name, passwordHash } })
  await createSessionCookie({ userId: user.id, role: user.role })
  return NextResponse.json({ ok: true })
}
