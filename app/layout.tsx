import './globals.css'
import { ReactNode } from 'react'
import SiteHeader from '@/components/SiteHeader'
import { prisma } from '@/lib/prisma'
import Providers from '@/components/Providers'

export const metadata = {
  title: 'Storefront',
  description: 'Multi-vendor creative assets marketplace'
}

async function getSiteName() {
  const slug = process.env.SITE_SLUG || 'CreateCanyon'
  const site = await prisma.site.findUnique({ where: { slug } })
  return site?.name || slug
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const siteName = await getSiteName()
  return (
    <html lang="en">
      <body>
        <Providers>
          <SiteHeader siteName={siteName} />
          <main className="container py-6">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  )
}
