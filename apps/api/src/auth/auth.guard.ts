import type { ApiEnvironment } from "@createcanyon/config";
import { ForbiddenException, Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { API_ENV } from "../common/tokens.js";
import { IS_PUBLIC_KEY, REQUIRE_MFA_KEY, REQUIRED_ROLES_KEY, PHISHING_RESISTANT_KEY } from "./auth.decorators.js";
import type { Principal } from "./auth.types.js";
import { UsersService } from "./users.service.js";

interface OidcPayload extends JWTPayload {
  readonly email?: string;
  readonly name?: string;
  readonly preferred_username?: string;
  readonly realm_access?: { readonly roles?: readonly string[] };
  readonly resource_access?: Record<string, { readonly roles?: readonly string[] }>;
  readonly amr?: readonly string[];
  readonly auth_time?: number;
}

@Injectable()
export class ApiAuthGuard implements CanActivate {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  public constructor(private readonly reflector: Reflector, @Inject(API_ENV) private readonly environment: ApiEnvironment, private readonly users: UsersService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    const request = context.switchToHttp().getRequest<FastifyRequest & { principal?: Principal }>();
    let principal: Principal | undefined;
    const authorization = request.headers.authorization;
    if (authorization?.startsWith("Bearer ")) principal = await this.verifyToken(authorization.slice(7));
    else if (this.environment.ALLOW_INSECURE_LOCAL_AUTH) principal = this.readDevelopmentPrincipal(request);
    if (!principal) {
      if (isPublic) return true;
      throw new UnauthorizedException({ code: "AUTHENTICATION_REQUIRED", message: "Authentication is required" });
    }
    await this.users.resolveUser(principal);
    request.principal = principal;
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(REQUIRED_ROLES_KEY, [context.getHandler(), context.getClass()]) ?? [];
    if (requiredRoles.length && !requiredRoles.some((role) => principal.roles.includes(role))) {
      throw new ForbiddenException({ code: "ROLE_REQUIRED", message: "The authenticated account lacks the required role" });
    }
    const requiresMfa = this.reflector.getAllAndOverride<boolean>(REQUIRE_MFA_KEY, [context.getHandler(), context.getClass()]);
    const strong = new Set(["mfa", "otp", "hwk", "webauthn", "passkey"]);
    if (requiresMfa && (!principal.authenticationMethods.some((method) => strong.has(method.toLowerCase())) || !principal.authenticatedAt || Math.floor(Date.now()/1000)-principal.authenticatedAt > 900)) {
      throw new ForbiddenException({ code: "MFA_REQUIRED", message: "Multi-factor authentication is required" });
    }
    const phishingResistant = this.reflector.getAllAndOverride<boolean>(PHISHING_RESISTANT_KEY, [context.getHandler(), context.getClass()]);
    if (phishingResistant && !principal.authenticationMethods.some(method => ["hwk", "webauthn", "passkey"].includes(method.toLowerCase()))) {
      throw new ForbiddenException({ code: "PHISHING_RESISTANT_MFA_REQUIRED", message: "Use a hardware key or passkey, then sign in again" });
    }
    return true;
  }

  private async verifyToken(token: string): Promise<Principal> {
    try {
      if (!this.jwks) {
        let uri = this.environment.OIDC_JWKS_URL;
        if (!uri) {
          const response = await fetch(`${this.environment.OIDC_ISSUER_URL}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) });
          if (!response.ok) throw new Error("OIDC discovery unavailable");
          const metadata = await response.json() as { issuer: string; jwks_uri: string };
          if (metadata.issuer !== this.environment.OIDC_ISSUER_URL) throw new Error("OIDC issuer mismatch");
          uri = metadata.jwks_uri;
        }
        this.jwks = createRemoteJWKSet(new URL(uri));
      }
      const { payload } = await jwtVerify<OidcPayload>(token, this.jwks, {
        issuer: this.environment.OIDC_ISSUER_URL,
        audience: this.environment.OIDC_AUDIENCE,
        algorithms: ["RS256", "PS256", "ES256"],
        clockTolerance: 5,
      });
      if (!payload.sub) throw new Error("Token has no subject");
      const roles = [
        ...(payload.realm_access?.roles ?? []),
        ...(payload.resource_access?.[this.environment.OIDC_AUDIENCE]?.roles ?? []),
      ];
      return {
        subject: payload.sub,
        ...(payload.email ? { email: payload.email } : {}),
        ...(payload.name ?? payload.preferred_username ? { displayName: payload.name ?? payload.preferred_username } : {}),
        roles: [...new Set(roles)],
        authenticationMethods: payload.amr ?? [],
        ...(payload.auth_time ? { authenticatedAt: payload.auth_time } : {}),
      };
    } catch {
      throw new UnauthorizedException({ code: "INVALID_ACCESS_TOKEN", message: "The access token is invalid or expired" });
    }
  }

  private readDevelopmentPrincipal(request: FastifyRequest): Principal | undefined {
    const subject = request.headers["x-dev-user-sub"];
    if (typeof subject !== "string" || !subject) return undefined;
    const rolesHeader = request.headers["x-dev-roles"];
    const roles = typeof rolesHeader === "string" ? rolesHeader.split(",").map((role) => role.trim()).filter(Boolean) : [];
    const email = request.headers["x-dev-user-email"];
    const displayName = request.headers["x-dev-user-name"];
    return {
      subject,
      ...(typeof email === "string" ? { email } : {}),
      ...(typeof displayName === "string" ? { displayName } : {}),
      roles,
      authenticationMethods: roles.includes("mfa") ? ["mfa", ...(roles.includes("webauthn") ? ["webauthn"] : [])] : [],
      authenticatedAt: Math.floor(Date.now() / 1000),
    };
  }
}
