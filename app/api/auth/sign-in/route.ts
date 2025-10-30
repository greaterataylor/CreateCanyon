//app/api/auth/sign-in/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword, createSessionCookie } from '@/lib/auth'
import { signInSchema } from '@/lib/validation'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const parsed = signInSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const { email, password } = parsed.data
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  const ok = await verifyPassword(password, user.passwordHash)
  if (!ok) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  await createSessionCookie({ userId: user.id, role: user.role })
  return NextResponse.json({ ok: true })
}
