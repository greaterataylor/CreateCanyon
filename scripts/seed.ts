import { prisma } from '../lib/prisma'
import { hashPassword } from '../lib/auth'
import { getSeedSiteConfigs } from '../lib/site-presets'
import { slugify } from '../lib/utils'

const siteConfigs = getSeedSiteConfigs()

const defaultNavItems = [
  { label: 'Explore', href: '/', sortOrder: 0 },
  { label: 'Dashboard', href: '/dashboard', sortOrder: 1 },
  { label: 'Purchases', href: '/dashboard/purchases', sortOrder: 2 },
]

function hasJsonContent(value: unknown) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length > 0
}

async function upsertSite(cfg: (typeof siteConfigs)[number]) {
  const existing = await prisma.site.findUnique({ where: { slug: cfg.slug } })
  if (!existing) {
    return prisma.site.create({
      data: {
        slug: cfg.slug,
        name: cfg.name,
        domain: cfg.domain,
        logoUrl: cfg.logoUrl || null,
        seoTitle: cfg.seoTitle,
        seoDescription: cfg.seoDescription,
        theme: cfg.theme as any,
        settings: cfg.settings as any,
      },
    })
  }

  return prisma.site.update({
    where: { id: existing.id },
    data: {
      name: cfg.name,
      domain: existing.domain || cfg.domain,
      logoUrl: cfg.logoUrl || null,
      seoTitle: existing.seoTitle || cfg.seoTitle,
      seoDescription: existing.seoDescription || cfg.seoDescription,
      theme: (hasJsonContent(existing.theme) ? existing.theme : cfg.theme) as any,
      settings: (hasJsonContent(existing.settings) ? existing.settings : cfg.settings) as any,
    },
  })
}

async function main() {
  for (const cfg of siteConfigs) {
    const site = await upsertSite(cfg)
    for (const item of defaultNavItems) {
      const existing = await prisma.siteNavigationItem.findFirst({ where: { siteId: site.id, href: item.href } })
      if (!existing) await prisma.siteNavigationItem.create({ data: { siteId: site.id, label: item.label, href: item.href, sortOrder: item.sortOrder } })
    }
    for (const [index, categoryName] of cfg.categories.entries()) {
      const categorySlug = slugify(categoryName)
      const category = await prisma.category.upsert({
        where: { siteId_slug: { siteId: site.id, slug: categorySlug } },
        update: { name: categoryName, sortOrder: index, isActive: true, allowedPreviewTypes: ['IMAGE', 'AUDIO', 'VIDEO', 'CODE', 'FILE', 'PDF', 'FONT'] as any, allowedLicenseTypes: ['standard', 'extended'] as any },
        create: { siteId: site.id, name: categoryName, slug: categorySlug, sortOrder: index, isActive: true, allowedPreviewTypes: ['IMAGE', 'AUDIO', 'VIDEO', 'CODE', 'FILE', 'PDF', 'FONT'] as any, allowedLicenseTypes: ['standard', 'extended'] as any, metadataSchema: { fields: [{ name: 'software', label: 'Software', type: 'text' }] } as any },
      })
      await prisma.siteCategoryVisibility.upsert({ where: { siteId_categoryId: { siteId: site.id, categoryId: category.id } }, update: { enabled: true, sortOrder: index }, create: { siteId: site.id, categoryId: category.id, enabled: true, sortOrder: index } })
    }
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@example.com'
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'admin1234'
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } })
  const admin = existingAdmin || await prisma.user.create({ data: { email: adminEmail, name: 'Admin', passwordHash: await hashPassword(adminPassword), role: 'SUPER_ADMIN' } })
  if (admin.role !== 'SUPER_ADMIN') await prisma.user.update({ where: { id: admin.id }, data: { role: 'SUPER_ADMIN' } })

  console.log(`Seeded ${siteConfigs.length} marketplaces.`)
  console.log(`Admin: ${adminEmail} / ${adminPassword}`)
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1) })
