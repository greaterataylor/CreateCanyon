import { prisma } from './prisma'
import { slugify } from './utils'

export async function getUserCollections(userId: string, siteId: string) {
  try {
    return await prisma.collection.findMany({
      where: { userId, siteId },
      include: { items: { include: { asset: { include: { vendor: true, category: true } } }, orderBy: { createdAt: 'desc' } } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    })
  } catch {
    return [] as any[]
  }
}

export async function ensureDefaultCollection(userId: string, siteId: string) {
  try {
    const existing = await prisma.collection.findFirst({ where: { userId, siteId, isDefault: true } })
    if (existing) return existing
    return await prisma.collection.create({
      data: {
        userId,
        siteId,
        name: 'Saved',
        slug: 'saved',
        isDefault: true,
      },
    })
  } catch {
    return null
  }
}

export async function isAssetSavedByUser(userId: string, siteId: string, assetId: string) {
  try {
    const item = await prisma.collectionItem.findFirst({
      where: { assetId, collection: { userId, siteId } },
    })
    return Boolean(item)
  } catch {
    return false
  }
}

export async function addAssetToCollection(input: { userId: string; siteId: string; assetId: string; collectionId?: string | null; collectionName?: string | null }) {
  try {
    let collection = input.collectionId
      ? await prisma.collection.findFirst({ where: { id: input.collectionId, userId: input.userId, siteId: input.siteId } })
      : null

    if (!collection && input.collectionName) {
      const slug = slugify(input.collectionName) || `collection-${Date.now()}`
      collection = await prisma.collection.create({
        data: { userId: input.userId, siteId: input.siteId, name: input.collectionName, slug, isDefault: false },
      })
    }
    if (!collection) collection = await ensureDefaultCollection(input.userId, input.siteId)
    if (!collection) return null

    await prisma.collectionItem.upsert({
      where: { collectionId_assetId: { collectionId: collection.id, assetId: input.assetId } },
      update: {},
      create: { collectionId: collection.id, assetId: input.assetId },
    })
    return collection
  } catch {
    return null
  }
}

export async function removeAssetFromUserCollections(userId: string, siteId: string, assetId: string) {
  try {
    await prisma.collectionItem.deleteMany({ where: { assetId, collection: { userId, siteId } } })
    return true
  } catch {
    return false
  }
}
