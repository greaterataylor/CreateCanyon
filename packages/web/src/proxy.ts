import {NextResponse,type NextRequest} from "next/server";
import {normalizeHostname} from "@createcanyon/security";
export function networkProxy(request:NextRequest){
 const host=normalizeHostname(request.headers.get('host')??'');
 const defaults='localhost,127.0.0.1,[::1],createcanyon.localhost,graphicgrounds.localhost,melodymerchant.localhost,filefoyer.localhost,programplaza.localhost';
 const allowlist=(process.env.HOST_ALLOWLIST??defaults).split(',').map(normalizeHostname);
 if(!host||!allowlist.includes(host))return new NextResponse('This hostname is not configured for the CreateCanyon Network.',{status:421,headers:{'cache-control':'no-store','content-type':'text/plain'}});
 const nonce=Buffer.from(crypto.randomUUID()).toString('base64');const development=process.env.NODE_ENV!=='production';
 const extra=(process.env.BROWSER_ASSET_ORIGINS??'http://localhost:9000 http://127.0.0.1:9000').split(/\s+/).filter(Boolean).filter(s=>{try{return new URL(s).origin===s;}catch{return false;}}).join(' ');
 const csp=["default-src 'self'",`script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://js.stripe.com ${development?"'unsafe-eval'":''}`,
  "style-src 'self' 'unsafe-inline'",`img-src 'self' data: blob: https: ${development?'http:':''}`,`media-src 'self' blob: https: ${development?'http:':''}`,
  "font-src 'self' data:",`connect-src 'self' https://*.stripe.com ${extra} ${development?'ws: wss:':''}`,"frame-src https://js.stripe.com https://hooks.stripe.com https://connect-js.stripe.com", "frame-ancestors 'none'","base-uri 'self'","form-action 'self'","object-src 'none'",...(development?[]:['upgrade-insecure-requests'])].join('; ');
 const h=new Headers(request.headers);h.set('x-nonce',nonce);h.set('content-security-policy',csp);h.delete('x-forwarded-host');
 const response=NextResponse.next({request:{headers:h}});
 for(const [k,v]of Object.entries({'content-security-policy':csp,'x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'strict-origin-when-cross-origin','permissions-policy':'camera=(), microphone=(), geolocation=()','cross-origin-opener-policy':'same-origin-allow-popups',...(development?{}:{'strict-transport-security':'max-age=31536000; includeSubDomains'})}))response.headers.set(k,v);
 return response;
}
