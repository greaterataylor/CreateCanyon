import { createParamDecorator, SetMetadata, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { Principal } from "./auth.types.js";

export const IS_PUBLIC_KEY = "createcanyon:isPublic";
export const REQUIRED_ROLES_KEY = "createcanyon:requiredRoles";
export const REQUIRE_MFA_KEY = "createcanyon:requireMfa";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const Roles = (...roles: string[]) => SetMetadata(REQUIRED_ROLES_KEY, roles);
export const RequireMfa = () => SetMetadata(REQUIRE_MFA_KEY, true);
export const CurrentPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext): Principal => {
  const request = context.switchToHttp().getRequest<FastifyRequest & { principal?: Principal }>();
  if (!request.principal) throw new Error("CurrentPrincipal used without authentication");
  return request.principal;
});
