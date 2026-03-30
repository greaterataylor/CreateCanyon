import { NextRequest, NextResponse } from 'next/server'
import { ApiError } from './api'

function authStatusCode(error: unknown) {
  if (error instanceof ApiError) return error.status === 403 ? 403 : 401
  if (error instanceof Error) {
    const message = error.message.trim().toLowerCase()
    if (message === 'forbidden') return 403
    if (message === 'unauthorized') return 401
  }
  return 401
}

function authErrorMessage(status: number) {
  return status === 403 ? 'Forbidden' : 'Unauthorized'
}

export function authErrorResponse(req: NextRequest, error: unknown, options?: { redirectTo?: string }) {
  const status = authStatusCode(error)
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: authErrorMessage(status) }, { status })
  }
  const destination = status === 401 ? (options?.redirectTo || '/sign-in') : (options?.redirectTo || '/')
  return NextResponse.redirect(new URL(destination, req.url), { status: 303 })
}

function isAuthError(error: unknown) {
  if (error instanceof ApiError) return error.status === 401 || error.status === 403
  if (error instanceof Error) {
    const message = error.message.trim().toLowerCase()
    return message === 'unauthorized' || message === 'forbidden'
  }
  return false
}

export async function guardApiRoute<T>(req: NextRequest, handler: () => Promise<T>) {
  try {
    return await handler()
  } catch (error) {
    if (isAuthError(error)) {
      return authErrorResponse(req, error)
    }
    throw error
  }
}
