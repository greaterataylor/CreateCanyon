import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'
import { getAuthSecret, isAuthConfigError } from './auth-config'

export type Role = 'USER' | 'SITE_ADMIN' | 'SUPER_ADMIN'

const SESSION_COOKIE = 'session'

export type Session = { userId: string; role: Role }

export class AuthError extends Error {
  status: 401 | 403
  code: 'UNAUTHORIZED' | 'FORBIDDEN'

  constructor(code: 'UNAUTHORIZED' | 'FORBIDDEN', message?: string) {
    super(message || (code === 'UNAUTHORIZED' ? 'Authentication required.' : 'Forbidden.'))
    this.name = 'AuthError'
    this.code = code
    this.status = code === 'UNAUTHORIZED' ? 401 : 403
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError || (error instanceof Error && error.name === 'AuthError')
}

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
    .sign(getAuthSecret())
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' })
}

export async function clearSessionCookie() {
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 })
}

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getAuthSecret())
    return payload as Session
  } catch (error) {
    if (isAuthConfigError(error)) throw error
    return null
  }
}

export async function currentUser() {
  const sess = await getSession()
  if (!sess) return null
  return prisma.user.findUnique({
    where: { id: sess.userId },
    include: {
      vendor: { include: { memberships: { include: { site: true }, orderBy: { createdAt: 'asc' } } } },
      siteAdminMemberships: { include: { site: true }, orderBy: { createdAt: 'asc' } },
    },
  })
}

export async function requireUser() {
  const user = await currentUser()
  if (!user) throw new AuthError('UNAUTHORIZED')
  return user
}

export async function requireSuperAdmin() {
  const user = await currentUser()
  if (!user) throw new AuthError('UNAUTHORIZED')
  if (user.role !== 'SUPER_ADMIN') throw new AuthError('FORBIDDEN')
  return user
}
