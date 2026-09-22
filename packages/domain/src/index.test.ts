import { describe, expect, it } from "vitest";
import {
  assertBalancedJournal,
  assertItemTransition,
  calculateBasisPoints,
  eligibleChannels,
  validateChannelSelection,
} from "./index.js";

describe("channel rules", () => {
  it("maps visual assets to the parent and visual specialist", () => {
    expect(eligibleChannels("PHOTO")).toEqual(["createcanyon", "graphicgrounds"]);
  });

  it("rejects irrelevant cross-listing", () => {
    expect(() => validateChannelSelection("MUSIC", ["melodymerchant", "graphicgrounds"])).toThrow(/cannot be listed/);
  });
});

describe("immutable item lifecycle", () => {
  it("allows a scanned item to enter processing", () => {
    expect(() => assertItemTransition("SCANNING", "PROCESSING")).not.toThrow();
  });

  it("rejects publishing a draft directly", () => {
    expect(() => assertItemTransition("DRAFT", "PUBLISHED")).toThrow();
  });
});

describe("marketplace accounting", () => {
  it("accepts a balanced journal", () => {
    expect(() => assertBalancedJournal([
      { accountId: "stripe", debitMinor: 1000n, creditMinor: 0n, currency: "USD" },
      { accountId: "seller", debitMinor: 0n, creditMinor: 700n, currency: "USD" },
      { accountId: "platform", debitMinor: 0n, creditMinor: 300n, currency: "USD" },
    ])).not.toThrow();
  });

  it("rejects an unbalanced journal", () => {
    expect(() => assertBalancedJournal([
      { accountId: "stripe", debitMinor: 1000n, creditMinor: 0n, currency: "USD" },
      { accountId: "seller", debitMinor: 0n, creditMinor: 999n, currency: "USD" },
    ])).toThrow(/Debits/);
  });

  it("rounds basis point calculations consistently", () => {
    expect(calculateBasisPoints(1999n, 3000)).toBe(600n);
  });
});
