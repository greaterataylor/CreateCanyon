import './globals.css'
import type { Metadata } from 'next'
import { ReactNode } from 'react'
import SiteHeader from '@/components/SiteHeader'
import Providers from '@/components/Providers'
import { currentUser } from '@/lib/auth'
import { getActiveSite, getSiteNavigation } from '@/lib/site'
import { isLocalSiteHost, normalizeSiteHost } from '@/lib/site-presets'
import { getThemeColor, getThemeVariables } from '@/lib/theme'

export const dynamic = 'force-dynamic'

function getMetadataBase(domain: string | null | undefined) {
  const normalizedDomain = normalizeSiteHost(domain)
  if (!normalizedDomain) return undefined
  return new URL(`${isLocalSiteHost(normalizedDomain) ? 'http' : 'https'}://${normalizedDomain}`)
}

export async function generateMetadata(): Promise<Metadata> {
  try {
    const site = await getActiveSite()
    const title = site.seoTitle || site.name
    const description = site.seoDescription || `${site.name} is a multi-vendor marketplace for digital products.`
    const themeColor = getThemeColor(site.theme)

    return {
      title,
      description,
      applicationName: site.name,
      metadataBase: getMetadataBase(site.domain),
      themeColor: themeColor || undefined,
      icons: site.faviconUrl
        ? {
            icon: [{ url: site.faviconUrl, type: 'image/png' }],
            shortcut: [{ url: site.faviconUrl, type: 'image/png' }],
            apple: [{ url: site.faviconUrl, type: 'image/png' }],
          }
        : undefined,
      openGraph: {
        title,
        description,
        siteName: site.name,
      },
    }
  } catch {
    return {
      title: 'ZenBinary Marketplace Network',
      description: 'Multi-vendor marketplace platform for digital assets',
      applicationName: 'ZenBinary Marketplace Network',
      icons: {
        icon: [{ url: '/CreateCanyon-Favicon.png', type: 'image/png' }],
        shortcut: [{ url: '/CreateCanyon-Favicon.png', type: 'image/png' }],
        apple: [{ url: '/CreateCanyon-Favicon.png', type: 'image/png' }],
      },
    }
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
