// Compile-friendly Prisma loader that still works when `prisma generate` has not run in this sandbox.

declare global {
  // eslint-disable-next-line no-var
  var prisma: any | undefined
}

function createFallbackClient() {
  const fail = () => {
    throw new Error('Prisma client is not generated. Run `npx prisma generate` in your deployment environment before starting the app.')
  }
  return new Proxy({}, { get: () => fail }) as any
}

function createPrismaClient() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaClient } = require('@prisma/client') as { PrismaClient?: new (...args: any[]) => any }
    if (!PrismaClient) return createFallbackClient()
    const client = new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'] })

    if (typeof client.$use === 'function') {
      client.$use(async (params: any, next: (params: any) => Promise<any>) => {
        try {
          return await next(params)
        } catch (error: any) {
          const message = String(error?.message || '')
          const isRetryableConnectionError =
            error?.name === 'PrismaClientInitializationError' ||
            message.includes('Server has closed the connection') ||
            message.includes("Can't reach database server")

          if (!isRetryableConnectionError || params?.__retryAfterReconnect) throw error

          try {
            await client.$disconnect()
            await client.$connect()
          } catch {
            throw error
          }

          return next({ ...params, __retryAfterReconnect: true })
        }
      })
    }

    void client.$connect().catch(() => undefined)
    return client
  } catch {
    return createFallbackClient()
  }
}

export const prisma = globalThis.prisma || createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma
