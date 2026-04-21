export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function parseJsonValue<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v)).filter(Boolean)
  if (typeof value === 'string') {
    return value.split(',').map(v => v.trim()).filter(Boolean)
  }
  return []
}

export function currencyAmount(cents: number) {
  return (cents / 100).toFixed(2)
}

export function marketplaceFeeBreakdown(totalCents: number, feeBps = Number(process.env.MARKETPLACE_FEE_BPS || 1500)) {
  const platformFeeCents = Math.round((totalCents * feeBps) / 10000)
  const vendorPayoutCents = Math.max(totalCents - platformFeeCents, 0)
  return { platformFeeCents, vendorPayoutCents, feeBps }
}

export function safeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'file'
}
