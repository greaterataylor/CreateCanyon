import { describe, expect, it } from "vitest";
import { resolveStorefrontFromHost, safeSameOriginPath } from "./index.js";

describe("storefront host isolation", () => {
  const allowlist = ["createcanyon.localhost", "graphicgrounds.localhost"];

  it("resolves an allowlisted specialist host", () => {
    expect(resolveStorefrontFromHost("GraphicGrounds.localhost:3000", allowlist).key).toBe("graphicgrounds");
  });

  it("rejects a forged host header", () => {
    expect(() => resolveStorefrontFromHost("attacker.example", allowlist)).toThrow(/Unrecognized/);
  });
});

describe("redirect hardening", () => {
  it("keeps local paths", () => expect(safeSameOriginPath("/library?tab=audio")).toBe("/library?tab=audio"));
  it("rejects protocol-relative paths", () => expect(safeSameOriginPath("//evil.example")).toBe("/"));
  it("rejects backslash redirects", () => expect(safeSameOriginPath("/\\evil.example")).toBe("/"));
});
