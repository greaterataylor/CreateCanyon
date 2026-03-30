import Link from 'next/link'

const links = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/purchases', label: 'Purchases' },
  { href: '/dashboard/orders', label: 'Orders' },
  { href: '/dashboard/receipts', label: 'Receipts' },
  { href: '/dashboard/downloads', label: 'Downloads' },
  { href: '/dashboard/collections', label: 'Collections' },
  { href: '/dashboard/store', label: 'Store profile' },
  { href: '/dashboard/upload', label: 'Upload asset' },
  { href: '/dashboard/assets', label: 'My assets' },
  { href: '/dashboard/sales', label: 'Sales' },
  { href: '/dashboard/payouts', label: 'Payouts' },
]

export default function DashboardNav() {
  return <div className="flex flex-wrap gap-2">{links.map((link) => <Link key={link.href} href={link.href} className="badge hover:bg-brand-100">{link.label}</Link>)}</div>
}
