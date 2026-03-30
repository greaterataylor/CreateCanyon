'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'

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
    <header className="border-b bg-white/95 backdrop-blur">
      <div className="container flex flex-col gap-3 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-6">
            <Link href="/" className="flex items-center gap-3 text-lg font-bold text-brand-700">
              {logoUrl ? (
                <span className="relative block h-10 w-10 overflow-hidden rounded-xl border border-gray-200 bg-white">
                  <Image src={logoUrl} alt={`${siteName} logo`} fill className="object-contain p-1" />
                </span>
              ) : null}
              <span>{siteName}</span>
            </Link>
            <nav className="flex flex-wrap items-center gap-2 md:gap-4">
              {navItems.map((item) => (
                <Link key={item.id} href={item.href} className={clsx('navlink', pathname === item.href && 'navlink-active')}>
                  {item.label}
                </Link>
              ))}
              {isSignedIn ? (
                <Link href="/dashboard/collections" className={clsx('navlink', pathname.startsWith('/dashboard/collections') && 'navlink-active')}>
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
              <button className="btn-secondary" type="submit">Search</button>
            </form>
            <div className="flex items-center gap-3">
              {isSignedIn ? (
                <>
                  <span className="text-sm text-gray-600">{userName || 'Signed in'}</span>
                  <a href="/dashboard" className="btn-secondary">Dashboard</a>
                  <form action="/api/auth/sign-out" method="POST"><button className="btn-secondary" type="submit">Sign out</button></form>
                </>
              ) : (
                <>
                  <a href="/sign-in" className="btn-secondary">Sign in</a>
                  <a href="/sign-up" className="btn">Create account</a>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
