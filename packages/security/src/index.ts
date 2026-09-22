import type { AssetType, StorefrontKey } from "@createcanyon/contracts";

export interface StorefrontIdentity {
  readonly key: StorefrontKey;
  readonly name: string;
  readonly hostname: string;
  readonly description: string;
  readonly eligibleAssetTypes: readonly AssetType[] | "ALL";
  readonly accent: string;
}

export const storefrontIdentities: Readonly<Record<StorefrontKey, StorefrontIdentity>> = {
  createcanyon: {
    key: "createcanyon",
    name: "CreateCanyon",
    hostname: "createcanyon.com",
    description: "The complete marketplace for creative assets, documents, audio, code, and fonts.",
    eligibleAssetTypes: "ALL",
    accent: "#6d28d9",
  },
  graphicgrounds: {
    key: "graphicgrounds",
    name: "GraphicGrounds",
    hostname: "graphicgrounds.com",
    description: "Photos, graphics, vectors, design templates, fonts, and visual assets.",
    eligibleAssetTypes: ["PHOTO", "ILLUSTRATION", "VECTOR", "DESIGN_TEMPLATE", "FONT", "THREE_D"],
    accent: "#0f766e",
  },
  melodymerchant: {
    key: "melodymerchant",
    name: "MelodyMerchant",
    hostname: "melodymerchant.com",
    description: "Music, sound effects, loops, samples, stems, and audio packs.",
    eligibleAssetTypes: ["MUSIC", "SOUND_EFFECT", "AUDIO_LOOP"],
    accent: "#be123c",
  },
  filefoyer: {
    key: "filefoyer",
    name: "FileFoyer",
    hostname: "filefoyer.com",
    description: "Business documents, presentations, spreadsheets, templates, and printables.",
    eligibleAssetTypes: ["DOCUMENT_TEMPLATE", "PRESENTATION_TEMPLATE", "SPREADSHEET_TEMPLATE", "PRINTABLE"],
    accent: "#1d4ed8",
  },
  programplaza: {
    key: "programplaza",
    name: "ProgramPlaza",
    hostname: "programplaza.com",
    description: "Code, plugins, themes, integrations, and developer tools.",
    eligibleAssetTypes: ["CODE", "PLUGIN", "THEME", "INTEGRATION", "DEVELOPER_TOOL"],
    accent: "#b45309",
  },
};

export const allStorefronts = Object.values(storefrontIdentities);

export class HostResolutionError extends Error {
  public constructor(public readonly hostname: string) {
    super(`Unrecognized storefront host: ${hostname}`);
    this.name = "HostResolutionError";
  }
}

export function normalizeHostname(value: string): string {
  const first = value.split(",")[0]?.trim().toLowerCase() ?? "";
  const withoutPort = first.startsWith("[") ? first : first.replace(/:\d+$/, "");
  return withoutPort.replace(/\.$/, "");
}

export function resolveStorefrontFromHost(hostHeader: string, allowlist: readonly string[]): StorefrontIdentity {
  const hostname = normalizeHostname(hostHeader);
  const normalizedAllowlist = new Set(allowlist.map(normalizeHostname));
  if (!hostname || !normalizedAllowlist.has(hostname)) throw new HostResolutionError(hostname);
  const base = hostname.replace(/\.localhost$/, ".com");
  const storefront = allStorefronts.find((candidate) => candidate.hostname === base);
  if (!storefront) throw new HostResolutionError(hostname);
  return storefront;
}

export function safeSameOriginPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  try {
    const parsed = new URL(value, "https://createcanyon.invalid");
    if (parsed.origin !== "https://createcanyon.invalid") return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

export function securityHeaders(nonce?: string): Record<string, string> {
  const scriptSource = nonce ? `'nonce-${nonce}'` : "'self'";
  return {
    "content-security-policy": [
      "default-src 'self'",
      `script-src 'self' ${scriptSource} 'strict-dynamic'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(self)",
    "cross-origin-opener-policy": "same-origin",
  };
}
