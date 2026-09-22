import { ConflictException } from "@nestjs/common";

export function rethrowKnownDatabaseError(error: unknown): never {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (code === "23505") throw new ConflictException({ code: "DUPLICATE_RESOURCE", message: "The resource already exists" });
  if (code === "23503") throw new ConflictException({ code: "RELATED_RESOURCE_MISSING", message: "A related resource is missing or in use" });
  throw error;
}
