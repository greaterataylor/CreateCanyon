import { headers } from 'next/headers'
import type { NextRequest } from 'next/server'
import { cache } from 'react'
import { prisma, isPrismaConnectionError } from './prisma'

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

type EmergencySite = {
  id: string
  slug: string
  name: string
  domain: string | null
  logoUrl: string | null
  seoTitle: string | null
  seoDescription: string | null
  theme: Record<string, unknown>
  settings: Record<string, unknown>
}

function getEmergencySite(host: string | null | undefined): EmergencySite {
  const normalizedHost = normalizeHost(host)
  return {
    id: 'emergency-site',
    slug: defaultSiteSlug(),
    name: process.env.SITE_NAME || 'CreateCanyon',
    domain: normalizedHost,
    logoUrl: null,
    seoTitle: process.env.SITE_NAME || 'CreateCanyon',
    seoDescription: 'Marketplace is temporarily running in degraded mode while database connectivity is restored.',
    theme: {},
    settings: {},
  }
}

async function safeSiteQuery<T>(query: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await query()
  } catch (error) {
    if (!isPrismaConnectionError(error)) throw error
    return fallback
  }
}

export async function getSiteBySlug(slug: string) {
  return safeSiteQuery(() => prisma.site.findUnique({ where: { slug } }), null)
}

export async function resolveSiteByHost(host: string | null | undefined) {
  const candidates = hostCandidates(host)
  if (!candidates.length) return null
  return safeSiteQuery(() => prisma.site.findFirst({ where: { domain: { in: candidates } } }), null)
}

export const getActiveSite = cache(async () => {
  const headerStore = await headers()
  const host = headerStore.get('x-forwarded-host') || headerStore.get('host')
  const hostMatch = await resolveSiteByHost(host)
  if (hostMatch) return hostMatch
  const fallback = await getSiteBySlug(defaultSiteSlug())
  if (fallback) return fallback
  return getEmergencySite(host)
})

export async function getActiveSiteForRequest(req: NextRequest) {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  const hostMatch = await resolveSiteByHost(host)
  if (hostMatch) return hostMatch
  const fallback = await getSiteBySlug(defaultSiteSlug())
  if (fallback) return fallback
  return getEmergencySite(host)
}

export async function getSiteNavigation(siteId: string) {
  const items = await safeSiteQuery(
    () => prisma.siteNavigationItem.findMany({ where: { siteId, isVisible: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    [],
  )
  if (items.length) return items
  return [
    { id: 'explore', siteId, label: 'Explore', href: '/', sortOrder: 0, isVisible: true, createdAt: new Date(), updatedAt: new Date() },
    { id: 'search', siteId, label: 'Search', href: '/search', sortOrder: 1, isVisible: true, createdAt: new Date(), updatedAt: new Date() },
    { id: 'dashboard', siteId, label: 'Dashboard', href: '/dashboard', sortOrder: 2, isVisible: true, createdAt: new Date(), updatedAt: new Date() },
    { id: 'purchases', siteId, label: 'Purchases', href: '/dashboard/purchases', sortOrder: 3, isVisible: true, createdAt: new Date(), updatedAt: new Date() },
  ]
}
