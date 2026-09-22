import type { z } from "zod";
import { sellerCreateSchema } from "@createcanyon/contracts";
export type SellerCreateInput = z.infer<typeof sellerCreateSchema>;
