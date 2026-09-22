import { describe, expect, it } from "vitest";
import { AuthFlowError } from "./index.js";

describe("auth errors", () => {
  it("preserves machine-readable codes", () => {
    const error = new AuthFlowError("Authentication is required", "AUTHENTICATION_REQUIRED");
    expect(error.code).toBe("AUTHENTICATION_REQUIRED");
    expect(error.name).toBe("AuthFlowError");
  });
});
