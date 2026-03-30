import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { assetVersionSchema } from '@/lib/validation'
import { safeFilename } from '@/lib/utils'
import { createAuditLog } from '@/lib/audit'
import { queueDefaultProcessingJobs } from '@/lib/jobs'
import { validateAgainstCategoryRules } from '@/lib/asset-rules'
import { withJsonAuth } from '@/lib/route-auth'

type Params = Promise<{ id: string }>

export const POST = withJsonAuth(async (req: NextRequest, { params }: { params: Params }) => {
  const { id } = await params
  const user = await requireUser()
  const site = await getActiveSiteForRequest(req)
  if (!user.vendor) return NextResponse.json({ error: 'Seller profile required.' }, { status: 403 })

  const asset = await prisma.asset.findFirst({
    where: { id, siteId: site.id, vendorId: user.vendor.id },
    include: {
      versions: { where: { isCurrent: true }, include: { files: true } },
      previews: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], take: 1 },
      files: { where: { kind: { in: ['preview', 'download'] } }, orderBy: { createdAt: 'desc' } },
      category: {
        include: {
          fieldTemplates: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
          rules: true,
          visibilities: { where: { siteId: site.id }, take: 1 },
        },
      },
    },
  })
  if (!asset) return NextResponse.json({ error: 'Asset not found.' }, { status: 404 })
  if (asset.category.visibilities?.[0] && asset.category.visibilities[0].enabled === false) {
    return NextResponse.json({ error: 'This category is currently disabled for uploads.' }, { status: 400 })
  }

  const parsed = assetVersionSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid version payload.' }, { status: 400 })

  const previewRecord = asset.previews[0] || null
  const previewFile = asset.files.find((file: any) => file.kind === 'preview') || null
  const metadata = asset.metadata && typeof asset.metadata === 'object' ? asset.metadata as Record<string, unknown> : {}
  const categoryValidation = validateAgainstCategoryRules(asset.category, {
    previewType: asset.previewType,
    priceCents: asset.priceCents,
    previewUpload: previewRecord
      ? {
          filename: previewFile?.originalFilename || 'preview',
          mimeType: previewRecord.mimeType || previewFile?.mimeType || 'application/octet-stream',
          sizeBytes: previewFile?.sizeBytes || 0,
        }
      : undefined,
    downloadUpload: {
      filename: parsed.data.upload.filename,
      mimeType: parsed.data.upload.mimeType,
      sizeBytes: parsed.data.upload.sizeBytes,
    },
  }, metadata)
  if ('error' in categoryValidation) return NextResponse.json({ error: categoryValidation.error }, { status: 400 })

  const version = await prisma.$transaction(async (tx: any) => {
    await tx.assetVersion.updateMany({ where: { assetId: asset.id, isCurrent: true }, data: { isCurrent: false } })
    const created = await tx.assetVersion.create({
      data: {
        assetId: asset.id,
        versionLabel: parsed.data.versionLabel,
        changelog: parsed.data.changelog || undefined,
        isCurrent: true,
      },
    })
    await tx.assetFile.create({
      data: {
        assetId: asset.id,
        versionId: created.id,
        kind: 'download',
        storageBucket: parsed.data.upload.bucket,
        storageKey: parsed.data.upload.storageKey,
        originalFilename: safeFilename(parsed.data.upload.filename),
        mimeType: parsed.data.upload.mimeType,
        sizeBytes: parsed.data.upload.sizeBytes,
        isPublic: false,
      },
    })
    await tx.asset.update({ where: { id: asset.id }, data: { primaryDownloadKey: parsed.data.upload.storageKey, status: 'PENDING' } })
    return created
  })
  await queueDefaultProcessingJobs({ siteId: site.id, assetId: asset.id, versionId: version.id, previewType: asset.previewType, downloadMimeType: parsed.data.upload.mimeType })
  await createAuditLog({ actorUserId: user.id, siteId: site.id, entityType: 'asset', entityId: asset.id, action: 'asset.version.created', details: { versionLabel: version.versionLabel } })
  return NextResponse.json({ ok: true, versionId: version.id })
})
