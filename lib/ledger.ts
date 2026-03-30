import { prisma } from './prisma'

export type LedgerSummary = {
  grossCents: number
  estimatedNetCents: number
  ledgerBalanceCents: number
  entries: any[]
}

export async function recordLedgerEntry(input: {
  vendorId: string
  siteId: string
  vendorSiteMembershipId?: string | null
  orderId?: string | null
  assetId?: string | null
  type: string
  amountCents: number
  currency?: string
  notes?: string | null
  metadata?: unknown
}) {
  try {
    return await prisma.vendorLedgerEntry.create({
      data: {
        vendorId: input.vendorId,
        siteId: input.siteId,
        vendorSiteMembershipId: input.vendorSiteMembershipId || undefined,
        orderId: input.orderId || undefined,
        assetId: input.assetId || undefined,
        type: input.type,
        amountCents: input.amountCents,
        currency: input.currency || 'USD',
        notes: input.notes || undefined,
        metadata: input.metadata as any,
      },
    })
  } catch {
    return null
  }
}

export async function getVendorLedgerSummary(vendorId: string, siteId: string): Promise<LedgerSummary> {
  try {
    const entries = await prisma.vendorLedgerEntry.findMany({ where: { vendorId, siteId }, orderBy: { createdAt: 'desc' } })
    const ledgerBalanceCents = entries.reduce((sum: number, entry: any) => sum + Number(entry.amountCents || 0), 0)
    const grossCents = entries.filter((entry: any) => entry.type === 'SALE').reduce((sum: number, entry: any) => sum + Number(entry.amountCents || 0), 0)
    return { grossCents, estimatedNetCents: ledgerBalanceCents, ledgerBalanceCents, entries }
  } catch {
    const sales = await prisma.orderItem.findMany({
      where: { asset: { vendorId, siteId }, order: { status: 'paid' } },
      include: { order: true },
    })
    const grossCents = sales.reduce((sum: number, sale: any) => sum + sale.priceCents * sale.quantity, 0)
    const estimatedNetCents = sales.reduce((sum: number, sale: any) => sum + Number(sale.order?.vendorPayoutCents || Math.round((sale.priceCents * sale.quantity * 0.85))), 0)
    return { grossCents, estimatedNetCents, ledgerBalanceCents: estimatedNetCents, entries: [] }
  }
}
