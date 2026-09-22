import { createDatabaseConnection } from "./index.js";
import {
  categories,
  ledgerAccounts,
  licenseTemplates,
  storefronts,
  users,
} from "./schema.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const connection = createDatabaseConnection(process.env.DATABASE_URL, { max: 1, applicationName: "createcanyon-seed" });

const storefrontSeed = [
  { key: "createcanyon" as const, name: "CreateCanyon", hostname: "createcanyon.com" },
  { key: "graphicgrounds" as const, name: "GraphicGrounds", hostname: "graphicgrounds.com" },
  { key: "melodymerchant" as const, name: "MelodyMerchant", hostname: "melodymerchant.com" },
  { key: "filefoyer" as const, name: "FileFoyer", hostname: "filefoyer.com" },
  { key: "programplaza" as const, name: "ProgramPlaza", hostname: "programplaza.com" },
];

try {
  await connection.db.insert(storefronts).values(storefrontSeed).onConflictDoNothing();
  const allStorefronts = await connection.db.select().from(storefronts);
  const categoryRows = allStorefronts.flatMap((storefront) => {
    const groups: Record<string, string[]> = {
      createcanyon: ["Graphics", "Audio", "Documents", "Code", "Fonts"],
      graphicgrounds: ["Photos", "Illustrations", "Vectors", "Templates", "Fonts", "3D"],
      melodymerchant: ["Music", "Sound Effects", "Loops and Samples"],
      filefoyer: ["Business Documents", "Presentations", "Spreadsheets", "Printables"],
      programplaza: ["Plugins", "Themes", "Scripts", "Integrations", "Developer Tools"],
    };
    return (groups[storefront.key] ?? []).map((name, index) => ({
      storefrontId: storefront.id,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      name,
      sortOrder: index,
    }));
  });
  if (categoryRows.length) await connection.db.insert(categories).values(categoryRows).onConflictDoNothing();

  await connection.db.insert(licenseTemplates).values([
    {
      kind: "STANDARD_COMMERCIAL",
      name: "Standard Commercial License",
      version: 1,
      summary: "Use in one commercial end product, subject to the network license restrictions.",
      bodyMarkdown: "# Standard Commercial License\n\nThe buyer may use the item in one end product. The source item may not be redistributed as a standalone asset.",
    },
    {
      kind: "EXTENDED_COMMERCIAL",
      name: "Extended Commercial License",
      version: 1,
      summary: "Expanded commercial use for qualifying end products and audiences.",
      bodyMarkdown: "# Extended Commercial License\n\nThe buyer receives the expanded rights stated on the certificate. Standalone redistribution remains prohibited.",
    },
  ]).onConflictDoNothing();

  await connection.db.insert(ledgerAccounts).values([
    { code: "stripe_clearing_usd", name: "Stripe clearing", type: "ASSET", currency: "USD" },
    { code: "platform_commission_usd", name: "Platform commission revenue", type: "REVENUE", currency: "USD" },
    { code: "tax_payable_usd", name: "Tax payable", type: "LIABILITY", currency: "USD" },
    { code: "payment_processing_usd", name: "Payment processing expense", type: "EXPENSE", currency: "USD" },
  ]).onConflictDoNothing();

  await connection.db.insert(users).values({
    id: "11111111-1111-4111-8111-111111111111",
    oidcSubject: "11111111-1111-4111-8111-111111111111",
    email: "seller@example.test",
    displayName: "Local Seller",
  }).onConflictDoNothing();

  console.log("Database seed completed");
} finally {
  await connection.close();
}
