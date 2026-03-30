import { prisma } from '../lib/prisma'
import { hashPassword } from '../lib/auth'
import { slugify } from '../lib/utils'

const siteConfigs = [
  { slug: 'CreateCanyon', name: 'CreateCanyon', seoTitle: 'CreateCanyon — Multi-category digital marketplace', seoDescription: 'Buy and sell images, graphics, audio, video, fonts, code, templates, and documents.', categories: ['Images', 'Photos', 'Graphics', 'Audio', 'Clips', 'Movies', 'Fonts', 'Code', 'Documents', 'Templates', 'Bundles'] },
  { slug: 'GraphicGrounds', name: 'GraphicGrounds', seoTitle: 'GraphicGrounds — Visual design marketplace', seoDescription: 'Curated visual design assets for creatives.', categories: ['Photos', 'Vectors', 'Illustrations', 'Icons', 'Backgrounds', 'Mockups', 'Textures', 'UI Kits'] },
  { slug: 'MelodyMerchant', name: 'MelodyMerchant', seoTitle: 'MelodyMerchant — Music and audio asset marketplace', seoDescription: 'Marketplace for loops, samples, beats, stems, and sound design tools.', categories: ['Music', 'Loops', 'Samples', 'Beats', 'Sound FX', 'Stems', 'Presets'] },
  { slug: 'ProgramPlaza', name: 'ProgramPlaza', seoTitle: 'ProgramPlaza — Code and developer asset marketplace', seoDescription: 'Code, developer components, templates, plugins, scripts, and APIs.', categories: ['Code Snippets', 'Components', 'Templates', 'Plugins', 'Scripts', 'APIs', 'Boilerplates'] },
  { slug: 'FileFoyer', name: 'FileFoyer', seoTitle: 'FileFoyer — Document and template marketplace', seoDescription: 'Documents, spreadsheets, presentations, forms, checklists, and eBooks.', categories: ['Documents', 'Spreadsheets', 'Presentations', 'Forms', 'Checklists', 'Templates', 'eBooks'] },
] as const

const defaultNavItems = [
  { label: 'Explore', href: '/', sortOrder: 0 },
  { label: 'Dashboard', href: '/dashboard', sortOrder: 1 },
  { label: 'Purchases', href: '/dashboard/purchases', sortOrder: 2 },
]

async function main() {
  for (const cfg of siteConfigs) {
    const site = await prisma.site.upsert({ where: { slug: cfg.slug }, update: { name: cfg.name, seoTitle: cfg.seoTitle, seoDescription: cfg.seoDescription }, create: { slug: cfg.slug, name: cfg.name, seoTitle: cfg.seoTitle, seoDescription: cfg.seoDescription } })
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
