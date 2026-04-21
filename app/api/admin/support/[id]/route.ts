import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'
import { supportCaseUpdateSchema } from '@/lib/validation'
import { createAuditLog } from '@/lib/audit'
import { updateSupportCase } from '@/lib/support'
import { executeSupportAction, isSupportActionAllowedForCaseType, normalizeSupportActionMode } from '@/lib/support-actions'
import { withRedirectAuth } from '@/lib/route-auth'

type Params = Promise<{ id: string }>

function appendNotes(existing: string | null | undefined, additions: string[]) {
  const parts = [String(existing || '').trim(), ...additions.map((item) => item.trim()).filter(Boolean)].filter(Boolean)
  return parts.length ? parts.join('\n\n').slice(0, 4000) : null
}

function redirectWithState(
  req: NextRequest,
  redirectTo: string,
  state: 'updated' | 'action_applied' | 'action_failed' | 'invalid',
  caseId?: string | null,
  message?: string | null,
) {
  const target = new URL(redirectTo, req.url)
  target.searchParams.set('caseUpdate', state)
  if (caseId) target.searchParams.set('caseId', caseId)
  if (message) target.searchParams.set('caseMessage', message.slice(0, 240))
  return NextResponse.redirect(target, { status: 303 })
}

export const POST = withRedirectAuth(async (req: NextRequest, { params }: { params: Params }) => {
  const { id } = await params
  const site = await getActiveSiteForRequest(req)
  const admin = await requireAdminForSite(site.id)
  const form = await req.formData()
  const redirectTo = form.get('redirectTo')?.toString() || '/admin'
  const parsed = supportCaseUpdateSchema.safeParse({
    status: form.get('status')?.toString() || '',
    resolutionNotes: form.get('resolutionNotes')?.toString() || '',
    actionMode: form.get('actionMode')?.toString() || '',
    amountCents: form.get('amountCents')?.toString() || form.get('refundAmountCents')?.toString() || '',
  })
  if (!parsed.success) return redirectWithState(req, redirectTo, 'invalid', id, 'The submitted support case update was invalid.')

  const supportCase = await prisma.supportCase.findFirst({ where: { id, siteId: site.id } }).catch(() => null)
  const record = supportCase ? null : await prisma.auditLog.findFirst({ where: { id, siteId: site.id, entityType: 'support_case' } }).catch(() => null)
  const previous = record?.details && typeof record.details === 'object' ? (record.details as Record<string, unknown>) : {}

  const supportCaseId = supportCase?.id || record?.entityId || id
  const supportCaseType = supportCase?.type || (previous.type ? String(previous.type) : null)
  const targetAssetId = supportCase?.assetId || (previous.assetId ? String(previous.assetId) : null)
  const targetOrderId = supportCase?.orderId || (previous.orderId ? String(previous.orderId) : null)
  const actionMode = normalizeSupportActionMode(parsed.data.actionMode)

  if (actionMode && !isSupportActionAllowedForCaseType(supportCaseType, actionMode)) {
    await createAuditLog({
      actorUserId: admin.id,
      siteId: site.id,
      entityType: 'support_case',
      entityId: supportCaseId,
      action: 'support-case.action.failed',
      details: {
        reason: 'invalid_action_for_case_type',
        supportCaseType,
        status: parsed.data.status,
        actionMode,
        amountCents: parsed.data.amountCents ?? null,
      },
    })
    return redirectWithState(req, redirectTo, 'action_failed', supportCaseId, 'That action is not allowed for this type of support case.')
  }

  const outcome = await executeSupportAction({
    siteId: site.id,
    actorUserId: admin.id,
    supportCaseId,
    supportCaseType,
    actionMode,
    assetId: targetAssetId,
    orderId: targetOrderId,
    resolutionNotes: parsed.data.resolutionNotes || null,
    amountCents: parsed.data.amountCents ?? null,
  })

  if (actionMode && outcome.errors.length) {
    await createAuditLog({
      actorUserId: admin.id,
      siteId: site.id,
      entityType: 'support_case',
      entityId: supportCaseId,
      action: 'support-case.action.failed',
      details: {
        status: parsed.data.status,
        actionMode,
        amountCents: parsed.data.amountCents ?? null,
        errors: outcome.errors,
        warnings: outcome.warnings,
      },
    })
    return redirectWithState(req, redirectTo, 'action_failed', supportCaseId, outcome.errors.join(' ').slice(0, 180))
  }

  const resolutionNotes = appendNotes(parsed.data.resolutionNotes || null, outcome.warnings)

  if (supportCase) {
    await updateSupportCase(supportCase.id, {
      status: parsed.data.status as any,
      resolutionNotes,
      reviewedByUserId: admin.id,
      actionMode: actionMode || '',
    })
  }

  if (record) {
    await prisma.auditLog.update({
      where: { id: record.id },
      data: {
        action: `support.${String(previous.type || 'case')}.${parsed.data.status}`,
        details: {
          ...previous,
          status: parsed.data.status,
          resolutionNotes,
          actionMode: actionMode || null,
          amountCents: parsed.data.amountCents ?? null,
          reviewedBy: admin.id,
          reviewedAt: new Date().toISOString(),
          actionResult: {
            performed: outcome.performed,
            errors: outcome.errors,
            warnings: outcome.warnings,
            refundId: outcome.refundId,
          },
        } as any,
      },
    })
  }

  await createAuditLog({
    actorUserId: admin.id,
    siteId: site.id,
    entityType: 'support_case',
    entityId: supportCaseId,
    action: actionMode ? 'support-case.action.applied' : 'support-case.reviewed',
    details: {
      status: parsed.data.status,
      actionMode: actionMode || null,
      amountCents: parsed.data.amountCents ?? null,
      performed: outcome.performed,
      warnings: outcome.warnings,
      refundId: outcome.refundId,
    },
  })

  return redirectWithState(
    req,
    redirectTo,
    actionMode ? 'action_applied' : 'updated',
    supportCaseId,
    outcome.warnings.length ? outcome.warnings.join(' ').slice(0, 180) : null,
  )
}, { forbiddenPath: '/dashboard' })
