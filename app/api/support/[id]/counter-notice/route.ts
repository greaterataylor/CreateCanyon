import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { submitCounterNotice } from '@/lib/support'
import { createAuditLog } from '@/lib/audit'
import { withRedirectAuth } from '@/lib/route-auth'

type Params = Promise<{ id: string }>

export const POST = withRedirectAuth(async function POST(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params
  const user = await requireUser()
  const site = await getActiveSiteForRequest(req)
  if (!user.vendor) return NextResponse.redirect(new URL('/dashboard/store', req.url), { status: 303 })
  const form = await req.formData()
  const message = form.get('message')?.toString().trim() || ''
  if (!message) return NextResponse.redirect(new URL('/dashboard/assets', req.url), { status: 303 })
  const supportCase = await prisma.supportCase.findFirst({ where: { id, siteId: site.id, vendorId: user.vendor.id } }).catch(() => null)
  if (!supportCase) return NextResponse.redirect(new URL('/dashboard/assets', req.url), { status: 303 })
  await submitCounterNotice(supportCase.id, message)
  await createAuditLog({ actorUserId: user.id, siteId: site.id, entityType: 'support_case', entityId: supportCase.id, action: 'support-case.counter-notice', details: { vendorId: user.vendor.id } })
  return NextResponse.redirect(new URL(`/dashboard/assets/${supportCase.assetId}?counterNotice=sent`, req.url), { status: 303 })
})
