import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { buildMetadataEntries } from '@/lib/taxonomy'
import { slugify } from '@/lib/utils'
import { validateAgainstCategoryRules } from '@/lib/asset-rules'
import { withRedirectAuth } from '@/lib/route-auth'

type Params = Promise<{ id: string }>

const ASSET_KINDS = new Set(['IMAGE', 'GRAPHIC', 'AUDIO', 'VIDEO', 'FONT', 'CODE', 'DOCUMENT', 'TEMPLATE', 'BUNDLE', 'OTHER'])
const PREVIEW_TYPES = new Set(['IMAGE', 'AUDIO', 'VIDEO', 'CODE', 'FILE', 'PDF', 'FONT'])

function redirectToManage(req: NextRequest, id: string, state: string) {
  return NextResponse.redirect(new URL(`/dashboard/assets/${id}?edit=${state}`, req.url), { status: 303 })
}

function parseMetadataJson(raw: FormDataEntryValue | null, fallback: Record<string, unknown>) {
  const value = String(raw || '').trim()
  if (!value) return { ok: true as const, value: fallback }
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { ok: true as const, value: parsed as Record<string, unknown> }
    return { ok: false as const }
  } catch {
    return { ok: false as const }
  }
}

export const POST = withRedirectAuth(async (req: NextRequest, { params }: { params: Params }) => {
  const { id } = await params
  const user = await requireUser()
  if (!user.vendor) return NextResponse.redirect(new URL('/dashboard/assets', req.url), { status: 303 })
  const site = await getActiveSiteForRequest(req)
  const asset = await prisma.asset.findFirst({
    where: { id, siteId: site.id, vendorId: user.vendor.id },
    include: {
      orderItems: { take: 1 },
      purchases: { take: 1 },
      supportCases: { take: 1 },
      category: {
        include: {
          fieldTemplates: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
          rules: true,
          visibilities: { where: { siteId: site.id }, take: 1 },
        },
      },
      previews: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], take: 1 },
      files: { where: { kind: { in: ['preview', 'download'] } }, orderBy: { createdAt: 'desc' } },
    },
  })
  if (!asset) return NextResponse.redirect(new URL('/dashboard/assets', req.url), { status: 303 })

  const form = await req.formData()
  const action = String(form.get('_action') || 'save')

  if (action === 'archive') {
    await prisma.asset.update({ where: { id: asset.id }, data: { status: 'ARCHIVED' } })
    await createAuditLog({ actorUserId: user.id, siteId: site.id, entityType: 'asset', entityId: asset.id, action: 'asset.archived.by_vendor' })
    return redirectToManage(req, asset.id, 'archived')
  }

  if (action === 'delete') {
    const hasReferences = Boolean(asset.orderItems.length || asset.purchases.length || asset.supportCases.length)
    if (hasReferences) {
      await prisma.asset.update({ where: { id: asset.id }, data: { status: 'ARCHIVED' } })
      await createAuditLog({ actorUserId: user.id, siteId: site.id, entityType: 'asset', entityId: asset.id, action: 'asset.delete_requested.archived_instead' })
      return redirectToManage(req, asset.id, 'archived')
    }
    await prisma.asset.delete({ where: { id: asset.id } })
    await createAuditLog({ actorUserId: user.id, siteId: site.id, entityType: 'asset', entityId: asset.id, action: 'asset.deleted.by_vendor' })
    return NextResponse.redirect(new URL('/dashboard/assets?deleted=1', req.url), { status: 303 })
  }

  const title = String(form.get('title') || '').trim()
  const shortDescription = String(form.get('shortDescription') || '').trim()
  const description = String(form.get('description') || '').trim()
  const rawPrice = Number(form.get('priceCents') || asset.priceCents)
  const priceCents = Number.isFinite(rawPrice) ? Math.max(Math.round(rawPrice), 50) : asset.priceCents
  const kind = String(form.get('kind') || asset.kind).trim().toUpperCase()
  const previewType = String(form.get('previewType') || asset.previewType).trim().toUpperCase()
  const metadataParse = parseMetadataJson(form.get('metadataJson'), asset.metadata && typeof asset.metadata === 'object' ? asset.metadata as Record<string, unknown> : {})
  const tags = String(form.get('tags') || '').split(',').map((value) => value.trim()).filter(Boolean)

  if (!title || !description || !metadataParse.ok || !ASSET_KINDS.has(kind) || !PREVIEW_TYPES.has(previewType)) {
    return redirectToManage(req, asset.id, 'invalid')
  }

  if (asset.category.visibilities?.[0] && asset.category.visibilities[0].enabled === false) return redirectToManage(req, asset.id, 'invalid')

  const currentDownloadFile = asset.files.find((file: any) => file.kind === 'download') || null
  if (!currentDownloadFile) return redirectToManage(req, asset.id, 'invalid')
  const currentPreview = asset.previews[0] || null
  const currentPreviewFile = asset.files.find((file: any) => file.kind === 'preview') || null

  const metadata = metadataParse.value
  const categoryValidation = validateAgainstCategoryRules(asset.category, {
    previewType,
    priceCents,
    previewUpload: currentPreview
      ? {
          filename: currentPreviewFile?.originalFilename || 'preview',
          mimeType: currentPreview.mimeType || currentPreviewFile?.mimeType || 'application/octet-stream',
          sizeBytes: currentPreviewFile?.sizeBytes || 0,
        }
      : undefined,
    downloadUpload: {
      filename: currentDownloadFile.originalFilename,
      mimeType: currentDownloadFile.mimeType,
      sizeBytes: currentDownloadFile.sizeBytes,
    },
  }, metadata)
  if ('error' in categoryValidation) return redirectToManage(req, asset.id, 'invalid')

  const metadataEntries = buildMetadataEntries(categoryValidation.fieldTemplates, metadata)

  await prisma.$transaction(async (tx: any) => {
    await tx.asset.update({
      where: { id: asset.id },
      data: {
        title,
        shortDescription: shortDescription || undefined,
        description,
        priceCents,
        kind,
        previewType,
        metadata: metadata as any,
        status: asset.status === 'APPROVED' ? 'PENDING' : asset.status,
      },
    })

    await tx.assetMetadataEntry.deleteMany({ where: { assetId: asset.id } })
    if (metadataEntries.length) {
      await tx.assetMetadataEntry.createMany({
        data: metadataEntries.map((entry: any) => ({
          assetId: asset.id,
          fieldKey: entry.fieldKey,
          fieldLabel: entry.fieldLabel,
          fieldType: entry.fieldType,
          valueText: entry.valueText,
          valueJson: entry.valueJson,
          sortOrder: entry.sortOrder,
        })),
      })
    }

    await tx.assetTagOnAsset.deleteMany({ where: { assetId: asset.id } })
    for (const rawTag of tags) {
      const tagSlug = slugify(rawTag)
      if (!tagSlug) continue
      const tag = await tx.assetTag.upsert({
        where: { siteId_slug: { siteId: site.id, slug: tagSlug } },
        update: { name: rawTag },
        create: { siteId: site.id, name: rawTag, slug: tagSlug },
      })
      await tx.assetTagOnAsset.create({ data: { assetId: asset.id, tagId: tag.id } })
    }
  })

  await createAuditLog({
    actorUserId: user.id,
    siteId: site.id,
    entityType: 'asset',
    entityId: asset.id,
    action: 'asset.updated.by_vendor',
    details: { priceCents, previewType, metadataFields: metadataEntries.flatMap((entry: any) => entry ? [entry.fieldKey] : []) },
  })
  return redirectToManage(req, asset.id, 'saved')
})
