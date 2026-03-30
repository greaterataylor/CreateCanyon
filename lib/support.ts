import { prisma } from './prisma'

export type SupportType = 'refund' | 'dispute' | 'takedown'
export type SupportStatus = 'open' | 'in_review' | 'resolved' | 'rejected' | 'counter_notice_received' | 'released'

export function supportActionPrefix(type: SupportType) {
  return `support.${type}`
}

export function normalizeSupportType(value: string | null | undefined): SupportType {
  if (value === 'dispute' || value === 'takedown') return value
  return 'refund'
}

export function normalizeSupportStatus(value: string | null | undefined): SupportStatus {
  if (value === 'in_review' || value === 'resolved' || value === 'rejected' || value === 'counter_notice_received' || value === 'released') return value
  return 'open'
}

function toEnumType(type: SupportType) {
  return type.toUpperCase()
}

function toEnumStatus(status: SupportStatus) {
  return status.toUpperCase()
}

export async function createSupportCase(input: {
  siteId: string
  reporterUserId: string
  assetId: string
  orderId?: string | null
  vendorId?: string | null
  type: SupportType
  message: string
}) {
  try {
    return await prisma.supportCase.create({
      data: {
        siteId: input.siteId,
        reporterUserId: input.reporterUserId,
        assetId: input.assetId,
        orderId: input.orderId || undefined,
        vendorId: input.vendorId || undefined,
        type: toEnumType(input.type),
        status: 'OPEN',
        message: input.message,
      },
    })
  } catch {
    return null
  }
}

export async function listSupportCasesForSite(siteId: string, type?: SupportType) {
  try {
    return await prisma.supportCase.findMany({
      where: { siteId, ...(type ? { type: toEnumType(type) } : {}) },
      include: { asset: { include: { vendor: true } }, order: true, reporter: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  } catch {
    return [] as any[]
  }
}

export async function listSupportCasesForAsset(assetId: string) {
  try {
    return await prisma.supportCase.findMany({ where: { assetId }, orderBy: { createdAt: 'desc' }, take: 50 })
  } catch {
    return [] as any[]
  }
}

export async function updateSupportCase(caseId: string, data: { status: SupportStatus; resolutionNotes?: string | null; reviewedByUserId?: string | null; actionMode?: string | null }) {
  try {
    return await prisma.supportCase.update({
      where: { id: caseId },
      data: {
        status: toEnumStatus(data.status),
        resolutionNotes: data.resolutionNotes || undefined,
        reviewedByUserId: data.reviewedByUserId || undefined,
        reviewedAt: new Date(),
        actionMode: data.actionMode || undefined,
      },
    })
  } catch {
    return null
  }
}

export async function submitCounterNotice(caseId: string, text: string) {
  try {
    return await prisma.supportCase.update({
      where: { id: caseId },
      data: { status: 'COUNTER_NOTICE_RECEIVED', counterNoticeText: text, counterNoticeAt: new Date() },
    })
  } catch {
    return null
  }
}
