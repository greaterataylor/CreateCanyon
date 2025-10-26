'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'

const NAV = [
  { href: '/', label: 'Explore' },
  { href: '/dashboard', label: 'Dashboard' }
]

export default function SiteHeader({ siteName }: { siteName: string }) {
  const pathname = usePathname()
  return (
    <header className="border-b bg-white">
      <div className="container flex items-center justify-between py-3">
        <Link href="/" className="text-lg font-bold text-brand-700">{siteName}</Link>
        <nav className="flex items-center gap-4">
          {NAV.map(n => (
            <Link key={n.href} href={n.href} className={clsx('navlink', pathname === n.href && 'font-semibold text-brand-700')}>
              {n.label}
            </Link>
          ))}
          <Link href="/admin" className="navlink">Admin</Link>
          <Link href="/sign-in" className="btn-secondary">Sign in</Link>
        </nav>
      </div>
    </header>
  )
}
