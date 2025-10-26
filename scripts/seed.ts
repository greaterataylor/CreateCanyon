import { prisma } from '../lib/prisma'
import { hashPassword } from '../lib/auth'

// Default categories per site
const siteConfigs: Record<string, { name: string; categories: string[] }> = {
  CreateCanyon: { name: 'CreateCanyon', categories: ['Bundles','Templates','Fonts','Icons','Illustrations','Stock Media'] },
  GraphicGrounds: { name: 'GraphicGrounds', categories: ['Photos','Vectors','Mockups','Textures','Backgrounds','UI Kits'] },
  MelodyMerchant: { name: 'MelodyMerchant', categories: ['Loops','Samples','Beats','Sound FX','Stems','Presets'] },
  ProgramPlaza: { name: 'ProgramPlaza', categories: ['Code Snippets','Components','Templates','Plugins','Scripts','APIs'] },
  FileFoyer: { name: 'FileFoyer', categories: ['Documents','Spreadsheets','Presentations','Forms','Checklists','eBooks'] }
}

async function main() {
  const slug = process.env.SITE_SLUG || 'CreateCanyon'
  const cfg = siteConfigs[slug as keyof typeof siteConfigs]
  if (!cfg) throw new Error(`Unknown SITE_SLUG: ${slug}`)

  let site = await prisma.site.findUnique({ where: { slug } })
  if (!site) {
    site = await prisma.site.create({ data: { slug, name: cfg.name } })
    console.log(`Created site ${slug}`)
  }

  for (const name of cfg.categories) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'')
    await prisma.category.upsert({
      where: { slug },
      update: {},
      create: { slug, name, siteId: site.id }
    })
  }
  console.log('Categories ensured.')

  // Admin bootstrap (optional)
  const adminEmail = 'admin@example.com'
  const existing = await prisma.user.findUnique({ where: { email: adminEmail } })
  if (!existing) {
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'Admin',
        passwordHash: await hashPassword('admin1234'),
        role: 'ADMIN'
      }
    })
    console.log('Created admin: admin@example.com / admin1234 (change in production)')
  } else {
    console.log('Admin exists.')
  }
}

main().then(()=>process.exit(0)).catch((e)=>{ console.error(e); process.exit(1) })
