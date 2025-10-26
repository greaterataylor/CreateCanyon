import { prisma } from './prisma'

export async function getSite() {
  const slug = process.env.SITE_SLUG || 'CreateCanyon'
  const site = await prisma.site.findUnique({ where: { slug } })
  if (!site) {
    throw new Error(`Site with slug ${slug} not found. Run 'npm run db:seed' to create it.`)
  }
  return site
}
