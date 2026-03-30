import './globals.css'
import type { Metadata } from 'next'
import { ReactNode } from 'react'
import SiteHeader from '@/components/SiteHeader'
import Providers from '@/components/Providers'
import { currentUser } from '@/lib/auth'
import { getActiveSite, getSiteNavigation } from '@/lib/site'
import { getThemeVariables } from '@/lib/theme'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  try {
    const site = await getActiveSite()
    return {
      title: site.seoTitle || site.name,
      description: site.seoDescription || `${site.name} is a multi-vendor marketplace for digital products.`,
      metadataBase: site.domain ? new URL(`https://${site.domain}`) : undefined,
    }
  } catch {
    return { title: 'ZenBinary Marketplace Network', description: 'Multi-vendor marketplace platform for digital assets' }
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [site, user] = await Promise.all([getActiveSite(), currentUser()])
  const navItems = (await getSiteNavigation(site.id)).map((item: any) => ({ id: item.id, label: item.label, href: item.href }))
  const canAdmin = !!user && (user.role === 'SUPER_ADMIN' || user.siteAdminMemberships.some((membership: any) => membership.siteId === site.id))
  const themeVars = getThemeVariables(site.theme)

  return (
    <html lang="en">
      <body style={themeVars as React.CSSProperties}>
        <Providers>
          <SiteHeader
            siteName={site.name}
            logoUrl={site.logoUrl}
            navItems={navItems}
            userName={user?.name || user?.email || null}
            isSignedIn={!!user}
            canAdmin={canAdmin}
          />
          <main className="container py-6">{children}</main>
        </Providers>
      </body>
    </html>
  )
}
