import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { bucketForPurpose, presignUpload } from '@/lib/s3'
import { getActiveSiteForRequest } from '@/lib/site'
import { uploadPresignSchema } from '@/lib/validation'
import { safeFilename } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { allowedFileMatch, getAllowedFileTypes, getCategoryRuleMap, mimeMatchesPattern, ruleNumber, ruleStringArray } from '@/lib/taxonomy'
import { withJsonAuth } from '@/lib/route-auth'

const defaultPreviewMimePatterns = [
  'image/*',
  'audio/*',
  'video/*',
  'application/pdf',
  'text/*',
  'font/*',
  'application/json',
  'application/xml',
  'application/javascript',
]

const defaultDownloadMimePatterns = [
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
  'application/pdf',
  'application/json',
  'text/*',
  'image/*',
  'audio/*',
  'video/*',
  'font/*',
  'application/x-font-ttf',
  'application/x-font-otf',
  'application/vnd.ms-fontobject',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]

function matchesAnyPattern(contentType: string, patterns: string[]) {
  const normalized = String(contentType || '').toLowerCase().trim()
  if (!normalized) return false
  return patterns.some((pattern) => mimeMatchesPattern(normalized, pattern))
}

function keyPrefix(siteSlug: string, membershipId: string, uploadGroup?: string | null) {
  const group = uploadGroup && /^[a-zA-Z0-9_-]{6,120}$/.test(uploadGroup) ? uploadGroup : randomUUID()
  return `sites/${siteSlug.toLowerCase()}/vendors/${membershipId}/ingest/${group}`
}

export const POST = withJsonAuth(async (req: NextRequest) => {
  const user = await requireUser()
  if (!user.vendor) return NextResponse.json({ error: 'Create a vendor profile first.' }, { status: 403 })

  const site = await getActiveSiteForRequest(req)
  const membership = user.vendor.memberships.find((item: any) => item.siteId === site.id)
  if (!membership || membership.status !== 'APPROVED') {
    return NextResponse.json({ error: 'Only approved sellers can upload files for this marketplace.' }, { status: 403 })
  }

  const parsed = uploadPresignSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const data = parsed.data

  if (!data.categoryId) {
    return NextResponse.json({ error: 'categoryId is required so upload policies can be validated.' }, { status: 400 })
  }

  const category = await prisma.category.findFirst({
    where: { id: data.categoryId, siteId: site.id, isActive: true },
    include: { rules: true, visibilities: { where: { siteId: site.id }, take: 1 } },
  })
  if (!category) return NextResponse.json({ error: 'Category not found for this marketplace.' }, { status: 400 })
  const visibility = category.visibilities?.[0]
  if (visibility && visibility.enabled === false) return NextResponse.json({ error: 'This category is currently disabled for uploads.' }, { status: 400 })

  const rules = getCategoryRuleMap(category)
  const allowedFileTypes = getAllowedFileTypes(category)
  const previewMimePatterns = ruleStringArray(rules, 'allowedPreviewMimeTypes').map((value: string) => value.toLowerCase())
  const downloadMimePatterns = ruleStringArray(rules, 'allowedDownloadMimeTypes').map((value: string) => value.toLowerCase())
  const maxPreviewSizeBytes = ruleNumber(rules, 'maxPreviewSizeBytes') || 50 * 1024 * 1024
  const maxDownloadSizeBytes = ruleNumber(rules, 'maxDownloadSizeBytes') || 1024 * 1024 * 1024

  const basePatterns = data.purpose === 'preview' ? defaultPreviewMimePatterns : defaultDownloadMimePatterns
  const categoryPatterns = data.purpose === 'preview' ? previewMimePatterns : downloadMimePatterns
  const maxSizeBytes = data.purpose === 'preview' ? maxPreviewSizeBytes : maxDownloadSizeBytes

  if (data.sizeBytes > maxSizeBytes) {
    return NextResponse.json({ error: `File is too large for a ${data.purpose} upload on this category.` }, { status: 400 })
  }

  if (!matchesAnyPattern(data.contentType, categoryPatterns.length ? categoryPatterns : basePatterns)) {
    return NextResponse.json({ error: `The ${data.contentType} MIME type is not allowed for this upload.` }, { status: 400 })
  }

  if (data.purpose === 'download' && allowedFileTypes.length && !allowedFileMatch(allowedFileTypes, data.filename, data.contentType)) {
    return NextResponse.json({ error: 'This file extension or MIME type is not allowed for the selected category.' }, { status: 400 })
  }

  const prefix = keyPrefix(site.slug, membership.id, data.uploadGroup)
  const key = `${prefix}/${data.purpose}/${Date.now()}-${randomUUID()}-${safeFilename(data.filename)}`
  const bucket = bucketForPurpose(data.purpose)
  const url = await presignUpload(key, bucket, data.contentType)
  return NextResponse.json({ url, storageKey: key, bucket, uploadGroup: prefix.split('/').slice(-1)[0] })
})
