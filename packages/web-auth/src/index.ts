import type { WebEnvironment } from "@createcanyon/config";
import { safeSameOriginPath } from "@createcanyon/security";
import { parse, serialize } from "cookie";
import { Redis } from "ioredis";
import { CompactEncrypt, compactDecrypt, createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { createHash, randomBytes } from "node:crypto";

interface Metadata { issuer:string; authorization_endpoint:string; token_endpoint:string; jwks_uri:string; end_session_endpoint?:string; }
interface Tokens { access_token:string; refresh_token?:string; id_token?:string; expires_in:number; refresh_expires_in?:number; }
interface Access extends JWTPayload { realm_access?:{roles?:string[]};resource_access?:Record<string,{roles?:string[]}>;amr?:string[];auth_time?:number; }
interface Transaction {state:string;nonce:string;codeVerifier:string;returnTo:string;redirectUri:string;createdAt:number;}
export interface PublicSession {subject:string;email?:string;displayName?:string;roles:string[];authenticationMethods:string[];authenticatedAt?:number;expiresAt:number;}
interface Session extends PublicSession {id:string;accessToken:string;refreshToken?:string;idToken:string;accessTokenExpiresAt:number;createdAt:number;}
const random=(size=32)=>randomBytes(size).toString("base64url");
export class AuthFlowError extends Error { constructor(message:string,public readonly code:string){super(message);this.name="AuthFlowError";} }
export class WebAuth {
  private readonly redis:Redis; private readonly key:Uint8Array; private readonly prefix:string;private discovery?:Promise<Metadata>;
  private jwks?:ReturnType<typeof createRemoteJWKSet>;
  constructor(private readonly env:WebEnvironment){
    this.redis=new Redis(env.REDIS_URL,{lazyConnect:true,connectTimeout:5000,maxRetriesPerRequest:2});
    this.key=createHash("sha256").update(env.SESSION_SECRET).digest();
    this.prefix=`cc:session:${env.OIDC_CLIENT_ID}:${env.SESSION_COOKIE_NAME}:`;
  }
  private cookie(name:string,value:string,maxAge:number,path="/"){
    return serialize(name,value,{httpOnly:true,secure:this.env.NODE_ENV==="production",sameSite:"lax",path,maxAge,priority:"high"});
  }
  private get transactionCookie(){return `${this.env.SESSION_COOKIE_NAME}_tx`;}
  async createLogin(requestUrl:URL,returnTo="/",stepUp=false){
    const metadata=await this.metadata();const state=random(),nonce=random(),codeVerifier=random(64);
    const transaction:Transaction={state,nonce,codeVerifier,returnTo:safeSameOriginPath(returnTo),redirectUri:new URL("/api/auth/callback",requestUrl.origin).href,createdAt:Date.now()};
    await this.redis.set(`${this.prefix}tx:${state}`,"1","EX",600);
    const url=new URL(metadata.authorization_endpoint);
    Object.entries({client_id:this.env.OIDC_CLIENT_ID,redirect_uri:transaction.redirectUri,response_type:"code",scope:"openid profile email",state,nonce,code_challenge:createHash("sha256").update(codeVerifier).digest("base64url"),code_challenge_method:"S256"}).forEach(([k,v])=>url.searchParams.set(k,v));
    if(stepUp){url.searchParams.set("max_age","0");url.searchParams.set("prompt","login");if(this.env.OIDC_STEP_UP_ACR)url.searchParams.set("acr_values",this.env.OIDC_STEP_UP_ACR);}
    return {redirectTo:url.href,transactionCookie:this.cookie(this.transactionCookie,await this.encrypt(transaction),600,"/api/auth")};
  }
  async handleCallback(url:URL,cookies:string|null){
    const encrypted=parse(cookies??"")[this.transactionCookie];
    if(!encrypted)throw new AuthFlowError("Login transaction is missing","LOGIN_TRANSACTION_MISSING");
    const tx=await this.decrypt<Transaction>(encrypted);
    if(Date.now()-tx.createdAt>600000||tx.createdAt>Date.now()+5000||url.searchParams.get("state")!==tx.state||url.origin!==new URL(tx.redirectUri).origin)throw new AuthFlowError("Invalid or expired login transaction","INVALID_LOGIN_TRANSACTION");
    const code=url.searchParams.get("code");if(!code||url.searchParams.has("error"))throw new AuthFlowError("The identity provider did not authorize this login","OIDC_LOGIN_FAILED");
    if(!await this.redis.getdel(`${this.prefix}tx:${tx.state}`))throw new AuthFlowError("Login transaction was already consumed","LOGIN_TRANSACTION_REPLAY");
    const tokens=await this.exchange({grant_type:"authorization_code",code,redirect_uri:tx.redirectUri,code_verifier:tx.codeVerifier});
    const metadata=await this.metadata();
    if(!tokens.id_token)throw new AuthFlowError("ID token is missing","ID_TOKEN_MISSING");
    this.jwks??=createRemoteJWKSet(new URL(metadata.jwks_uri));
    const {payload}=await jwtVerify(tokens.id_token,this.jwks,{issuer:metadata.issuer,audience:this.env.OIDC_CLIENT_ID,algorithms:["RS256","PS256","ES256"]});
    if(!payload.sub||payload.nonce!==tx.nonce||(payload.azp&&payload.azp!==this.env.OIDC_CLIENT_ID))throw new AuthFlowError("ID token validation failed","INVALID_ID_TOKEN");
    const access=await this.verifyAccess(tokens.access_token);
    if(access.sub!==payload.sub)throw new AuthFlowError("Token subject mismatch","INVALID_ACCESS_TOKEN");
    const now=Math.floor(Date.now()/1000);
    const session:Session={id:random(48),subject:payload.sub,roles:this.roles(access),authenticationMethods:access.amr??[],
      ...(access.auth_time?{authenticatedAt:access.auth_time}:{}),...(typeof payload.email==="string"?{email:payload.email}:{}),
      ...(typeof payload.name==="string"?{displayName:payload.name}:{}),accessToken:tokens.access_token,idToken:tokens.id_token,
      ...(tokens.refresh_token?{refreshToken:tokens.refresh_token}:{}),accessTokenExpiresAt:Math.min(now+tokens.expires_in,access.exp??now),
      createdAt:now,expiresAt:now+this.env.SESSION_MAX_AGE_SECONDS};
    // Rotate a previous browser session instead of leaving it valid after a fresh login.
    const oldId=this.sessionId(cookies);if(oldId)await this.redis.del(`${this.prefix}${oldId}`);
    await this.save(session);
    return {sessionCookie:this.cookie(this.env.SESSION_COOKIE_NAME,session.id,this.env.SESSION_MAX_AGE_SECONDS),clearTransactionCookie:this.cookie(this.transactionCookie,"",0,"/api/auth"),redirectTo:new URL(tx.returnTo,url.origin).href};
  }
  async getSession(cookies:string|null):Promise<PublicSession|null>{
    const s=await this.stored(cookies);if(!s)return null;
    return {subject:s.subject,roles:s.roles,authenticationMethods:s.authenticationMethods,expiresAt:s.expiresAt,
      ...(s.email?{email:s.email}:{}),...(s.displayName?{displayName:s.displayName}:{}),...(s.authenticatedAt?{authenticatedAt:s.authenticatedAt}:{})};
  }
  async authenticatedFetch(cookies:string|null,path:string,init:RequestInit={}){
    if(!path.startsWith("/v1/")||path.includes("\\"))throw new AuthFlowError("API path is not allowed","INVALID_API_PATH");
    const base=new URL(this.env.API_BASE_URL),url=new URL(path,base);
    if(url.origin!==base.origin)throw new AuthFlowError("API origin is not allowed","INVALID_API_ORIGIN");
    const s=await this.stored(cookies);if(!s)throw new AuthFlowError("Sign in to continue","AUTHENTICATION_REQUIRED");
    const headers=new Headers(init.headers);headers.delete("cookie");headers.set("authorization",`Bearer ${s.accessToken}`);headers.set("accept","application/json");
    return fetch(url,{...init,headers,cache:"no-store",redirect:"manual",signal:init.signal??AbortSignal.timeout(30000)});
  }
  async logout(cookies:string|null,origin:string){
    const id=this.sessionId(cookies);const s=id?await this.load(id):null;if(id)await this.redis.del(`${this.prefix}${id}`);
    let redirectTo=origin;
    try{const m=await this.metadata();if(m.end_session_endpoint&&s){const u=new URL(m.end_session_endpoint);u.searchParams.set("id_token_hint",s.idToken);u.searchParams.set("post_logout_redirect_uri",origin);redirectTo=u.href;}}catch{/* Local revocation remains effective during provider outages. */}
    return {clearSessionCookie:this.cookie(this.env.SESSION_COOKIE_NAME,"",0),redirectTo};
  }
  async close(){await this.redis.quit();}
  private sessionId(cookies:string|null){const id=parse(cookies??"")[this.env.SESSION_COOKIE_NAME];return id&&/^[A-Za-z0-9_-]{64}$/.test(id)?id:null;}
  private async stored(cookies:string|null):Promise<Session|null>{
    const id=this.sessionId(cookies);if(!id)return null;const s=await this.load(id);if(!s)return null;
    const now=Math.floor(Date.now()/1000);if(s.expiresAt<=now){await this.redis.del(`${this.prefix}${id}`);return null;}
    if(s.accessTokenExpiresAt>now+45)return s;if(!s.refreshToken){await this.redis.del(`${this.prefix}${id}`);return null;}
    const lock=`${this.prefix}refresh:${id}`,owner=random();
    if(!await this.redis.set(lock,owner,"EX",20,"NX")){
      // Serialize refresh-token rotation across simultaneous server-rendered requests.
      for(let i=0;i<30;i++){await new Promise(resolve=>setTimeout(resolve,100));const latest=await this.load(id);if(!latest)return null;if(latest.accessTokenExpiresAt>now+45)return latest;}
      throw new AuthFlowError("Session refresh is busy; retry the request","SESSION_REFRESH_BUSY");
    }
    try{
      const latest=await this.load(id);if(!latest)return null;if(latest.accessTokenExpiresAt>now+45)return latest;
      const tokens=await this.exchange({grant_type:"refresh_token",refresh_token:latest.refreshToken!});
      const access=await this.verifyAccess(tokens.access_token);if(access.sub!==latest.subject)throw new Error("Subject changed during refresh");
      const next:Session={...latest,accessToken:tokens.access_token,refreshToken:tokens.refresh_token??latest.refreshToken,
        idToken:tokens.id_token??latest.idToken,roles:this.roles(access),authenticationMethods:access.amr??[],
        ...(access.auth_time?{authenticatedAt:access.auth_time}:{}),accessTokenExpiresAt:Math.min(now+tokens.expires_in,access.exp??now)};
      await this.save(next);return next;
    }catch(error){await this.redis.del(`${this.prefix}${id}`);throw new AuthFlowError("Sign in again to refresh your session","SESSION_REFRESH_FAILED");}
    finally{await this.redis.eval("if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",1,lock,owner);}
  }
  private roles(p:Access){return [...new Set([...(p.realm_access?.roles??[]),...(p.resource_access?.[this.env.OIDC_AUDIENCE]?.roles??[])])];}
  private async verifyAccess(token:string){const m=await this.metadata();this.jwks??=createRemoteJWKSet(new URL(m.jwks_uri));return (await jwtVerify<Access>(token,this.jwks,{issuer:m.issuer,audience:this.env.OIDC_AUDIENCE,algorithms:["RS256","PS256","ES256"]})).payload;}
  private async exchange(values:Record<string,string>):Promise<Tokens>{
    const m=await this.metadata();const response=await fetch(m.token_endpoint,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({...values,client_id:this.env.OIDC_CLIENT_ID,client_secret:this.env.OIDC_CLIENT_SECRET}),cache:"no-store",signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new AuthFlowError("The identity provider rejected the token exchange","TOKEN_EXCHANGE_FAILED");
    const tokens=await response.json() as Tokens;if(typeof tokens.access_token!=="string"||!Number.isFinite(tokens.expires_in)||tokens.expires_in<=0)throw new Error("Invalid token response");return tokens;
  }
  private async metadata(){
    if(!this.discovery)this.discovery=fetch(`${this.env.OIDC_ISSUER_URL}/.well-known/openid-configuration`,{signal:AbortSignal.timeout(5000)}).then(async r=>{
      if(!r.ok)throw new Error("OIDC discovery unavailable");const m=await r.json() as Metadata;if(m.issuer!==this.env.OIDC_ISSUER_URL)throw new Error("OIDC issuer mismatch");return m;
    }).catch(e=>{this.discovery=undefined;throw e;});return this.discovery;
  }
  private async save(s:Session){const ttl=s.expiresAt-Math.floor(Date.now()/1000);if(ttl>0)await this.redis.set(`${this.prefix}${s.id}`,await this.encrypt(s),"EX",ttl);}
  private async load(id:string){const raw=await this.redis.get(`${this.prefix}${id}`);return raw?this.decrypt<Session>(raw):null;}
  private async encrypt(value:unknown){return new CompactEncrypt(Buffer.from(JSON.stringify(value))).setProtectedHeader({alg:"dir",enc:"A256GCM"}).encrypt(this.key);}
  private async decrypt<T>(value:string):Promise<T>{try{return JSON.parse(Buffer.from((await compactDecrypt(value,this.key)).plaintext).toString("utf8")) as T;}catch{throw new AuthFlowError("Session could not be decoded","INVALID_SESSION");}}
}
