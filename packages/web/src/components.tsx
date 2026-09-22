import type {ReactNode} from "react";
import Link from "next/link";
export function money(value:number|string|bigint,currency='USD'){
 try{const format=new Intl.NumberFormat('en-AU',{style:'currency',currency});const digits=format.resolvedOptions().maximumFractionDigits??2;return format.format(Number(value)/10**digits);}catch{return `${currency} ${String(value)} minor units`;}
}
export function Brand({name='CreateCanyon',href='/'}:{name?:string;href?:string}){return <Link href={href} className="brand" aria-label={`${name} home`}><span className="brand-mark" aria-hidden="true">C</span><span>{name}<small>THE CREATOR NETWORK</small></span></Link>;}
export function Badge({children,tone='neutral'}:{children:ReactNode;tone?:'neutral'|'positive'|'warning'}){return <span className={`badge ${tone}`}>{children}</span>;}
export function EmptyState({title,children,action}:{title:string;children?:ReactNode;action?:ReactNode}){return <div className="empty-state"><span className="empty-icon" aria-hidden="true">◇</span><h2>{title}</h2><p>{children}</p>{action}</div>;}
export function PageHeading({eyebrow,title,children,action}:{eyebrow?:string;title:string;children?:ReactNode;action?:ReactNode}){return <div className="page-heading"><div>{eyebrow&&<p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{children&&<p className="lede">{children}</p>}</div>{action}</div>;}
export interface Listing {listingId:string;itemId:string;slug:string;title:string;description:string;assetType:string;sellerDisplayName:string;sellerSlug:string;amountMinor:number;currency:string;rating:number;sales:number;storefrontKey:string;licenseVariantId:string;categoryName?:string;previewUrl?:string;}
export function ProductCard({item}:{item:Listing}){
 const kind=item.assetType.toLowerCase();const label=item.assetType.replaceAll('_',' ');
 return <article className="product-card"><Link href={`/items/${encodeURIComponent(item.slug)}`} className={`product-art art-${kind}`} aria-label={item.title}>
  {item.previewUrl?<img src={item.previewUrl} alt="" loading="lazy"/>:<><span className="art-grid"/><span className="art-symbol" aria-hidden="true">{['music','sound_effect','audio_loop'].includes(kind)?'♫':['code','plugin','theme','integration','developer_tool'].includes(kind)?'</>':['document_template','presentation_template','spreadsheet_template','printable'].includes(kind)?'Aa':'✳'}</span><span className="art-label">{label}</span></>}
  <span className="card-corner">↗</span></Link>
  <div className="product-info"><p className="product-meta">{item.categoryName??label}</p><h3><Link href={`/items/${encodeURIComponent(item.slug)}`}>{item.title}</Link></h3><p className="creator">by <Link href={`/sellers/${encodeURIComponent(item.sellerSlug)}`}>{item.sellerDisplayName}</Link></p>
   <div className="product-bottom"><span>{item.rating>0?`★ ${Number(item.rating).toFixed(1)}`:'New release'}</span><strong>{money(item.amountMinor,item.currency)}</strong></div></div></article>;
}
export function DataTable({headings,children}:{headings:string[];children:ReactNode}){return <div className="table-scroll"><table><thead><tr>{headings.map(h=><th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;}
export function ErrorPanel({message='The service is currently unavailable.'}:{message?:string}){return <div className="notice warning" role="alert"><strong>This section could not be loaded.</strong><p>{message}</p><p>Your account and payment state have not been changed.</p></div>;}
