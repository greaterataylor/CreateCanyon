import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { getAuthSecret, isAuthConfigError } from '@/lib/auth-config'

function needsSessionProtection(pathname: string, method: string) {
  if (pathname.startsWith('/admin') || pathname.startsWith('/dashboard')) return true
  if (pathname.startsWith('/api/admin')) return true
  if (pathname === '/api/checkout') return true
  if (pathname === '/api/collections' || pathname.startsWith('/api/collections/')) return true
  if (pathname === '/api/dashboard' || pathname.startsWith('/api/dashboard/')) return true
  if (pathname.startsWith('/api/download/')) return true
  if (pathname === '/api/support' || pathname.startsWith('/api/support/')) return true
  if (pathname === '/api/upload/presign') return true
  if (pathname === '/api/vendor' || pathname.startsWith('/api/vendor/')) return true
  if (pathname === '/api/assets/create') return true
  if (pathname === '/api/assets/saved') return method !== 'GET'
  if (pathname.startsWith('/api/assets/') && pathname.endsWith('/versions')) return true
  return false
}

function needsAdminRole(pathname: string) {
  return pathname.startsWith('/admin') || pathname.startsWith('/api/admin')
}

function wantsHtml(req: NextRequest) {
  const accept = req.headers.get('accept') || ''
  return accept.includes('text/html')
}

function unauthorizedResponse(req: NextRequest) {
  if (wantsHtml(req)) return NextResponse.redirect(new URL('/sign-in', req.url), { status: 303 })
  return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
}

function forbiddenResponse(req: NextRequest) {
  if (wantsHtml(req)) return NextResponse.redirect(new URL('/dashboard', req.url), { status: 303 })
  return NextResponse.json({ error: 'You do not have access to this action.' }, { status: 403 })
}

function misconfiguredResponse(req: NextRequest, message: string) {
  if (wantsHtml(req)) return new NextResponse(message, { status: 503 })
  return NextResponse.json({ error: message }, { status: 503 })
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname
  if (!needsSessionProtection(pathname, req.method)) return NextResponse.next()

  let secret: Uint8Array
  try {
    secret = getAuthSecret()
  } catch (error) {
    if (isAuthConfigError(error)) return misconfiguredResponse(req, error.message)
    return misconfiguredResponse(req, 'AUTH_SECRET is not configured.')
  }

  const session = req.cookies.get('session')?.value
  if (!session) return unauthorizedResponse(req)

  let payload: Record<string, unknown>
  try {
    const verified = await jwtVerify(session, secret)
    payload = verified.payload as Record<string, unknown>
  } catch {
    return unauthorizedResponse(req)
  }

  if (needsAdminRole(pathname)) {
    const role = String(payload.role || '')
    if (role !== 'SITE_ADMIN' && role !== 'SUPER_ADMIN') {
      return forbiddenResponse(req)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/dashboard/:path*',
    '/api/admin/:path*',
    '/api/assets/:path*',
    '/api/checkout',
    '/api/collections/:path*',
    '/api/dashboard/:path*',
    '/api/download/:path*',
    '/api/support/:path*',
    '/api/upload/:path*',
    '/api/vendor/:path*',
  ],
}
