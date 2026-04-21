import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { presignDownload } from '@/lib/s3'
import { getActiveSiteForRequest } from '@/lib/site'
import { createAuditLog } from '@/lib/audit'
import { withRedirectAuth } from '@/lib/route-auth'

type Params = Promise<{ assetId: string }>

const HOURLY_DOWNLOAD_LIMIT = 10
const DAILY_ASSET_DOWNLOAD_LIMIT = 5

function buildSameOriginRedirect(req: NextRequest, state: string) {
  const referer = req.headers.get('referer')
  if (referer) {
    try {
      const url = new URL(referer)
      if (url.origin === req.nextUrl.origin) {
        url.searchParams.set('download', state)
        return url
      }
    } catch {
    }
  }
  const fallback = new URL('/dashboard/downloads', req.url)
  fallback.searchParams.set('download', state)
  return fallback
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function wantsNavigationResponse(req: NextRequest) {
  const accept = req.headers.get('accept') || ''
  const secFetchMode = req.headers.get('sec-fetch-mode') || ''
  const secFetchDest = req.headers.get('sec-fetch-dest') || ''
  return accept.includes('text/html') || secFetchMode === 'navigate' || secFetchDest === 'document'
}

function buildDownloadErrorHtml(redirectTo: string, message: string) {
  const escapedUrl = escapeHtml(redirectTo)
  const escapedMessage = escapeHtml(message)
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex" />
    <title>Download unavailable</title>
    <meta http-equiv="refresh" content="0;url=${escapedUrl}" />
  </head>
  <body>
    <p>${escapedMessage}</p>
    <p>Redirecting… <a href="${escapedUrl}">Continue</a></p>
    <script>window.location.replace(${JSON.stringify(redirectTo)})</script>
  </body>
</html>`
}

function downloadError(req: NextRequest, message: string, status: number, state: string) {
  const redirectTarget = buildSameOriginRedirect(req, state)
  const headers = new Headers({
    'cache-control': 'no-store',
    'x-download-error-status': String(status),
    'x-download-error-message': message,
    'x-download-error-state': state,
  })

  if (wantsNavigationResponse(req)) {
    headers.set('content-type', 'text/html; charset=utf-8')
    return new NextResponse(buildDownloadErrorHtml(redirectTarget.toString(), message), {
      status,
      headers,
    })
  }

  return NextResponse.json({ error: message, state }, { status, headers })
}

export const POST = withRedirectAuth(async (req: NextRequest, { params }: { params: Params }) => {
  const { assetId } = await params
  const user = await requireUser()
  const site = await getActiveSiteForRequest(req)
  const purchase = await prisma.purchase.findFirst({
    where: { userId: user.id, assetId, siteId: site.id },
    include: { asset: { include: { vendorSiteMembership: true } } },
    orderBy: { createdAt: 'desc' },
  })
  if (!purchase) return downloadError(req, 'Not purchased', 403, 'not-purchased')

  const asset = purchase.asset
  if (asset.downloadsDisabled || asset.status !== 'APPROVED' || (asset.vendorSiteMembership && asset.vendorSiteMembership.status !== 'APPROVED')) {
    await createAuditLog({
      actorUserId: user.id,
      siteId: site.id,
      entityType: 'asset',
      entityId: asset.id,
      action: 'download.blocked.asset_restricted',
      details: {
        purchaseId: purchase.id,
        downloadsDisabled: asset.downloadsDisabled,
        assetStatus: asset.status,
        vendorMembershipStatus: asset.vendorSiteMembership?.status || null,
      },
    })
    return downloadError(req, 'Downloads are currently unavailable for this asset.', 403, 'frozen')
  }

  const [hourlyDownloads, dailyAssetDownloads] = await Promise.all([
    prisma.downloadEvent.count({ where: { userId: user.id, siteId: site.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } } }).catch(() => 0),
    prisma.downloadEvent.count({ where: { userId: user.id, assetId: purchase.assetId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }).catch(() => 0),
  ])

  if (hourlyDownloads >= HOURLY_DOWNLOAD_LIMIT || dailyAssetDownloads >= DAILY_ASSET_DOWNLOAD_LIMIT) {
    await createAuditLog({
      actorUserId: user.id,
      siteId: site.id,
      entityType: 'suspiciousActivity',
      entityId: `${user.id}:${purchase.assetId}`,
      action: 'suspicious.download.blocked',
      details: { assetId: purchase.assetId, hourlyDownloads, dailyAssetDownloads },
    })
    return downloadError(req, 'Download temporarily blocked due to burst activity. Please try again later.', 429, 'rate-limited')
  }

  const file = await prisma.assetFile.findFirst({ where: { assetId: purchase.assetId, kind: 'download' }, orderBy: { createdAt: 'desc' } })
  if (!file) return downloadError(req, 'Download file not found', 404, 'missing-file')

  await prisma.$transaction([
    prisma.purchase.update({ where: { id: purchase.id }, data: { downloadCount: { increment: 1 }, lastDownloadedAt: new Date() } }),
    prisma.downloadEvent.create({ data: { purchaseId: purchase.id, userId: user.id, assetId: purchase.assetId, siteId: site.id, userAgent: req.headers.get('user-agent') || undefined } }),
  ])

  const nextHourlyDownloads = hourlyDownloads + 1
  const nextDailyAssetDownloads = dailyAssetDownloads + 1
  await createAuditLog({ actorUserId: user.id, siteId: site.id, entityType: 'purchase', entityId: purchase.id, action: 'download.created', details: { assetId: purchase.assetId } })
  if (nextHourlyDownloads >= HOURLY_DOWNLOAD_LIMIT || nextDailyAssetDownloads >= DAILY_ASSET_DOWNLOAD_LIMIT) {
    await createAuditLog({
      actorUserId: user.id,
      siteId: site.id,
      entityType: 'suspiciousActivity',
      entityId: `${user.id}:${purchase.assetId}`,
      action: 'suspicious.download.burst',
      details: { assetId: purchase.assetId, hourlyDownloads: nextHourlyDownloads, dailyAssetDownloads: nextDailyAssetDownloads },
    })
  }

  const url = await presignDownload(file.storageKey, file.storageBucket)
  return NextResponse.redirect(url, { status: 302 })
})
