import { describe, expect, it } from "vitest";
import { apiEnvironmentSchema } from "./index.js";

const base = {
  DATABASE_URL: "postgresql://user:pass@example.test:5432/db",
  REDIS_URL: "redis://example.test:6379",
  OIDC_ISSUER_URL: "https://auth.example.test/realms/createcanyon",
  OIDC_AUDIENCE: "createcanyon-api",
  CORS_ALLOWED_ORIGINS: "https://createcanyon.com",
  S3_REGION: "ap-southeast-2",
  S3_ACCESS_KEY_ID: "access",
  S3_SECRET_ACCESS_KEY: "very-secret-key",
  S3_QUARANTINE_BUCKET: "quarantine",
  S3_ORIGINALS_BUCKET: "originals",
  S3_PREVIEWS_BUCKET: "previews",
  ASSET_PUBLIC_BASE_URL: "https://assets.createcanyon.com",
  STRIPE_SECRET_KEY: "sk_live_placeholder",
  STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
};

describe("production environment policy", () => {
  it("rejects stub payments", () => {
    expect(() => apiEnvironmentSchema.parse({ ...base, NODE_ENV: "production", PAYMENTS_MODE: "stub" })).toThrow();
  });

  it("rejects insecure authentication", () => {
    expect(() => apiEnvironmentSchema.parse({
      ...base,
      NODE_ENV: "production",
      PAYMENTS_MODE: "stripe",
      ALLOW_INSECURE_LOCAL_AUTH: "true",
    })).toThrow();
  });

  it("accepts hardened production settings", () => {
    const parsed = apiEnvironmentSchema.parse({ ...base, NODE_ENV: "production", PAYMENTS_MODE: "stripe" });
    expect(parsed.PAYMENTS_MODE).toBe("stripe");
  });
});
