import { NextRequest, NextResponse } from 'next/server'
import { isAuthConfigError } from './auth-config'
import { isAuthError } from './auth'

type JsonAuthOptions = {
  unauthorizedMessage?: string
  forbiddenMessage?: string
  configurationMessage?: string
}

type RedirectAuthOptions = {
  unauthorizedPath?: string
  forbiddenPath?: string
  configurationMessage?: string
}

type RouteHandler<TArgs extends any[]> = (...args: TArgs) => Promise<Response>

export function jsonAuthErrorResponse(error: unknown, options: JsonAuthOptions = {}) {
  if (isAuthError(error)) {
    return NextResponse.json(
      {
        error: error.status === 401
          ? (options.unauthorizedMessage || 'Authentication required.')
          : (options.forbiddenMessage || 'You do not have access to this action.'),
      },
      { status: error.status },
    )
  }

  if (isAuthConfigError(error)) {
    return NextResponse.json({ error: options.configurationMessage || error.message }, { status: 503 })
  }

  return null
}

export function redirectAuthErrorResponse(req: NextRequest, error: unknown, options: RedirectAuthOptions = {}) {
  if (isAuthError(error)) {
    const target = error.status === 401
      ? new URL(options.unauthorizedPath || '/sign-in', req.url)
      : new URL(options.forbiddenPath || '/', req.url)
    return NextResponse.redirect(target, { status: 303 })
  }

  if (isAuthConfigError(error)) {
    return new NextResponse(options.configurationMessage || error.message, { status: 503 })
  }

  return null
}

export function withJsonAuth<TArgs extends any[]>(handler: RouteHandler<TArgs>, options: JsonAuthOptions = {}) {
  return (async (...args: TArgs) => {
    try {
      return await handler(...args)
    } catch (error) {
      const response = jsonAuthErrorResponse(error, options)
      if (response) return response
      throw error
    }
  }) as RouteHandler<TArgs>
}

export function withRedirectAuth<TArgs extends [NextRequest, ...any[]]>(handler: RouteHandler<TArgs>, options: RedirectAuthOptions = {}) {
  return (async (...args: TArgs) => {
    try {
      return await handler(...args)
    } catch (error) {
      const response = redirectAuthErrorResponse(args[0], error, options)
      if (response) return response
      throw error
    }
  }) as RouteHandler<TArgs>
}
