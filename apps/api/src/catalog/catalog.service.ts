import type { CreateItemInput, PublicCatalogQuery, StorefrontKey, UpdateListingInput, AssetType } from "@createcanyon/contracts";
import {
  catalogItems,
  channelListings,
  itemVersions,
  licenseTemplates,
  licenseVariants,
  offers,
  sellerOrganisations,
  storefronts,
  type DatabaseConnection,
} from "@createcanyon/database";
import { eligibleChannels, normalizeSlug, validateChannelSelection } from "@createcanyon/domain";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Principal } from "../auth/auth.types.js";
import { DB_CONNECTION } from "../common/tokens.js";
import { SellersService } from "../sellers/sellers.service.js";

function defaultLicenseKind(assetType: AssetType) {
  if (["MUSIC", "SOUND_EFFECT", "AUDIO_LOOP"].includes(assetType)) return "MUSIC_ONLINE" as const;
  if (assetType === "FONT") return "FONT_DESKTOP" as const;
  if (["CODE", "PLUGIN", "THEME", "INTEGRATION", "DEVELOPER_TOOL"].includes(assetType)) return "CODE_SINGLE" as const;
  return "STANDARD_COMMERCIAL" as const;
}

function asPublicListing(row: {
  listingId: string;
  slug: string;
  title: string;
  description: string;
  tags: string[];
  storefrontKey: StorefrontKey;
  itemId: string;
  assetType: AssetType;
  sellerId: string;
  sellerDisplayName: string;
  sellerSlug: string;
  amountMinor: bigint | null;
  currency: string | null;
  publishedAt: Date | null;
}) {
  return {
    ...row,
    amountMinor: row.amountMinor === null ? null : Number(row.amountMinor),
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class CatalogService {
  public constructor(
    @Inject(DB_CONNECTION) private readonly connection: DatabaseConnection,
    private readonly sellers: SellersService,
  ) {}

  public async publicList(query: PublicCatalogQuery) {
    const conditions = [
      eq(storefronts.key, query.channel),
      eq(storefronts.enabled, true),
      eq(channelListings.status, "PUBLISHED"),
      eq(channelListings.enabled, true),
      eq(catalogItems.status, "PUBLISHED"),
      eq(offers.active, true),
    ];
    if (query.assetType) conditions.push(eq(catalogItems.assetType, query.assetType));
    if (query.q) {
      const q = `%${query.q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      const search = or(ilike(channelListings.title, q), ilike(channelListings.description, q));
      if (search) conditions.push(search);
    }
    const offset = (query.page - 1) * query.pageSize;
    const orderBy = query.sort === "newest"
      ? [desc(channelListings.publishedAt)]
      : query.sort === "price_asc"
        ? [asc(offers.amountMinor)]
        : query.sort === "price_desc"
          ? [desc(offers.amountMinor)]
          : [desc(channelListings.publishedAt), asc(channelListings.title)];

    const rows = await this.connection.db
      .select({
        listingId: channelListings.id,
        slug: channelListings.slug,
        title: channelListings.title,
        description: channelListings.description,
        tags: channelListings.tags,
        storefrontKey: storefronts.key,
        itemId: catalogItems.id,
        assetType: catalogItems.assetType,
        sellerId: sellerOrganisations.id,
        sellerDisplayName: sellerOrganisations.displayName,
        sellerSlug: sellerOrganisations.slug,
        amountMinor: offers.amountMinor,
        currency: offers.currency,
        publishedAt: channelListings.publishedAt,
      })
      .from(channelListings)
      .innerJoin(storefronts, eq(channelListings.storefrontId, storefronts.id))
      .innerJoin(catalogItems, eq(channelListings.itemId, catalogItems.id))
      .innerJoin(sellerOrganisations, eq(catalogItems.sellerOrganisationId, sellerOrganisations.id))
      .innerJoin(licenseVariants, eq(licenseVariants.itemId, catalogItems.id))
      .innerJoin(offers, and(eq(offers.licenseVariantId, licenseVariants.id), or(eq(offers.storefrontId, storefronts.id), sql`${offers.storefrontId} is null`)))
      .where(and(...conditions))
      .orderBy(...orderBy)
      .limit(query.pageSize)
      .offset(offset);

    const [countRow] = await this.connection.db
      .select({ count: sql<number>`count(distinct ${channelListings.id})::int` })
      .from(channelListings)
      .innerJoin(storefronts, eq(channelListings.storefrontId, storefronts.id))
      .innerJoin(catalogItems, eq(channelListings.itemId, catalogItems.id))
      .innerJoin(licenseVariants, eq(licenseVariants.itemId, catalogItems.id))
      .innerJoin(offers, eq(offers.licenseVariantId, licenseVariants.id))
      .where(and(...conditions));

    return { items: rows.map(asPublicListing), page: query.page, pageSize: query.pageSize, total: countRow?.count ?? 0 };
  }

  public async publicGet(channel: StorefrontKey, slug: string) {
    const [row] = await this.connection.db
      .select({
        listingId: channelListings.id,
        slug: channelListings.slug,
        title: channelListings.title,
        description: channelListings.description,
        tags: channelListings.tags,
        storefrontKey: storefronts.key,
        itemId: catalogItems.id,
        assetType: catalogItems.assetType,
        sellerId: sellerOrganisations.id,
        sellerDisplayName: sellerOrganisations.displayName,
        sellerSlug: sellerOrganisations.slug,
        amountMinor: offers.amountMinor,
        currency: offers.currency,
        publishedAt: channelListings.publishedAt,
        itemMetadata: catalogItems.metadata,
        aiDisclosure: catalogItems.aiDisclosure,
        versionId: itemVersions.id,
        versionLabel: itemVersions.versionLabel,
        licenseVariantId: licenseVariants.id,
        licenseName: licenseVariants.name,
        licenseParameters: licenseVariants.parameters,
        canonicalUrl: channelListings.canonicalUrl,
      })
      .from(channelListings)
      .innerJoin(storefronts, eq(channelListings.storefrontId, storefronts.id))
      .innerJoin(catalogItems, eq(channelListings.itemId, catalogItems.id))
      .innerJoin(itemVersions, eq(catalogItems.currentVersionId, itemVersions.id))
      .innerJoin(sellerOrganisations, eq(catalogItems.sellerOrganisationId, sellerOrganisations.id))
      .innerJoin(licenseVariants, and(eq(licenseVariants.itemId, catalogItems.id), eq(licenseVariants.enabled, true)))
      .innerJoin(offers, and(eq(offers.licenseVariantId, licenseVariants.id), eq(offers.active, true), or(eq(offers.storefrontId, storefronts.id), sql`${offers.storefrontId} is null`)))
      .where(and(
        eq(storefronts.key, channel),
        eq(channelListings.slug, slug),
        eq(channelListings.status, "PUBLISHED"),
        eq(channelListings.enabled, true),
        eq(catalogItems.status, "PUBLISHED"),
      ))
      .limit(1);
    if (!row) throw new NotFoundException({ code: "LISTING_NOT_FOUND", message: "Listing was not found" });
    return { ...asPublicListing(row), itemMetadata: row.itemMetadata, aiDisclosure: row.aiDisclosure, versionId: row.versionId, versionLabel: row.versionLabel, licenseVariantId: row.licenseVariantId, licenseName: row.licenseName, licenseParameters: row.licenseParameters, canonicalUrl: row.canonicalUrl };
  }

  public async create(principal: Principal, input: CreateItemInput) {
    await this.sellers.assertMembership(principal, input.sellerOrganisationId, ["OWNER", "MANAGER", "UPLOADER"]);
    validateChannelSelection(input.assetType, input.channelKeys);
    if (!input.channelKeys.includes(input.originChannelKey)) {
      throw new BadRequestException({ code: "ORIGIN_CHANNEL_REQUIRED", message: "The origin storefront must be selected" });
    }
    const storefrontRows = await this.connection.db.select().from(storefronts).where(and(inArray(storefronts.key, input.channelKeys), eq(storefronts.enabled, true)));
    if (storefrontRows.length !== input.channelKeys.length) throw new BadRequestException({ code: "INVALID_STOREFRONT_SELECTION", message: "One or more storefronts are unavailable" });
    const byKey = new Map(storefrontRows.map((entry) => [entry.key, entry]));
    const origin = byKey.get(input.originChannelKey);
    if (!origin) throw new BadRequestException({ code: "ORIGIN_STOREFRONT_UNAVAILABLE", message: "Origin storefront is unavailable" });
    const specialist = input.channelKeys.find((key) => key !== "createcanyon");
    const primary = byKey.get(specialist ?? input.originChannelKey) ?? origin;
    const [licenseTemplate] = await this.connection.db.select().from(licenseTemplates).where(and(
      eq(licenseTemplates.kind, defaultLicenseKind(input.assetType)),
      eq(licenseTemplates.active, true),
    )).orderBy(desc(licenseTemplates.version)).limit(1);
    if (!licenseTemplate) throw new BadRequestException({ code: "LICENSE_CONFIGURATION_MISSING", message: "No active license template is configured for this asset type" });

    return this.connection.db.transaction(async (tx) => {
      const [item] = await tx.insert(catalogItems).values({
        sellerOrganisationId: input.sellerOrganisationId,
        assetType: input.assetType,
        title: input.title,
        description: input.description,
        aiDisclosure: input.aiDisclosure,
        metadata: input.metadata,
        originStorefrontId: origin.id,
        primaryStorefrontId: primary.id,
      }).returning();
      if (!item) throw new Error("Catalog item insert returned no row");
      const [version] = await tx.insert(itemVersions).values({
        itemId: item.id,
        versionNumber: 1,
        versionLabel: "1.0.0",
        status: "DRAFT",
      }).returning();
      if (!version) throw new Error("Item version insert returned no row");
      await tx.update(catalogItems).set({ currentVersionId: version.id, updatedAt: new Date() }).where(eq(catalogItems.id, item.id));
      const slugBase = `${normalizeSlug(input.title)}-${item.id.slice(0, 8)}`;
      const listingRows = await tx.insert(channelListings).values(storefrontRows.map((storefront) => ({
        itemId: item.id,
        storefrontId: storefront.id,
        slug: slugBase,
        title: input.title,
        description: input.description,
        tags: input.tags,
        enabled: true,
        isPrimary: storefront.id === primary.id,
        canonicalUrl: storefront.id === primary.id ? null : `https://${primary.hostname}/items/${slugBase}`,
      }))).returning();
      const [variant] = await tx.insert(licenseVariants).values({
        itemId: item.id,
        licenseTemplateId: licenseTemplate.id,
        name: licenseTemplate.name,
      }).returning();
      if (!variant) throw new Error("License variant insert returned no row");
      await tx.insert(offers).values(storefrontRows.map((storefront) => ({
        licenseVariantId: variant.id,
        storefrontId: storefront.id,
        amountMinor: BigInt(input.basePrice.amountMinor),
        currency: input.basePrice.currency,
      })));
      return { item: { ...item, currentVersionId: version.id }, version, listings: listingRows, eligibleChannels: eligibleChannels(input.assetType) };
    });
  }

  public async sellerItems(principal: Principal, sellerOrganisationId: string) {
    await this.sellers.assertMembership(principal, sellerOrganisationId);
    return this.connection.db
      .select({ item: catalogItems, version: itemVersions, listing: channelListings, storefront: storefronts })
      .from(catalogItems)
      .leftJoin(itemVersions, eq(catalogItems.currentVersionId, itemVersions.id))
      .leftJoin(channelListings, eq(channelListings.itemId, catalogItems.id))
      .leftJoin(storefronts, eq(channelListings.storefrontId, storefronts.id))
      .where(eq(catalogItems.sellerOrganisationId, sellerOrganisationId))
      .orderBy(desc(catalogItems.updatedAt));
  }

  public async updateListing(principal: Principal, listingId: string, input: UpdateListingInput) {
    const [existing] = await this.connection.db
      .select({ listing: channelListings, sellerOrganisationId: catalogItems.sellerOrganisationId })
      .from(channelListings)
      .innerJoin(catalogItems, eq(channelListings.itemId, catalogItems.id))
      .where(eq(channelListings.id, listingId))
      .limit(1);
    if (!existing) throw new NotFoundException({ code: "LISTING_NOT_FOUND", message: "Listing was not found" });
    await this.sellers.assertMembership(principal, existing.sellerOrganisationId, ["OWNER", "MANAGER", "UPLOADER"]);
    const [updated] = await this.connection.db.update(channelListings).set({ ...input, updatedAt: new Date() }).where(eq(channelListings.id, listingId)).returning();
    return updated;
  }
}
