import { describe, expect, it } from "vitest";
import { createItemSchema, createUploadSessionSchema } from "./index.js";

const item = {
  sellerOrganisationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  assetType: "PHOTO",
  originChannelKey: "graphicgrounds",
  channelKeys: ["graphicgrounds", "createcanyon"],
  title: "Editorial office photograph",
  description: "A professionally released editorial office photograph suitable for business use.",
  basePrice: { amountMinor: 1900, currency: "USD" },
};

describe("marketplace contracts", () => {
  it("accepts one canonical item across eligible channels", () => {
    expect(createItemSchema.parse(item).channelKeys).toHaveLength(2);
  });

  it("rejects an omitted origin channel", () => {
    expect(() => createItemSchema.parse({ ...item, channelKeys: ["createcanyon"] })).toThrow();
  });

  it("rejects malformed upload hashes", () => {
    expect(() => createUploadSessionSchema.parse({
      sellerOrganisationId: item.sellerOrganisationId,
      itemVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      files: [{
        clientFileId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        role: "ORIGINAL",
        filename: "asset.zip",
        contentType: "application/zip",
        byteSize: 10,
        sha256: "not-a-hash",
      }],
    })).toThrow();
  });
});
