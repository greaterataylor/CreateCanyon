export class AuthConfigError extends Error {
  code = 'AUTH_SECRET_MISSING'

  constructor(message = 'AUTH_SECRET is not configured.') {
    super(message)
    this.name = 'AuthConfigError'
  }
}

function authSecretValue() {
  const raw = process.env.AUTH_SECRET?.trim()
  return raw || null
}

export function isAuthConfigured() {
  return Boolean(authSecretValue())
}

export function getAuthSecret() {
  const raw = authSecretValue()
  if (!raw) throw new AuthConfigError()
  return new TextEncoder().encode(raw)
}

export function isAuthConfigError(error: unknown): error is AuthConfigError {
  return error instanceof AuthConfigError || (error instanceof Error && error.name === 'AuthConfigError')
}
