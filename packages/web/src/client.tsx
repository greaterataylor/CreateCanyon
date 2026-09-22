"use client";
import {useState,type ReactNode} from "react";
import {useRouter} from "next/navigation";
export class BrowserApiError extends Error{constructor(public status:number,message:string,public code?:string){super(message);}}
export async function api<T=any>(path:string,options:{method?:string;body?:unknown;idempotencyKey?:string}={}):Promise<T>{
 const response=await fetch('/api/backend/'+path.replace(/^\//,''),{method:options.method??'GET',headers:{'content-type':'application/json',...(options.idempotencyKey?{'idempotency-key':options.idempotencyKey}:{})},...(options.body!==undefined?{body:JSON.stringify(options.body)}:{}),credentials:'same-origin',cache:'no-store'});
 const data=await response.json().catch(()=>({message:'Unexpected response from the marketplace'}));
 if(!response.ok)throw new BrowserApiError(response.status,data.message??data.error?.message??'The request failed',data.code??data.error?.code);return data;
}
export function ActionButton({path,body={},method='POST',children,confirm,redirectTo,className='button secondary',idempotent=false}:{path:string;body?:unknown;method?:string;children:ReactNode;confirm?:string;redirectTo?:string;className?:string;idempotent?:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[key]=useState(()=>crypto.randomUUID());const router=useRouter();
 return <div className="action-control"><button className={className} disabled={busy} onClick={async()=>{if(confirm&&!window.confirm(confirm))return;setBusy(true);setError('');try{await api(path,{method,body,...(idempotent?{idempotencyKey:key}:{})});if(redirectTo)router.push(redirectTo);else router.refresh();}catch(e){setError(e instanceof Error?e.message:'Action failed');}finally{setBusy(false);}}}>{busy?'Working…':children}</button>{error&&<p className="form-error" role="alert">{error}</p>}</div>;
}
export function AddToCart({listingId,licenses,dashboardUrl}:{listingId:string;licenses:{licenseVariantId:string;name:string;amountMinor:number;currency:string;summary:string}[];dashboardUrl:string}){
 const [selected,setSelected]=useState(licenses[0]?.licenseVariantId??''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const license=licenses.find(l=>l.licenseVariantId===selected);
 return <div className="purchase-box"><label htmlFor="license">Choose a license</label><select id="license" value={selected} onChange={e=>setSelected(e.target.value)}>{licenses.map(l=><option key={l.licenseVariantId} value={l.licenseVariantId}>{l.name} · {new Intl.NumberFormat('en-AU',{style:'currency',currency:l.currency}).format(l.amountMinor/10**(new Intl.NumberFormat('en-AU',{style:'currency',currency:l.currency}).resolvedOptions().maximumFractionDigits??2))}</option>)}</select><p className="muted">{license?.summary}</p>
 <button className="button primary full" disabled={busy||!selected} onClick={async()=>{setBusy(true);setMessage('');try{await api('cart/lines',{method:'POST',body:{listingId,licenseVariantId:selected,quantity:1}});setMessage('Added to your network cart.');}catch(e){if(e instanceof BrowserApiError&&e.status===401){window.location.assign('/api/auth/login?returnTo='+encodeURIComponent(window.location.pathname));return;}setMessage(e instanceof Error?e.message:'Could not add item');}finally{setBusy(false);}}}>{busy?'Adding…':'Add to network cart'}</button>
 <a className="button text full" href={dashboardUrl+'/cart?currency='+encodeURIComponent(license?.currency??'USD')}>View cart & checkout →</a><p role="status" className="form-status">{message}</p><small>One account. One checkout. Independent creators.</small></div>;
}
export function DownloadButton({entitlementId,fileId,filename}:{entitlementId:string;fileId:string;filename:string}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');return <div><button className="button secondary small" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const result=await api(`library/${entitlementId}/download/${fileId}`,{method:'POST',body:{}});window.location.assign(result.url);}catch(e){setError(e instanceof Error?e.message:'Download could not be authorized');}finally{setBusy(false);}}}>{busy?'Authorizing…':`Download ${filename}`}</button>{error&&<p className="form-error" role="alert">{error}</p>}</div>;
}
export function SignOut(){return <form action="/api/auth/logout" method="post"><button className="nav-button" type="submit">Sign out</button></form>;}
