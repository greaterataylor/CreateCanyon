import type { AssetType, ItemStatus, StorefrontKey } from "@createcanyon/contracts";

export class DomainError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

const specialistEligibility: Readonly<Record<Exclude<StorefrontKey, "createcanyon">, ReadonlySet<AssetType>>> = {
  graphicgrounds: new Set(["PHOTO", "ILLUSTRATION", "VECTOR", "DESIGN_TEMPLATE", "FONT", "THREE_D"]),
  melodymerchant: new Set(["MUSIC", "SOUND_EFFECT", "AUDIO_LOOP"]),
  filefoyer: new Set(["DOCUMENT_TEMPLATE", "PRESENTATION_TEMPLATE", "SPREADSHEET_TEMPLATE", "PRINTABLE"]),
  programplaza: new Set(["CODE", "PLUGIN", "THEME", "INTEGRATION", "DEVELOPER_TOOL"]),
};

export function eligibleChannels(assetType: AssetType): readonly StorefrontKey[] {
  const channels: StorefrontKey[] = ["createcanyon"];
  for (const [channel, assets] of Object.entries(specialistEligibility) as Array<[
    Exclude<StorefrontKey, "createcanyon">,
    ReadonlySet<AssetType>,
  ]>) {
    if (assets.has(assetType)) channels.push(channel);
  }
  return channels;
}

export function validateChannelSelection(assetType: AssetType, channels: readonly StorefrontKey[]): void {
  if (channels.length === 0) throw new DomainError("CHANNEL_REQUIRED", "At least one storefront must be selected");
  const allowed = new Set(eligibleChannels(assetType));
  for (const channel of channels) {
    if (!allowed.has(channel)) {
      throw new DomainError("CHANNEL_NOT_ELIGIBLE", `${assetType} cannot be listed on ${channel}`);
    }
  }
  if (new Set(channels).size !== channels.length) {
    throw new DomainError("DUPLICATE_CHANNEL", "A storefront may only be selected once");
  }
}

const itemTransitions: Readonly<Record<ItemStatus, readonly ItemStatus[]>> = {
  DRAFT: ["UPLOADED", "RETIRED"],
  UPLOADED: ["SCANNING", "CHANGES_REQUESTED", "RETIRED"],
  SCANNING: ["PROCESSING", "CHANGES_REQUESTED", "SUSPENDED"],
  PROCESSING: ["AWAITING_REVIEW", "CHANGES_REQUESTED", "SUSPENDED"],
  AWAITING_REVIEW: ["APPROVED", "CHANGES_REQUESTED", "SUSPENDED"],
  CHANGES_REQUESTED: ["DRAFT", "UPLOADED", "RETIRED"],
  APPROVED: ["PUBLISHED", "SUSPENDED", "RETIRED"],
  PUBLISHED: ["SUSPENDED", "RETIRED", "UPLOADED"],
  SUSPENDED: ["AWAITING_REVIEW", "PUBLISHED", "RETIRED"],
  RETIRED: [],
};

export function assertItemTransition(from: ItemStatus, to: ItemStatus): void {
  if (!itemTransitions[from].includes(to)) {
    throw new DomainError("INVALID_ITEM_TRANSITION", `Item cannot transition from ${from} to ${to}`);
  }
}

export interface JournalLineInput {
  readonly accountId: string;
  readonly debitMinor: bigint;
  readonly creditMinor: bigint;
  readonly currency: string;
}

export function assertBalancedJournal(lines: readonly JournalLineInput[]): void {
  if (lines.length < 2) throw new DomainError("JOURNAL_TOO_SHORT", "A journal requires at least two lines");
  const currencies = new Set(lines.map((line) => line.currency));
  if (currencies.size !== 1) throw new DomainError("JOURNAL_CURRENCY_MISMATCH", "Journal lines must use one currency");
  let debits = 0n;
  let credits = 0n;
  for (const line of lines) {
    if (line.debitMinor < 0n || line.creditMinor < 0n) {
      throw new DomainError("NEGATIVE_JOURNAL_AMOUNT", "Journal amounts cannot be negative");
    }
    if ((line.debitMinor === 0n) === (line.creditMinor === 0n)) {
      throw new DomainError("INVALID_JOURNAL_LINE", "Each line must have exactly one non-zero side");
    }
    debits += line.debitMinor;
    credits += line.creditMinor;
  }
  if (debits !== credits) throw new DomainError("UNBALANCED_JOURNAL", `Debits ${debits} do not equal credits ${credits}`);
}

export function calculateBasisPoints(amountMinor: bigint, basisPoints: number): bigint {
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    throw new DomainError("INVALID_BASIS_POINTS", "Basis points must be an integer between 0 and 10000");
  }
  return (amountMinor * BigInt(basisPoints) + 5_000n) / 10_000n;
}

export function normalizeSlug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "item"
  );
}
