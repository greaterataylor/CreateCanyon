import { z } from "zod";

const booleanFromString = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}, z.boolean());

const csv = z.preprocess((value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return value;
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}, z.array(z.string().min(1)));

const baseEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

const databaseSchema = z.object({
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
});

const oidcSchema = z.object({
  OIDC_ISSUER_URL: z.string().url(),
  OIDC_AUDIENCE: z.string().min(3),
});

const storageSchema = z.object({
  S3_REGION: z.string().min(1),
  S3_ENDPOINT: z.string().url().optional(),
  S3_FORCE_PATH_STYLE: booleanFromString.default(false),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(8),
  S3_QUARANTINE_BUCKET: z.string().min(3),
  S3_ORIGINALS_BUCKET: z.string().min(3),
  S3_PREVIEWS_BUCKET: z.string().min(3),
  ASSET_PUBLIC_BASE_URL: z.string().url(),
});

export const apiEnvironmentSchema = baseEnvironmentSchema
  .merge(databaseSchema)
  .merge(oidcSchema)
  .merge(storageSchema)
  .extend({
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    CORS_ALLOWED_ORIGINS: csv,
    REDIS_URL: z.string().url(),
    UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(900).default(120),
    MAX_UPLOAD_BYTES: z.coerce.number().int().min(1_048_576).default(2_147_483_648),
    STRIPE_SECRET_KEY: z.string().min(10),
    STRIPE_WEBHOOK_SECRET: z.string().min(10),
    LICENSE_SIGNING_SECRET: z.string().min(32),
    PAYMENTS_MODE: z.enum(["stub", "stripe"]).default("stub"),
    PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(9000).default(3000),
    PAYOUT_RESERVE_DAYS: z.coerce.number().int().min(0).max(180).default(14),
    ALLOW_INSECURE_LOCAL_AUTH: booleanFromString.default(false),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV === "production") {
      if (environment.ALLOW_INSECURE_LOCAL_AUTH) {
        context.addIssue({
          code: "custom",
          path: ["ALLOW_INSECURE_LOCAL_AUTH"],
          message: "Insecure local authentication is forbidden in production",
        });
      }
      if (environment.PAYMENTS_MODE !== "stripe") {
        context.addIssue({
          code: "custom",
          path: ["PAYMENTS_MODE"],
          message: "Production requires real Stripe payment mode",
        });
      }
      if (environment.S3_ENDPOINT) {
        context.addIssue({
          code: "custom",
          path: ["S3_ENDPOINT"],
          message: "Production must use the cloud provider endpoint rather than a custom local endpoint",
        });
      }
    }
  });

export const workerEnvironmentSchema = baseEnvironmentSchema
  .merge(databaseSchema)
  .merge(storageSchema)
  .extend({
    MEILISEARCH_HOST: z.string().url(),
    MEILISEARCH_API_KEY: z.string().min(8),
    CLAMAV_HOST: z.string().min(1),
    CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    MAIL_FROM: z.string().email(),
    PROCESSOR_TEMP_DIR: z.string().default("/tmp"),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60000).default(1000),
    PAYOUT_RESERVE_DAYS: z.coerce.number().int().min(0).max(180).default(14),
    STRIPE_SECRET_KEY: z.string().min(10),
    PAYMENTS_MODE: z.enum(["stub", "stripe"]).default("stub"),
  });

export const webEnvironmentSchema = baseEnvironmentSchema.extend({
  REDIS_URL: z.string().url(),
  API_BASE_URL: z.string().url(),
  OIDC_ISSUER_URL: z.string().url(),
  OIDC_CLIENT_ID: z.string().min(3),
  OIDC_CLIENT_SECRET: z.string().min(8),
  SESSION_SECRET: z.string().min(32),
  SESSION_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/).default("cc_session"),
  HOST_ALLOWLIST: csv,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
});

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;
export type WebEnvironment = z.infer<typeof webEnvironmentSchema>;

export function parseApiEnvironment(source: NodeJS.ProcessEnv): ApiEnvironment {
  return apiEnvironmentSchema.parse(source);
}

export function parseWorkerEnvironment(source: NodeJS.ProcessEnv): WorkerEnvironment {
  return workerEnvironmentSchema.parse(source);
}

export function parseWebEnvironment(source: NodeJS.ProcessEnv): WebEnvironment {
  return webEnvironmentSchema.parse(source);
}
