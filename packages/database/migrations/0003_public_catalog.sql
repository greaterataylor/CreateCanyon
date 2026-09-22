-- The public source of truth is a channel listing, never a duplicated canonical item.
CREATE VIEW public_listing AS
SELECT l.id AS listing_id,l.slug,l.title,l.description,l.tags,l.storefront_id,s.key AS storefront_key,s.hostname,
  l.category_id,c.slug AS category_slug,c.name AS category_name,l.is_primary,
  i.id AS item_id,i.asset_type,i.metadata AS item_metadata,i.ai_disclosure,i.current_version_id AS version_id,
  i.primary_storefront_id,v.version_label,v.changelog,i.seller_organisation_id AS seller_id,
  seller.display_name AS seller_display_name,seller.slug AS seller_slug,
  price.amount_minor,price.currency,price.license_variant_id,
  coalesce(r.rating,0)::float AS rating,coalesce(r.review_count,0)::int AS review_count,
  coalesce(sales.sales,0)::int AS sales,l.published_at,
  (SELECT 'https://'||ps.hostname||'/items/'||pl.slug FROM channel_listing pl JOIN storefront ps ON ps.id=pl.storefront_id
    WHERE pl.item_id=i.id AND pl.is_primary LIMIT 1) AS canonical_url,
  to_tsvector('english',coalesce(l.title,'')||' '||coalesce(l.description,'')||' '||array_to_string(l.tags,' ')) AS search_vector,
  (SELECT f.object_key FROM file_object f WHERE f.item_version_id=v.id AND f.role='PREVIEW' AND f.state='READY' AND f.detected_mime_type LIKE 'image/%' ORDER BY f.created_at,f.id LIMIT 1) AS preview_object_key
FROM channel_listing l
JOIN storefront s ON s.id=l.storefront_id AND s.enabled
JOIN catalog_item i ON i.id=l.item_id AND i.status='PUBLISHED'
JOIN item_version v ON v.id=i.current_version_id AND v.status='PUBLISHED'
JOIN seller_organisation seller ON seller.id=i.seller_organisation_id AND seller.status='ACTIVE'
JOIN channel_eligibility eligibility ON eligibility.storefront_id=s.id AND eligibility.asset_type=i.asset_type AND eligibility.enabled
LEFT JOIN category c ON c.id=l.category_id
JOIN LATERAL (
  SELECT o.amount_minor,o.currency,lv.id AS license_variant_id FROM license_variant lv
  JOIN license_template lt ON lt.id=lv.license_template_id AND lt.active
  JOIN LATERAL (
    SELECT o.* FROM offer o WHERE o.license_variant_id=lv.id AND o.active
    AND (o.storefront_id=l.storefront_id OR o.storefront_id IS NULL)
    AND (o.starts_at IS NULL OR o.starts_at<=now()) AND (o.ends_at IS NULL OR o.ends_at>now())
    ORDER BY (o.storefront_id IS NOT NULL) DESC LIMIT 1
  ) o ON true
  WHERE lv.item_id=i.id AND lv.enabled ORDER BY o.amount_minor,lv.id LIMIT 1
) price ON true
LEFT JOIN LATERAL (SELECT avg(r.rating) AS rating,count(*) AS review_count FROM review r WHERE r.item_id=i.id AND r.status='PUBLISHED') r ON true
LEFT JOIN LATERAL (SELECT count(*) AS sales FROM order_line ol JOIN customer_order ord ON ord.id=ol.order_id
  WHERE ol.canonical_item_id=i.id AND ord.status IN ('PAID','PARTIALLY_REFUNDED')) sales ON true
WHERE l.status='PUBLISHED' AND l.enabled;
CREATE INDEX channel_listing_text_search ON channel_listing USING gin(to_tsvector('english',title||' '||description));
CREATE INDEX outbox_claim_idx ON outbox_event(event_type,available_at) WHERE processed_at IS NULL AND failed_at IS NULL;
