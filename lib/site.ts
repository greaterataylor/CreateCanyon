import { headers } from 'next/headers'
import type { NextRequest } from 'next/server'
import { cache } from 'react'
import type { Site } from '@prisma/client'
import { prisma, isPrismaConnectionError } from './prisma'
import { applySiteBranding, getSitePresetBySlug, normalizeSiteHost, resolveSitePresetByHost, type SiteBrandPreset } from './site-presets'

function normalizeHost(host: string | null | undefined) {
  return normalizeSiteHost(host)
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
  const raw = process.env.SITE_SLUG || 'CreateCanyon'
  return getSitePresetBySlug(raw)?.slug || raw
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
  faviconUrl: string | null
  seoTitle: string | null
  seoDescription: string | null
  theme: Record<string, unknown>
  settings: Record<string, unknown>
}

function getEmergencySite(host: string | null | undefined): EmergencySite {
  const preset = resolveSitePresetByHost(host) || getSitePresetBySlug(defaultSiteSlug())
  const normalizedHost = normalizeHost(host)

  return applySiteBranding(
    {
      id: 'emergency-site',
      slug: preset?.slug || defaultSiteSlug(),
      name: process.env.SITE_NAME || preset?.name || 'CreateCanyon',
      domain: normalizedHost,
      logoUrl: null,
      faviconUrl: null,
      seoTitle: process.env.SITE_NAME || null,
      seoDescription: 'Marketplace is temporarily running in degraded mode while database connectivity is restored.',
      theme: {},
      settings: {},
    },
    { host, preset },
  )
}

function withBranding<T extends { slug: string }>(site: T | null, options?: { host?: string | null; preset?: SiteBrandPreset | null }): T | null {
  return site ? (applySiteBranding(site as any, options) as T) : null
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
  const canonicalSlug = getSitePresetBySlug(slug)?.slug || slug
  const site = await safeSiteQuery<Site | null>(() => prisma.site.findUnique({ where: { slug: canonicalSlug } }), null)
  return withBranding(site, { preset: getSitePresetBySlug(canonicalSlug) })
}

export async function resolveSiteByHost(host: string | null | undefined) {
  const candidates = hostCandidates(host)
  if (candidates.length) {
    const directMatch = await safeSiteQuery<Site | null>(() => prisma.site.findFirst({ where: { domain: { in: candidates } } }), null)
    if (directMatch) return withBranding(directMatch, { host, preset: getSitePresetBySlug(directMatch.slug) || resolveSitePresetByHost(host) })
  }

  const preset = resolveSitePresetByHost(host)
  if (!preset) return null
  return withBranding(await getSiteBySlug(preset.slug), { host, preset })
}

export const getActiveSite = cache(async (): Promise<EmergencySite> => {
  const headerStore = await headers()
  const host = headerStore.get('x-forwarded-host') || headerStore.get('host')
  const hostMatch = await resolveSiteByHost(host)
  if (hostMatch) return hostMatch as EmergencySite
  const fallback = await getSiteBySlug(defaultSiteSlug())
  if (fallback) return fallback as EmergencySite
  return getEmergencySite(host)
})

export async function getActiveSiteForRequest(req: NextRequest): Promise<EmergencySite> {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  const hostMatch = await resolveSiteByHost(host)
  if (hostMatch) return hostMatch as EmergencySite
  const fallback = await getSiteBySlug(defaultSiteSlug())
  if (fallback) return fallback as EmergencySite
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
