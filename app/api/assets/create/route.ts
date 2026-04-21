import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth'
import { assetCreateSchema } from '@/lib/validation'
import { getActiveSiteForRequest } from '@/lib/site'
import { safeFilename, slugify } from '@/lib/utils'
import { publicObjectUrl } from '@/lib/s3'
import { createAuditLog } from '@/lib/audit'
import { queueDefaultProcessingJobs } from '@/lib/jobs'
import { buildMetadataEntries } from '@/lib/taxonomy'
import { normalizeLicenseOptions, validateAgainstCategoryRules } from '@/lib/asset-rules'
import { withJsonAuth } from '@/lib/route-auth'

async function uniqueAssetSlug(siteId: string, desired: string) {
  const base = slugify(desired) || `asset-${Date.now()}`
  let attempt = base
  let suffix = 2
  while (await prisma.asset.findUnique({ where: { siteId_slug: { siteId, slug: attempt } }, select: { id: true } })) {
    attempt = `${base}-${suffix}`
    suffix += 1
  }
  return attempt
}

export const POST = withJsonAuth(async (req: NextRequest) => {
  const user = await requireUser()
  if (!user.vendor) return NextResponse.json({ error: 'Create a vendor profile first.' }, { status: 403 })

  const site = await getActiveSiteForRequest(req)
  const membership = user.vendor.memberships.find((item: any) => item.siteId === site.id)
  if (!membership || membership.status !== 'APPROVED') {
    return NextResponse.json({ error: 'You are not an approved seller for this marketplace.' }, { status: 403 })
  }

  const parsed = assetCreateSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const data = parsed.data

  const category = await prisma.category.findFirst({
    where: { id: data.categoryId, siteId: site.id, isActive: true },
    include: {
      fieldTemplates: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      rules: true,
      visibilities: { where: { siteId: site.id }, take: 1 },
    },
  })
  if (!category) return NextResponse.json({ error: 'Category not found for this marketplace.' }, { status: 400 })
  if (category.visibilities?.[0] && category.visibilities[0].enabled === false) {
    return NextResponse.json({ error: 'This category is currently disabled for uploads.' }, { status: 400 })
  }

  const metadata = {
    ...(data.metadata && typeof data.metadata === 'object' ? data.metadata : {}),
    licenseTemplateKey: data.licenseTemplateKey || category.defaultLicenseKey || null,
  } as Record<string, unknown>

  const licenseValidation = normalizeLicenseOptions(data, category)
  if ('error' in licenseValidation) return NextResponse.json({ error: licenseValidation.error }, { status: 400 })

  const categoryValidation = validateAgainstCategoryRules(category, {
    previewType: data.previewType,
    priceCents: data.priceCents,
    previewUpload: data.previewUpload
      ? {
          filename: data.previewUpload.filename,
          mimeType: data.previewUpload.mimeType,
          sizeBytes: data.previewUpload.sizeBytes,
        }
      : undefined,
    downloadUpload: {
      filename: data.downloadUpload.filename,
      mimeType: data.downloadUpload.mimeType,
      sizeBytes: data.downloadUpload.sizeBytes,
    },
  }, metadata)
  if ('error' in categoryValidation) return NextResponse.json({ error: categoryValidation.error }, { status: 400 })

  const slug = await uniqueAssetSlug(site.id, data.slug || data.title)
  const previewUrl = data.previewUpload ? publicObjectUrl(data.previewUpload.storageKey) : null
  const effectiveTaxCode = data.taxCode || category.taxCode || undefined
  const effectiveTaxBehavior = data.taxBehavior || category.taxBehavior || undefined
  const metadataEntries = buildMetadataEntries(categoryValidation.fieldTemplates, metadata)

  const asset = await prisma.$transaction(async (tx: any) => {
    const created = await tx.asset.create({
      data: {
        siteId: site.id,
        vendorId: user.vendor!.id,
        vendorSiteMembershipId: membership.id,
        categoryId: category.id,
        title: data.title,
        slug,
        description: data.description,
        shortDescription: data.shortDescription || undefined,
        kind: data.kind,
        priceCents: data.priceCents,
        currency: data.currency,
        previewType: data.previewType,
        previewUrl,
        primaryDownloadKey: data.downloadUpload.storageKey,
        metadata: metadata as any,
        taxCode: effectiveTaxCode,
        taxBehavior: effectiveTaxBehavior,
        downloadsDisabled: false,
        status: 'PENDING',
        versions: {
          create: {
            versionLabel: '1.0.0',
            isCurrent: true,
            files: {
              create: {
                kind: 'download',
                storageBucket: data.downloadUpload.bucket,
                storageKey: data.downloadUpload.storageKey,
                originalFilename: safeFilename(data.downloadUpload.filename),
                mimeType: data.downloadUpload.mimeType,
                sizeBytes: data.downloadUpload.sizeBytes,
                isPublic: false,
              },
            },
          },
        },
        files: {
          create: [
            {
              kind: 'download',
              storageBucket: data.downloadUpload.bucket,
              storageKey: data.downloadUpload.storageKey,
              originalFilename: safeFilename(data.downloadUpload.filename),
              mimeType: data.downloadUpload.mimeType,
              sizeBytes: data.downloadUpload.sizeBytes,
              isPublic: false,
            },
            ...(data.previewUpload
              ? [
                  {
                    kind: 'preview',
                    storageBucket: data.previewUpload.bucket,
                    storageKey: data.previewUpload.storageKey,
                    originalFilename: safeFilename(data.previewUpload.filename),
                    mimeType: data.previewUpload.mimeType,
                    sizeBytes: data.previewUpload.sizeBytes,
                    isPublic: true,
                  },
                ]
              : []),
          ],
        },
        previews: data.previewUpload
          ? {
              create: [
                {
                  type: data.previewType,
                  url: previewUrl!,
                  storageKey: data.previewUpload.storageKey,
                  mimeType: data.previewUpload.mimeType,
                  sortOrder: 0,
                },
              ],
            }
          : undefined,
        licenseOptions: {
          create: licenseValidation.options.map((option: any) => ({
            name: option.name,
            slug: option.slug,
            description: option.description,
            licenseText: option.licenseText,
            priceCents: option.priceCents,
            sortOrder: option.sortOrder,
          })),
        },
        metadataEntries: metadataEntries.length ? { create: metadataEntries } : undefined,
      },
      include: {
        licenseOptions: true,
        versions: { where: { isCurrent: true }, take: 1 },
      },
    })

    for (const rawTag of data.tags) {
      const tagSlug = slugify(rawTag)
      if (!tagSlug) continue
      const tag = await tx.assetTag.upsert({
        where: { siteId_slug: { siteId: site.id, slug: tagSlug } },
        update: { name: rawTag.trim() },
        create: { siteId: site.id, name: rawTag.trim(), slug: tagSlug },
      })
      await tx.assetTagOnAsset.upsert({
        where: { assetId_tagId: { assetId: created.id, tagId: tag.id } },
        update: {},
        create: { assetId: created.id, tagId: tag.id },
      })
    }

    return created
  })

  await queueDefaultProcessingJobs({
    siteId: site.id,
    assetId: asset.id,
    versionId: asset.versions?.[0]?.id || null,
    previewType: data.previewType,
    previewMimeType: data.previewUpload?.mimeType,
    downloadMimeType: data.downloadUpload.mimeType,
  })

  await createAuditLog({
    actorUserId: user.id,
    siteId: site.id,
    entityType: 'asset',
    entityId: asset.id,
    action: 'asset.submitted',
    details: {
      title: asset.title,
      categoryId: asset.categoryId,
      taxCode: effectiveTaxCode || null,
      taxBehavior: effectiveTaxBehavior || null,
      licenseOptionSlugs: licenseValidation.options.map((option: any) => option.slug),
    },
  })

  return NextResponse.json({ ok: true, assetId: asset.id })
})
