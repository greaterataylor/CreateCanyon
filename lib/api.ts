import { NextResponse } from 'next/server'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function apiErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }

  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (error.message === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  console.error(error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export function withApiErrorHandling<TArgs extends any[]>(handler: (...args: TArgs) => Promise<Response>) {
  return async (...args: TArgs) => {
    try {
      return await handler(...args)
    } catch (error) {
      return apiErrorResponse(error)
    }
  }
}
