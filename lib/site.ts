import { headers } from 'next/headers'
import type { NextRequest } from 'next/server'
import { cache } from 'react'
import { prisma } from './prisma'

function normalizeHost(host: string | null | undefined) {
  if (!host) return null
  return host.toLowerCase().replace(/^https?:\/\//, '').replace(/:\d+$/, '').trim()
}

function hostCandidates(host: string | null | undefined) {
  const normalized = normalizeHost(host)
  if (!normalized) return [] as string[]
  const candidates = new Set<string>([normalized])
  if (normalized.startsWith('www.')) candidates.add(normalized.slice(4))
  else candidates.add(`www.${normalized}`)
  return [...candidates]
}

export function defaultSiteSlug() {
  return process.env.SITE_SLUG || 'CreateCanyon'
}

export function storefrontPath(storefrontSlug: string | null | undefined) {
  return `/vendors/${storefrontSlug || ''}`
}

export async function getSiteBySlug(slug: string) {
  return prisma.site.findUnique({ where: { slug } })
}

export async function resolveSiteByHost(host: string | null | undefined) {
  const candidates = hostCandidates(host)
  if (!candidates.length) return null
  return prisma.site.findFirst({ where: { domain: { in: candidates } } })
}

export const getActiveSite = cache(async () => {
  const headerStore = await headers()
  const host = headerStore.get('x-forwarded-host') || headerStore.get('host')
  const hostMatch = await resolveSiteByHost(host)
  if (hostMatch) return hostMatch
  const fallback = await getSiteBySlug(defaultSiteSlug())
  if (!fallback) throw new Error(`Site not found for host ${host || '(none)'}`)
  return fallback
})

export async function getActiveSiteForRequest(req: NextRequest) {
  const hostMatch = await resolveSiteByHost(req.headers.get('x-forwarded-host') || req.headers.get('host'))
  if (hostMatch) return hostMatch
  const fallback = await getSiteBySlug(defaultSiteSlug())
  if (!fallback) throw new Error(`Site not found for fallback slug ${defaultSiteSlug()}`)
  return fallback
}

export async function getSiteNavigation(siteId: string) {
  const items = await prisma.siteNavigationItem.findMany({ where: { siteId, isVisible: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })
  if (items.length) return items
  return [
    { id: 'explore', siteId, label: 'Explore', href: '/', sortOrder: 0, isVisible: true, createdAt: new Date(), updatedAt: new Date() },
    { id: 'search', siteId, label: 'Search', href: '/search', sortOrder: 1, isVisible: true, createdAt: new Date(), updatedAt: new Date() },
    { id: 'dashboard', siteId, label: 'Dashboard', href: '/dashboard', sortOrder: 2, isVisible: true, createdAt: new Date(), updatedAt: new Date() },
    { id: 'purchases', siteId, label: 'Purchases', href: '/dashboard/purchases', sortOrder: 3, isVisible: true, createdAt: new Date(), updatedAt: new Date() },
  ]
}
