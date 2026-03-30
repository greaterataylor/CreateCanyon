import { prisma } from './prisma'

export async function getCurrentVersionDownloadForAsset(assetId: string) {
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    include: {
      versions: {
        where: { isCurrent: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { files: { orderBy: { createdAt: 'desc' } } },
      },
    },
  })

  const version = asset?.versions?.[0]
  if (!version) return null
  const file = version.files.find((candidate: any) => candidate.kind === 'download') || version.files[0] || null
  if (!file) return null
  return { asset, version, file }
}

export async function promoteApprovedVersionDownload(assetId: string) {
  const current = await getCurrentVersionDownloadForAsset(assetId)
  if (!current) return null

  await prisma.$transaction(async (tx: any) => {
    const existing = await tx.assetFile.findFirst({
      where: {
        assetId,
        versionId: null,
        kind: 'download',
        storageKey: current.file.storageKey,
      },
    })

    if (!existing) {
      await tx.assetFile.create({
        data: {
          assetId,
          kind: 'download',
          storageBucket: current.file.storageBucket,
          storageKey: current.file.storageKey,
          originalFilename: current.file.originalFilename,
          mimeType: current.file.mimeType,
          sizeBytes: current.file.sizeBytes,
          isPublic: false,
          checksum: current.file.checksum || undefined,
        },
      })
    }

    await tx.asset.update({
      where: { id: assetId },
      data: { primaryDownloadKey: current.file.storageKey },
    })
  })

  return {
    versionId: current.version.id,
    versionLabel: current.version.versionLabel,
    storageKey: current.file.storageKey,
  }
}
