import { BadRequestException } from "@nestjs/common";
import type { ZodType } from "zod";

export function parseWithSchema<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      code: "VALIDATION_FAILED",
      message: "Request validation failed",
      issues: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  }
  return result.data;
}

// Keep controller call sites concise while exposing the more descriptive name
// for callers that prefer it.
export const parseWith = parseWithSchema;
