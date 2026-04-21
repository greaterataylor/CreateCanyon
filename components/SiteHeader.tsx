'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import NetworkMenu from '@/components/network-menu/NetworkMenu'

type NavItem = { id: string; label: string; href: string }

export default function SiteHeader({
  siteName,
  logoUrl,
  navItems,
  userName,
  isSignedIn,
  canAdmin,
}: {
  siteName: string
  logoUrl?: string | null
  navItems: NavItem[]
  userName?: string | null
  isSignedIn: boolean
  canAdmin: boolean
}) {
  const pathname = usePathname()

  return (
    <header className="border-b border-zinc-200 bg-white/95 backdrop-blur">
      <div className="container">
        <div className="flex min-w-0 items-center gap-4 border-b border-zinc-200 py-2.5">
          <div className="min-w-0 shrink-0">
            <Link
              href="/"
              aria-label={`${siteName} home`}
              className="flex min-w-0 items-center gap-3 text-zinc-900"
            >
              {logoUrl ? (
                <span className="relative block h-8 w-8 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-white">
                  <Image src={logoUrl} alt={`${siteName} logo`} fill sizes="32px" className="object-contain p-1" />
                </span>
              ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-sm font-semibold text-zinc-700">
                  {siteName.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="hidden max-w-[14rem] truncate text-sm font-medium tracking-[-0.01em] text-zinc-900 sm:block">
                {siteName}
              </span>
            </Link>
          </div>

          <div aria-hidden className="h-5 w-px shrink-0 bg-zinc-200" />

          <div className="min-w-0 flex-1">
            <NetworkMenu />
          </div>
        </div>

        <div className="flex flex-col gap-3 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-6">
              <Link href="/" aria-label={siteName} className="flex items-center text-brand-700">
                {logoUrl ? (
                  <>
                    <span className="relative block h-14 w-[180px] shrink-0 sm:w-[210px]">
                      <Image
                        src={logoUrl}
                        alt={`${siteName} logo`}
                        fill
                        priority
                        sizes="(min-width: 640px) 210px, 180px"
                        className="object-contain object-left"
                      />
                    </span>
                    <span className="sr-only">{siteName}</span>
                  </>
                ) : (
                  <span className="text-lg font-bold">{siteName}</span>
                )}
              </Link>
              <nav className="flex flex-wrap items-center gap-2 md:gap-4">
                {navItems.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    className={clsx('navlink', pathname === item.href && 'navlink-active')}
                  >
                    {item.label}
                  </Link>
                ))}
                {isSignedIn ? (
                  <Link
                    href="/dashboard/collections"
                    className={clsx(
                      'navlink',
                      pathname.startsWith('/dashboard/collections') && 'navlink-active'
                    )}
                  >
                    Collections
                  </Link>
                ) : null}
                {canAdmin ? (
                  <Link href="/admin" className={clsx('navlink', pathname.startsWith('/admin') && 'navlink-active')}>
                    Admin
                  </Link>
                ) : null}
              </nav>
            </div>

            <div className="flex flex-col gap-3 lg:items-end">
              <form action="/search" className="flex gap-2">
                <input className="input min-w-[16rem]" name="q" placeholder="Search assets" />
                <button className="btn-secondary" type="submit">
                  Search
                </button>
              </form>
              <div className="flex items-center gap-3">
                {isSignedIn ? (
                  <>
                    <span className="text-sm text-gray-600">{userName || 'Signed in'}</span>
                    <a href="/dashboard" className="btn-secondary">
                      Dashboard
                    </a>
                    <form action="/api/auth/sign-out" method="POST">
                      <button className="btn-secondary" type="submit">
                        Sign out
                      </button>
                    </form>
                  </>
                ) : (
                  <>
                    <a href="/sign-in" className="btn-secondary">
                      Sign in
                    </a>
                    <a href="/sign-up" className="btn">
                      Create account
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
