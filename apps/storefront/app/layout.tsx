import type {ReactNode} from 'react';
import Link from 'next/link';
import {headers} from 'next/headers';
import {storefrontContext,optionalSession,appUrl} from '@createcanyon/web/server';
import {Brand} from '@createcanyon/web/components';
import {SignOut} from '@createcanyon/web/client';
import {allStorefronts} from '@createcanyon/security';
import '@createcanyon/web/styles.css';
export const dynamic='force-dynamic';
export const metadata={title:{default:'CreateCanyon Network · assets for your next idea',template:'%s · CreateCanyon Network'},description:'One creator marketplace. Five specialist discovery channels. Find design assets, audio, documents and developer tools.'};
export default async function Layout({children}:{children:ReactNode}){
 const channel=await storefrontContext(),session=await optionalSession('storefront');const dashboard=appUrl('dashboard');const host=(await headers()).get('host')??'';const local=host.includes('localhost')||host.startsWith('127.');
 return <html lang="en"><body style={{'--accent':channel.accent} as React.CSSProperties}><a className="skip-link" href="#main">Skip to content</a>
  <div className="announcement">Independent assets. Connected by design. Welcome to the CreateCanyon Network.</div>
  <header className="site-header"><div className="shell header-inner"><Brand name={channel.name}/><nav className="header-nav" aria-label="Main navigation"><Link href="/catalog">Explore assets</Link><Link href="/licenses">Licensing</Link><a href={dashboard+'/sell'}>For creators</a></nav><div className="header-actions"><a href={dashboard+'/cart'} aria-label="Network shopping cart">Cart ↗</a>{session?<><a href={dashboard}>My account</a><SignOut/></>:<a href="/api/auth/login">Sign in</a>}<a className="button primary sell-link" href={dashboard+'/sell'}>Start selling</a></div></div></header>
  <div className="shell"><nav className="network-nav" aria-label="Network storefronts"><span>ONE NETWORK</span>{allStorefronts.map(s=><a className={'network-link'+(s.key===channel.key?' active':'')} key={s.key} href={local?`http://${s.key}.localhost:3000`:`https://${s.hostname}`} aria-current={s.key===channel.key?'page':undefined}>{s.name}</a>)}</nav></div>
  <main id="main">{children}</main>
  <footer className="site-footer"><div className="shell"><div className="footer-inner"><div><Brand name={channel.name}/><p>{channel.name} is part of the CreateCanyon Network. One account and one checkout, with products from independent creators.</p></div><nav className="footer-links" aria-label="Footer"><Link href="/catalog">Explore</Link><Link href="/licenses">Licenses</Link><a href={dashboard+'/support'}>Help & support</a><a href={dashboard+'/sell'}>Become a seller</a></nav></div><div className="footer-note"><span>© {new Date().getFullYear()} CreateCanyon Network.</span><span>Original files stay private. Purchases include versioned license records.</span></div></div></footer>
 </body></html>;
}
