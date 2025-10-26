import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const ADMIN_PATHS = ['/admin']
const AUTH_REQUIRED_PATHS = ['/dashboard']

export async function middleware(req: NextRequest) {
  const url = req.nextUrl.clone()
  const pathname = url.pathname

  const needsAuth = AUTH_REQUIRED_PATHS.some(p => pathname.startsWith(p)) || ADMIN_PATHS.some(p => pathname.startsWith(p))
  if (!needsAuth) return NextResponse.next()

  const session = req.cookies.get('session')?.value
  if (!session) return NextResponse.redirect(new URL('/sign-in', req.url))

  try {
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET || 'dev-secret')
    const { payload } = await jwtVerify(session, secret)
    const role = (payload as any).role
    if (ADMIN_PATHS.some(p => pathname.startsWith(p)) && role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/', req.url))
    }
  } catch {
    return NextResponse.redirect(new URL('/sign-in', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*','/dashboard/:path*']
}
