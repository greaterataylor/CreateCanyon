import "server-only";
import {headers} from "next/headers";
import {redirect} from "next/navigation";
import {parseWebEnvironment} from "@createcanyon/config";
import {WebAuth,AuthFlowError,type PublicSession} from "@createcanyon/web-auth";
import {normalizeHostname,resolveStorefrontFromHost,storefrontIdentities,type StorefrontIdentity} from "@createcanyon/security";
import type {StorefrontKey} from "@createcanyon/contracts";
export type AppKind="storefront"|"dashboard"|"admin";
const authInstances=new Map<AppKind,WebAuth>();
export function auth(kind:AppKind){
 let instance=authInstances.get(kind);if(!instance){
  const prefix=kind.toUpperCase();const env=parseWebEnvironment({...process.env,
   API_BASE_URL:process.env.API_BASE_URL??'http://127.0.0.1:4000',
   OIDC_CLIENT_ID:process.env[`${prefix}_OIDC_CLIENT_ID`]??`cc-${kind}`,
   OIDC_CLIENT_SECRET:process.env[`${prefix}_OIDC_CLIENT_SECRET`]??process.env.OIDC_CLIENT_SECRET,
   SESSION_COOKIE_NAME:`cc_${kind}_session`,SESSION_MAX_AGE_SECONDS:kind==='admin'?'900':process.env.SESSION_MAX_AGE_SECONDS??'28800',
   HOST_ALLOWLIST:process.env.HOST_ALLOWLIST??'localhost,127.0.0.1',
  });instance=new WebAuth(env);authInstances.set(kind,instance);
 }return instance;
}
export async function optionalSession(kind:AppKind):Promise<PublicSession|null>{
 if(!process.env.REDIS_URL||!process.env.OIDC_ISSUER_URL)return null;
 try{return await auth(kind).getSession((await headers()).get('cookie'));}catch{return null;}
}
export async function requireSession(kind:AppKind,returnTo='/'){
 const session=await optionalSession(kind);if(!session)redirect(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);return session;
}
export async function storefrontContext():Promise<StorefrontIdentity>{
 const host=(await headers()).get('host')??'';const allowlist=(process.env.HOST_ALLOWLIST??'localhost,127.0.0.1,createcanyon.localhost,graphicgrounds.localhost,melodymerchant.localhost,filefoyer.localhost,programplaza.localhost').split(',');
 try{return resolveStorefrontFromHost(host,allowlist);}catch(error){
  const fallback=process.env.PREVIEW_STOREFRONT as StorefrontKey|undefined;
  if(fallback&&storefrontIdentities[fallback]&&allowlist.map(normalizeHostname).includes(normalizeHostname(host)))return storefrontIdentities[fallback];throw error;
 }
}
export class ApiError extends Error{constructor(public readonly status:number,message:string,public readonly code?:string){super(message);}}
export async function publicApi<T=any>(path:string):Promise<T>{
 if(!path.startsWith('/v1/'))throw new Error('Invalid API path');
 const response=await fetch(new URL(path,process.env.API_BASE_URL??'http://127.0.0.1:4000'),{cache:'no-store',signal:AbortSignal.timeout(6000),redirect:'error'});
 if(!response.ok)throw new ApiError(response.status,response.status===404?'Not found':'The marketplace API is unavailable');return response.json() as Promise<T>;
}
export async function accountApi<T=any>(kind:AppKind,path:string,init:RequestInit={}):Promise<T>{
 const response=await auth(kind).authenticatedFetch((await headers()).get('cookie'),`/v1/${path.replace(/^\//,'')}`,init);
 const data=await response.json().catch(()=>({message:'The API returned an unexpected response'}));
 if(!response.ok)throw new ApiError(response.status,data.message??data.error?.message??'Request failed',data.code);return data as T;
}
export function appUrl(kind:AppKind){return kind==='storefront'?(process.env.STOREFRONT_APP_URL??(process.env.NODE_ENV==='production'?'https://createcanyon.com':'http://localhost:3000')):kind==='dashboard'?(process.env.DASHBOARD_APP_URL??(process.env.NODE_ENV==='production'?'https://account.createcanyon.com':'http://localhost:3001')):(process.env.ADMIN_APP_URL??(process.env.NODE_ENV==='production'?'https://admin.createcanyon.com':'http://localhost:3002'));}
function csrf(request:Request){
 if(['GET','HEAD','OPTIONS'].includes(request.method))return;
 if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')throw new ApiError(403,'The request origin could not be verified','CSRF_REJECTED');
}
function responseError(error:unknown){
 const status=error instanceof ApiError?error.status:error instanceof AuthFlowError?401:503;
 const message=error instanceof ApiError||error instanceof AuthFlowError?error.message:'This service is not configured or is temporarily unavailable';
 return Response.json({message,...(error instanceof AuthFlowError?{code:error.code}:{})},{status,headers:{'cache-control':'no-store'}});
}
export async function authRoute(kind:AppKind,action:string,request:Request){
 try{
  if(action==='login'&&request.method==='GET'){
   const url=new URL(request.url);const result=await auth(kind).createLogin(url,url.searchParams.get('returnTo')??'/',url.searchParams.get('stepUp')==='true'||kind==='admin');
   return new Response(null,{status:303,headers:{location:result.redirectTo,'set-cookie':result.transactionCookie,'cache-control':'no-store'}});
  }
  if(action==='callback'&&request.method==='GET'){
   const result=await auth(kind).handleCallback(new URL(request.url),request.headers.get('cookie'));const h=new Headers({location:result.redirectTo,'cache-control':'no-store'});h.append('set-cookie',result.sessionCookie);h.append('set-cookie',result.clearTransactionCookie);return new Response(null,{status:303,headers:h});
  }
  if(action==='session'&&request.method==='GET')return Response.json(await auth(kind).getSession(request.headers.get('cookie')),{headers:{'cache-control':'no-store'}});
  if(action==='logout'&&request.method==='POST'){
   csrf(request);const result=await auth(kind).logout(request.headers.get('cookie'),new URL(request.url).origin);
   return new Response(null,{status:303,headers:{location:result.redirectTo,'set-cookie':result.clearSessionCookie,'cache-control':'no-store'}});
  }
  return Response.json({message:'Not found'},{status:404});
 }catch(error){return responseError(error);}
}
export async function backendRoute(kind:AppKind,segments:string[],request:Request){
 try{
  if(!segments.length||segments.some(s=>!s||s==='.'||s==='..'||/[\\/\x00-\x20]/.test(s)))throw new ApiError(400,'Invalid API path');
  const allowed=new Set(['catalog','seller-profile','storefronts','sellers','seller','uploads','cart','checkout','library','orders','reviews','support','notifications','wishlist','copyright-reports','me','admin']);
  if(!allowed.has(segments[0]!)||(segments[0]==='admin'&&kind!=='admin'))throw new ApiError(404,'Not found');
  csrf(request);
  let body:string|undefined;
  if(!['GET','HEAD'].includes(request.method)){
   if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new ApiError(415,'Send an application/json request');
   if(Number(request.headers.get('content-length')??0)>524288)throw new ApiError(413,'Request body is too large');
   body=await request.text();if(Buffer.byteLength(body)>524288)throw new ApiError(413,'Request body is too large');if(body)JSON.parse(body);
  }
  const query=new URL(request.url).search;const path=`/v1/${segments.map(encodeURIComponent).join('/')}${query}`;
  const h=new Headers({'accept':'application/json',...(body!==undefined?{'content-type':'application/json'}:{})});
  const key=request.headers.get('idempotency-key');if(key)h.set('idempotency-key',key);
  const init:RequestInit={method:request.method,headers:h,...(body!==undefined?{body}:{}),cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(45000)};
  const isPublic=(request.method==='GET'&&(['catalog','seller-profile','storefronts'].includes(segments[0]!)||segments.join('/')==='sellers/terms/current'))||(request.method==='POST'&&segments.join('/')==='copyright-reports');
  const result=isPublic?await fetch(new URL(path,process.env.API_BASE_URL??'http://127.0.0.1:4000'),init):await auth(kind).authenticatedFetch(request.headers.get('cookie'),path,init);
  if(result.status>=300&&result.status<400)throw new ApiError(502,'Unexpected API redirect');
  return new Response(result.body,{status:result.status,headers:{'content-type':'application/json','cache-control':'private, no-store','x-content-type-options':'nosniff'}});
 }catch(error){return responseError(error);}
}
