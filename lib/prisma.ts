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
    return new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'] })
  } catch {
    return createFallbackClient()
  }
}

export const prisma = globalThis.prisma || createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma
