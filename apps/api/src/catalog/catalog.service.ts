import type { CreateItemInput, PublicCatalogQuery, StorefrontKey, UpdateListingInput, AssetType } from "@createcanyon/contracts";
import type { ApiEnvironment } from "@createcanyon/config";
import { catalogItems, channelListings, itemVersions, licenseTemplates, licenseVariants, offers, storefronts, enqueue, type DatabaseConnection } from "@createcanyon/database";
import { slugify } from "@createcanyon/domain";
import { TypesenseIndex } from "@createcanyon/search";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Principal } from "../auth/auth.types.js";
import { API_ENV, DB_CONNECTION } from "../common/tokens.js";
import { SellersService } from "../sellers/sellers.service.js";
function defaultLicenseKind(assetType:AssetType){
  if(["MUSIC","SOUND_EFFECT","AUDIO_LOOP"].includes(assetType))return "MUSIC_ONLINE" as const;
  if(assetType==="FONT")return "FONT_DESKTOP" as const;
  if(["CODE","PLUGIN","THEME","INTEGRATION","DEVELOPER_TOOL"].includes(assetType))return "CODE_SINGLE" as const;
  return "STANDARD_COMMERCIAL" as const;
}
function publicShape(r:Record<string,unknown>){
  const camel=(key:string)=>key.replace(/_([a-z])/g,(_match:string,letter:string)=>letter.toUpperCase());
  const out=Object.fromEntries(Object.entries(r).filter(([key])=>key!=="search_vector").map(([k,v])=>[camel(k),v]));
  if(typeof out.previewObjectKey==="string"&&process.env.ASSET_PUBLIC_BASE_URL)out.previewUrl=process.env.ASSET_PUBLIC_BASE_URL.replace(/\/$/,"")+"/"+out.previewObjectKey;
  delete out.previewObjectKey;
  if(out.amountMinor!==undefined)out.amountMinor=Number(out.amountMinor);return out;
}
@Injectable()
export class CatalogService {
  private readonly search:TypesenseIndex;
  constructor(@Inject(DB_CONNECTION) private readonly connection:DatabaseConnection,@Inject(API_ENV) private readonly env:ApiEnvironment,private readonly sellers:SellersService){this.search=new TypesenseIndex(env.TYPESENSE_URL,env.TYPESENSE_API_KEY);}
  async publicList(query:PublicCatalogQuery){
    const sql=this.connection.client;
    if(query.q){
      try{
        const result=await this.search.search({q:query.q,channel:query.channel,page:query.page,pageSize:query.pageSize,sort:query.sort,...(query.category?{category:query.category}:{}),...(query.assetType?{assetType:query.assetType}:{})});
        const ids=(result.hits??[]).map(hit=>hit.document.id).filter(id=>/^[0-9a-f-]{36}$/i.test(id));
        if(ids.length){
          const rows=await sql`SELECT * FROM public_listing WHERE storefront_key=${query.channel} AND listing_id IN ${sql(ids)}
            AND (${query.category??null}::text IS NULL OR category_slug=${query.category??null})
            AND (${query.assetType??null}::text IS NULL OR asset_type::text=${query.assetType??null})`;
          const byId=new Map(rows.map(r=>[r.listing_id,r]));
          return {items:ids.flatMap(id=>byId.has(id)?[publicShape(byId.get(id)!)]:[]),page:query.page,pageSize:query.pageSize,total:result.found,searchEngine:"typesense"};
        }
      }catch{/* The derived index is optional; PostgreSQL stays authoritative. */}
    }
    const order=({newest:"published_at DESC NULLS LAST,listing_id",price_asc:"amount_minor ASC,listing_id",price_desc:"amount_minor DESC,listing_id",rating:"rating DESC,sales DESC,listing_id",sales:"sales DESC,listing_id",relevance:"rank DESC,sales DESC,published_at DESC NULLS LAST,listing_id"} as const)[query.sort];
    const term=query.q??"",category=query.category??null,asset=query.assetType??null;
    const where=sql`storefront_key=${query.channel} AND (${category}::text IS NULL OR category_slug=${category})
      AND (${asset}::text IS NULL OR asset_type::text=${asset}) AND (${term}='' OR search_vector@@websearch_to_tsquery('english',${term}) OR title ILIKE ${"%"+term.replace(/[\\%_]/g,"\\$&")+"%"})`;
    const rows=await sql`SELECT *,ts_rank_cd(search_vector,websearch_to_tsquery('english',${term})) AS rank FROM public_listing WHERE ${where}
      ORDER BY ${sql.unsafe(order)} LIMIT ${query.pageSize} OFFSET ${(query.page-1)*query.pageSize}`;
    const [count]=await sql`SELECT count(*)::int AS n FROM public_listing WHERE ${where}`;
    return {items:rows.map(publicShape),page:query.page,pageSize:query.pageSize,total:count!.n,searchEngine:"postgres"};
  }
  async publicGet(channel:StorefrontKey,slug:string){
    const sql=this.connection.client;
    const [row]=await sql`SELECT * FROM public_listing WHERE storefront_key=${channel} AND slug=${slug}`;
    if(!row)throw new NotFoundException({code:"LISTING_NOT_FOUND",message:"Listing not found"});
    const licenses=await sql`SELECT v.id AS license_variant_id,v.name,t.summary,t.body_markdown,t.version,v.parameters,o.amount_minor,o.currency
      FROM license_variant v JOIN license_template t ON t.id=v.license_template_id AND t.active
      JOIN LATERAL(SELECT * FROM offer o WHERE o.license_variant_id=v.id AND o.active AND (o.storefront_id=${row.storefront_id} OR o.storefront_id IS NULL)
        AND (o.starts_at IS NULL OR o.starts_at<=now()) AND (o.ends_at IS NULL OR o.ends_at>now()) ORDER BY (o.storefront_id IS NOT NULL) DESC LIMIT 1)o ON true
      WHERE v.item_id=${row.item_id} AND v.enabled ORDER BY o.amount_minor,v.id`;
    const previews=await sql`SELECT id,object_key,detected_mime_type,metadata FROM file_object WHERE item_version_id=${row.version_id} AND role='PREVIEW' AND state='READY' AND bucket=${this.env.S3_PREVIEWS_BUCKET}`;
    const reviewRows=await sql`SELECT r.id,r.rating,r.title,r.body,r.seller_response,r.created_at,u.display_name FROM review r JOIN app_user u ON u.id=r.user_id WHERE r.item_id=${row.item_id} AND r.status='PUBLISHED' ORDER BY r.created_at DESC LIMIT 50`;
    return {...publicShape(row),licenses:licenses.map(publicShape),previews:previews.map(r=>({id:r.id,url:this.env.ASSET_PUBLIC_BASE_URL.replace(/\/$/,"")+"/"+r.object_key,mimeType:r.detected_mime_type,metadata:r.metadata})),reviews:reviewRows.map(publicShape)};
  }
  async publicSeller(slug:string,channel:StorefrontKey){
    const sql=this.connection.client;
    const [seller]=await sql`SELECT id,display_name,slug,description,website_url FROM seller_organisation WHERE slug=${slug} AND status='ACTIVE'`;
    if(!seller)throw new NotFoundException("Seller not found");
    const items=await sql`SELECT * FROM public_listing WHERE seller_id=${seller.id} AND storefront_key=${channel} ORDER BY published_at DESC LIMIT 100`;
    return {seller:publicShape(seller),items:items.map(publicShape)};
  }
  public async create(principal: Principal, input: CreateItemInput) {
    await this.sellers.assertMembership(principal, input.sellerOrganisationId, ["OWNER", "MANAGER", "UPLOADER"]);
    const allowedRows = await this.connection.client`SELECT s.key FROM channel_eligibility e JOIN storefront s ON s.id=e.storefront_id WHERE e.asset_type=${input.assetType} AND e.enabled AND s.enabled`;
    const allowed = new Set(allowedRows.map(r => r.key));
    if (input.channelKeys.some(k => !allowed.has(k))) throw new BadRequestException({ code: "CHANNEL_NOT_ELIGIBLE", message: "Asset type is not enabled on a selected storefront" });
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
        metadata: {...input.metadata, rightsDeclared:true, rightsDeclaredAt:new Date().toISOString()},
        originStorefrontId: origin.id,
        primaryStorefrontId: primary.id,
      }).returning();
      if (!item) throw new Error("Catalog item insert returned no row");
      const [version] = await tx.insert(itemVersions).values({
        itemId: item.id,
        versionNumber: 1,
        versionLabel: "1.0.0",
        status: "DRAFT",
        createdByUserId: (await this.sellers.assertMembership(principal, input.sellerOrganisationId)).user.id,
      }).returning();
      if (!version) throw new Error("Item version insert returned no row");
      await tx.update(catalogItems).set({ currentVersionId: version.id, updatedAt: new Date() }).where(eq(catalogItems.id, item.id));
      const slugBase = `${slugify(input.title)}-${item.id.slice(0, 8)}`;
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
      return { item: { ...item, currentVersionId: version.id }, version, listings: listingRows, eligibleChannels: [...allowed] };
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

  async updateListing(principal:Principal,listingId:string,input:UpdateListingInput){
    const sql=this.connection.client;
    const [existing]=await sql`SELECT l.*,i.seller_organisation_id FROM channel_listing l JOIN catalog_item i ON i.id=l.item_id WHERE l.id=${listingId}`;
    if(!existing)throw new NotFoundException("Listing not found");
    await this.sellers.assertMembership(principal,existing.seller_organisation_id,["OWNER","MANAGER","UPLOADER"]);
    return sql.begin(async tx=>{
      await tx`SELECT id FROM catalog_item WHERE id=${existing.item_id} FOR UPDATE`;
      const [locked]=await tx`SELECT * FROM channel_listing WHERE id=${listingId} FOR UPDATE`;
      if(!locked)throw new NotFoundException("Listing not found");
      const willBePrimary=input.primary??locked.is_primary,willBeEnabled=input.enabled??locked.enabled;
      if(willBePrimary&&!willBeEnabled)throw new BadRequestException("An enabled listing must be selected as primary before disabling this channel");
      if(input.primary===false && locked.is_primary)throw new BadRequestException("Select another primary listing rather than leaving no primary");
      if(input.primary===true){
        await tx`UPDATE channel_listing SET is_primary=false,updated_at=now() WHERE item_id=${existing.item_id}`;
        await tx`UPDATE catalog_item SET primary_storefront_id=${existing.storefront_id},updated_at=now() WHERE id=${existing.item_id}`;
      }
      const update:Record<string,unknown>={updated_at:new Date()};
      const columns:Record<string,string>={title:"title",description:"description",categoryId:"category_id",tags:"tags",enabled:"enabled",primary:"is_primary",seoTitle:"seo_title",seoDescription:"seo_description"};
      for(const [key,value] of Object.entries(input))if(value!==undefined)update[columns[key]!]=value;
      const [listing]=await tx`UPDATE channel_listing SET ${tx(update as never)} WHERE id=${listingId} RETURNING *`;
      await enqueue(tx,"SEARCH_ITEM","item",existing.item_id,{itemId:existing.item_id},`listing-update:${listingId}:${Date.now()}`);
      return publicShape(listing!);
    });
  }
  async createVersion(principal:Principal,itemId:string,input:{versionLabel:string;changelog:string;metadata:Record<string,unknown>}){
    const sql=this.connection.client;
    const [item]=await sql`SELECT * FROM catalog_item WHERE id=${itemId}`;if(!item)throw new NotFoundException("Item not found");
    const {user}=await this.sellers.assertMembership(principal,item.seller_organisation_id,["OWNER","MANAGER","UPLOADER"]);
    return sql.begin(async tx=>{
      await tx`SELECT id FROM catalog_item WHERE id=${itemId} FOR UPDATE`;
      const [draft]=await tx`SELECT id FROM item_version WHERE item_id=${itemId} AND status IN('DRAFT','UPLOADED','SCANNING','PROCESSING','AWAITING_REVIEW') LIMIT 1`;
      if(draft)throw new BadRequestException("Finish or retire the existing draft version first");
      const [v]=await tx`INSERT INTO item_version(item_id,version_number,version_label,changelog,metadata,created_by_user_id)
        SELECT ${itemId},coalesce(max(version_number),0)+1,${input.versionLabel},${input.changelog},${JSON.stringify(input.metadata)}::jsonb,${user.id} FROM item_version WHERE item_id=${itemId} RETURNING *`;
      return publicShape(v!);
    });
  }
  async versions(principal:Principal,itemId:string){
    const [item]=await this.connection.client`SELECT seller_organisation_id FROM catalog_item WHERE id=${itemId}`;
    if(!item)throw new NotFoundException("Item not found");
    await this.sellers.assertMembership(principal,item.seller_organisation_id);
    return this.connection.client`SELECT v.*,coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'filename',f.original_filename,'state',f.state,'role',f.role,'scan',f.scan_result)) FROM file_object f WHERE f.item_version_id=v.id),'[]') AS files FROM item_version v WHERE item_id=${itemId} ORDER BY version_number DESC`;
  }
  async sellerItem(principal:Principal,itemId:string){
    const sql=this.connection.client;const [item]=await sql`SELECT * FROM catalog_item WHERE id=${itemId}`;
    if(!item)throw new NotFoundException("Item not found");await this.sellers.assertMembership(principal,item.seller_organisation_id);
    const listings=await sql`SELECT l.*,s.key AS channel_key,s.name AS channel_name FROM channel_listing l JOIN storefront s ON s.id=l.storefront_id WHERE l.item_id=${itemId} ORDER BY s.name`;
    const prices=await sql`SELECT o.*,v.name AS license_name FROM offer o JOIN license_variant v ON v.id=o.license_variant_id WHERE v.item_id=${itemId} ORDER BY o.created_at`;
    const sessions=await sql`SELECT s.id,s.item_version_id,s.status,s.expires_at FROM upload_session s JOIN item_version v ON v.id=s.item_version_id WHERE v.item_id=${itemId} ORDER BY s.created_at DESC`;
    return {item,listings,prices,sessions,versions:await this.versions(principal,itemId)};
  }
  async updatePrice(principal:Principal,offerId:string,input:{amountMinor:number;currency:string}){
    const sql=this.connection.client;const [o]=await sql`SELECT o.*,v.item_id,i.seller_organisation_id FROM offer o JOIN license_variant v ON v.id=o.license_variant_id JOIN catalog_item i ON i.id=v.item_id WHERE o.id=${offerId}`;
    if(!o)throw new NotFoundException("Offer not found");await this.sellers.assertMembership(principal,o.seller_organisation_id,["OWNER","MANAGER"]);
    // Existing order lines preserve the old price and currency. New carts are repriced at checkout.
    await sql.begin(async tx=>{await tx`UPDATE offer SET amount_minor=${String(input.amountMinor)},currency=${input.currency},updated_at=now() WHERE id=${offerId}`;
      await enqueue(tx,"SEARCH_ITEM","item",o.item_id,{itemId:o.item_id},`price:${offerId}:${crypto.randomUUID()}`);});return {id:offerId,...input};
  }

}
