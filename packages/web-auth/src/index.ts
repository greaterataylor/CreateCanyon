import type { WebEnvironment } from "@createcanyon/config";
import { safeSameOriginPath } from "@createcanyon/security";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
import { Redis } from "ioredis";
import { CompactEncrypt, compactDecrypt, createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";
import { createHash, randomBytes } from "node:crypto";

interface OidcMetadata {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
  readonly end_session_endpoint?: string;
}

interface OidcTransaction {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly returnTo: string;
  readonly redirectUri: string;
  readonly createdAt: number;
}

interface TokenResponse {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly id_token?: string;
  readonly expires_in: number;
  readonly refresh_expires_in?: number;
}

interface StoredSession {
  readonly id: string;
  readonly subject: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly roles: readonly string[];
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly idToken: string;
  readonly accessTokenExpiresAt: number;
  readonly refreshTokenExpiresAt?: number;
  readonly createdAt: number;
  readonly lastSeenAt: number;
}

export interface PublicSession {
  readonly subject: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly roles: readonly string[];
  readonly expiresAt: number;
}

const TRANSACTION_COOKIE = "cc_oidc_tx";
const SESSION_PREFIX = "cc:web-session:";
const metadataCache = new Map<string, Promise<OidcMetadata>>();

export class AuthFlowError extends Error {
  public constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "AuthFlowError";
  }
}

export class WebAuth {
  private readonly redis: Redis;
  private readonly encryptionKey: Uint8Array;

  public constructor(private readonly environment: WebEnvironment) {
    this.redis = new Redis(environment.REDIS_URL, {
      lazyConnect: true,
      enableAutoPipelining: true,
      maxRetriesPerRequest: 2,
      connectTimeout: 5_000,
    });
    this.encryptionKey = createHash("sha256").update(environment.SESSION_SECRET).digest();
  }

  public async createLogin(requestUrl: URL, returnTo = "/"): Promise<{ redirectTo: string; transactionCookie: string }> {
    const metadata = await this.metadata();
    const state = randomBase64Url(32);
    const nonce = randomBase64Url(32);
    const codeVerifier = randomBase64Url(64);
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const redirectUri = new URL("/api/auth/callback", requestUrl.origin).href;
    const transaction: OidcTransaction = {
      state,
      nonce,
      codeVerifier,
      returnTo: safeSameOriginPath(returnTo),
      redirectUri,
      createdAt: Date.now(),
    };
    const encrypted = await this.encryptTransaction(transaction);
    const authorizationUrl = new URL(metadata.authorization_endpoint);
    authorizationUrl.searchParams.set("client_id", this.environment.OIDC_CLIENT_ID);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", "openid profile email");
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("nonce", nonce);
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    return {
      redirectTo: authorizationUrl.href,
      transactionCookie: serializeCookie(TRANSACTION_COOKIE, encrypted, {
        httpOnly: true,
        secure: this.environment.NODE_ENV === "production",
        sameSite: "lax",
        path: "/api/auth",
        maxAge: 600,
        priority: "high",
      }),
    };
  }

  public async handleCallback(requestUrl: URL, cookieHeader: string | null): Promise<{ sessionCookie: string; clearTransactionCookie: string; redirectTo: string }> {
    const cookies = parseCookie(cookieHeader ?? "");
    const encrypted = cookies[TRANSACTION_COOKIE];
    if (!encrypted) throw new AuthFlowError("The login transaction cookie is missing", "LOGIN_TRANSACTION_MISSING");
    const transaction = await this.decryptTransaction(encrypted);
    if (Date.now() - transaction.createdAt > 600_000) throw new AuthFlowError("The login transaction expired", "LOGIN_TRANSACTION_EXPIRED");
    const providerError = requestUrl.searchParams.get("error");
    if (providerError) throw new AuthFlowError(requestUrl.searchParams.get("error_description") ?? providerError, "IDENTITY_PROVIDER_ERROR");
    const state = requestUrl.searchParams.get("state");
    const code = requestUrl.searchParams.get("code");
    if (!code || state !== transaction.state) throw new AuthFlowError("OIDC state validation failed", "OIDC_STATE_MISMATCH");

    const metadata = await this.metadata();
    const response = await fetch(metadata.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: transaction.redirectUri,
        client_id: this.environment.OIDC_CLIENT_ID,
        client_secret: this.environment.OIDC_CLIENT_SECRET,
        code_verifier: transaction.codeVerifier,
      }),
      cache: "no-store",
    });
    if (!response.ok) throw new AuthFlowError(`Token exchange failed with HTTP ${response.status}`, "TOKEN_EXCHANGE_FAILED");
    const tokens = (await response.json()) as TokenResponse;
    if (!tokens.id_token) throw new AuthFlowError("The identity provider omitted the ID token", "ID_TOKEN_MISSING");
    const { payload } = await jwtVerify(tokens.id_token, createRemoteJWKSet(new URL(metadata.jwks_uri)), {
      issuer: metadata.issuer,
      audience: this.environment.OIDC_CLIENT_ID,
      algorithms: ["RS256", "PS256", "ES256"],
    });
    if (payload.nonce !== transaction.nonce || !payload.sub) throw new AuthFlowError("ID token validation failed", "ID_TOKEN_INVALID");

    const accessPayload = decodeJwt(tokens.access_token);
    const roles = [
      ...(((accessPayload.realm_access as { roles?: string[] } | undefined)?.roles) ?? []),
      ...Object.values((accessPayload.resource_access as Record<string, { roles?: string[] }> | undefined) ?? {}).flatMap((entry) => entry.roles ?? []),
    ];
    const now = Math.floor(Date.now() / 1000);
    const session: StoredSession = {
      id: randomBase64Url(48),
      subject: payload.sub,
      ...(typeof payload.email === "string" ? { email: payload.email } : {}),
      ...(typeof payload.name === "string" ? { displayName: payload.name } : typeof payload.preferred_username === "string" ? { displayName: payload.preferred_username } : {}),
      roles: [...new Set(roles)],
      accessToken: tokens.access_token,
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      idToken: tokens.id_token,
      accessTokenExpiresAt: now + tokens.expires_in,
      ...(tokens.refresh_expires_in ? { refreshTokenExpiresAt: now + tokens.refresh_expires_in } : {}),
      createdAt: now,
      lastSeenAt: now,
    };
    await this.saveSession(session);
    return {
      redirectTo: new URL(transaction.returnTo, requestUrl.origin).href,
      sessionCookie: serializeCookie(this.environment.SESSION_COOKIE_NAME, session.id, {
        httpOnly: true,
        secure: this.environment.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: session.refreshTokenExpiresAt ? session.refreshTokenExpiresAt - now : 28_800,
        priority: "high",
      }),
      clearTransactionCookie: serializeCookie(TRANSACTION_COOKIE, "", {
        httpOnly: true,
        secure: this.environment.NODE_ENV === "production",
        sameSite: "lax",
        path: "/api/auth",
        maxAge: 0,
      }),
    };
  }

  public async getSession(cookieHeader: string | null): Promise<PublicSession | null> {
    const stored = await this.getStoredSession(cookieHeader);
    if (!stored) return null;
    return {
      subject: stored.subject,
      ...(stored.email ? { email: stored.email } : {}),
      ...(stored.displayName ? { displayName: stored.displayName } : {}),
      roles: stored.roles,
      expiresAt: stored.accessTokenExpiresAt,
    };
  }

  public async authenticatedFetch(cookieHeader: string | null, path: string, init: RequestInit = {}): Promise<Response> {
    const stored = await this.getStoredSession(cookieHeader, true);
    if (!stored) throw new AuthFlowError("Authentication is required", "AUTHENTICATION_REQUIRED");
    const url = new URL(path, this.environment.API_BASE_URL);
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${stored.accessToken}`);
    headers.set("accept", headers.get("accept") ?? "application/json");
    return fetch(url, { ...init, headers, cache: "no-store" });
  }

  public async logout(cookieHeader: string | null, requestOrigin: string): Promise<{ clearSessionCookie: string; redirectTo: string }> {
    const cookies = parseCookie(cookieHeader ?? "");
    const sessionId = cookies[this.environment.SESSION_COOKIE_NAME];
    let idTokenHint: string | undefined;
    if (sessionId) {
      const session = await this.loadSession(sessionId);
      idTokenHint = session?.idToken;
      await this.redis.del(`${SESSION_PREFIX}${sessionId}`);
    }
    const metadata = await this.metadata();
    const redirectTo = metadata.end_session_endpoint
      ? (() => {
          const url = new URL(metadata.end_session_endpoint);
          if (idTokenHint) url.searchParams.set("id_token_hint", idTokenHint);
          url.searchParams.set("post_logout_redirect_uri", requestOrigin);
          return url.href;
        })()
      : requestOrigin;
    return {
      redirectTo,
      clearSessionCookie: serializeCookie(this.environment.SESSION_COOKIE_NAME, "", {
        httpOnly: true,
        secure: this.environment.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      }),
    };
  }

  public async close(): Promise<void> {
    await this.redis.quit();
  }

  private async getStoredSession(cookieHeader: string | null, refresh = false): Promise<StoredSession | null> {
    const sessionId = parseCookie(cookieHeader ?? "")[this.environment.SESSION_COOKIE_NAME];
    if (!sessionId) return null;
    const session = await this.loadSession(sessionId);
    if (!session) return null;
    const now = Math.floor(Date.now() / 1000);
    if (refresh && session.accessTokenExpiresAt <= now + 60 && session.refreshToken) return this.refreshSession(session);
    if (session.accessTokenExpiresAt <= now && !session.refreshToken) {
      await this.redis.del(`${SESSION_PREFIX}${sessionId}`);
      return null;
    }
    return session;
  }

  private async refreshSession(session: StoredSession): Promise<StoredSession | null> {
    if (!session.refreshToken) return null;
    const metadata = await this.metadata();
    const response = await fetch(metadata.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: session.refreshToken,
        client_id: this.environment.OIDC_CLIENT_ID,
        client_secret: this.environment.OIDC_CLIENT_SECRET,
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      await this.redis.del(`${SESSION_PREFIX}${session.id}`);
      return null;
    }
    const tokens = (await response.json()) as TokenResponse;
    const now = Math.floor(Date.now() / 1000);
    const refreshed: StoredSession = {
      ...session,
      accessToken: tokens.access_token,
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      ...(tokens.id_token ? { idToken: tokens.id_token } : {}),
      accessTokenExpiresAt: now + tokens.expires_in,
      ...(tokens.refresh_expires_in ? { refreshTokenExpiresAt: now + tokens.refresh_expires_in } : {}),
      lastSeenAt: now,
    };
    await this.saveSession(refreshed);
    return refreshed;
  }

  private async metadata(): Promise<OidcMetadata> {
    let cached = metadataCache.get(this.environment.OIDC_ISSUER_URL);
    if (!cached) {
      cached = fetch(`${this.environment.OIDC_ISSUER_URL}/.well-known/openid-configuration`, { headers: { accept: "application/json" }, cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error(`OIDC discovery failed with HTTP ${response.status}`);
        const metadata = (await response.json()) as OidcMetadata;
        if (metadata.issuer !== this.environment.OIDC_ISSUER_URL) throw new Error("OIDC issuer mismatch");
        return metadata;
      });
      metadataCache.set(this.environment.OIDC_ISSUER_URL, cached);
    }
    return cached;
  }

  private async saveSession(session: StoredSession): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const ttl = Math.max(60, (session.refreshTokenExpiresAt ?? session.accessTokenExpiresAt) - now);
    await this.redis.set(`${SESSION_PREFIX}${session.id}`, JSON.stringify(session), "EX", ttl);
  }

  private async loadSession(sessionId: string): Promise<StoredSession | null> {
    const raw = await this.redis.get(`${SESSION_PREFIX}${sessionId}`);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  }

  private async encryptTransaction(transaction: OidcTransaction): Promise<string> {
    return new CompactEncrypt(Buffer.from(JSON.stringify(transaction))).setProtectedHeader({ alg: "dir", enc: "A256GCM" }).encrypt(this.encryptionKey);
  }

  private async decryptTransaction(value: string): Promise<OidcTransaction> {
    try {
      const { plaintext } = await compactDecrypt(value, this.encryptionKey);
      return JSON.parse(Buffer.from(plaintext).toString("utf8")) as OidcTransaction;
    } catch {
      throw new AuthFlowError("Login transaction could not be decrypted", "LOGIN_TRANSACTION_INVALID");
    }
  }
}

function randomBase64Url(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}
