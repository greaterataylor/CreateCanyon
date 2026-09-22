import type {Metadata} from 'next';
import Link from 'next/link';
import {Brand} from '@createcanyon/web/components';
import {SignOut} from '@createcanyon/web/client';
import {requireSession,appUrl} from '@createcanyon/web/server';
import '@createcanyon/web/styles.css';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:{default:'Your account · CreateCanyon',template:'%s · CreateCanyon Account'},robots:{index:false,follow:false}};
export default async function Layout({children}:{children:React.ReactNode}){
 const session=await requireSession('dashboard');
 return <html lang="en"><body><a className="skip-link" href="#main">Skip to content</a><header className="site-header"><div className="container header-inner"><Brand href={appUrl('storefront')}/><nav className="header-actions" aria-label="Account"><Link href="/cart">Network cart</Link><span className="muted">{session.displayName??session.email??'Your account'}</span><SignOut/></nav></div></header>
 <div className="container workspace"><aside className="sidebar"><p className="eyebrow">YOUR WORKSPACE</p><nav aria-label="Workspace"><Link href="/">Overview</Link><Link href="/library">Purchase library</Link><Link href="/orders">Orders & receipts</Link><Link href="/wishlist">Saved items</Link><Link href="/notifications">Notifications</Link><Link href="/support">Support conversations</Link><Link href="/seller">Seller studio</Link><Link href="/security">Account security</Link></nav><div className="notice"><strong>One creative network.</strong><p>Your purchases and seller identity work across all five storefronts.</p></div></aside><main id="main" className="workspace-main">{children}</main></div></body></html>;
}
