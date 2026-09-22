import Link from 'next/link';
export default function NotFound(){return <main className="shell page"><div className="empty-state"><p className="eyebrow">404 · PAGE NOT FOUND</p><h1>This trail ends here.</h1><p>The page may have moved, or this item is no longer available.</p><Link href="/" className="button primary">Return home</Link></div></main>;}
