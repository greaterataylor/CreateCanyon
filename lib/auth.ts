//lib/auth.ts
import { cookies, headers } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'

const SESSION_COOKIE = 'session'
const secret = new TextEncoder().encode(process.env.AUTH_SECRET || 'dev-secret')

export type Session = { userId: string; role: 'USER' | 'ADMIN' }

export async function hashPassword(password: string) {
  const salt = await bcrypt.genSalt(10)
  return bcrypt.hash(password, salt)
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash)
}

export async function createSessionCookie(payload: Session) {
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret)
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  })
}

export function clearSessionCookie() {
  cookies().set(SESSION_COOKIE, '', { path: '/', maxAge: 0 })
}

export async function getSession(): Promise<Session | null> {
  const token = cookies().get(SESSION_COOKIE)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret)
    return payload as Session
  } catch {
    return null
  }
}

export async function currentUser() {
  const sess = await getSession()
  if (!sess) return null
  return prisma.user.findUnique({ where: { id: sess.userId }, include: { vendorProfile: true } })
}

export async function requireUser() {
  const user = await currentUser()
  if (!user) throw new Error('UNAUTHORIZED')
  return user
}

export async function requireAdmin() {
  const user = await currentUser()
  if (!user || user.role !== 'ADMIN') throw new Error('FORBIDDEN')
  return user
}
