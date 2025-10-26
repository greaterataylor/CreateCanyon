import { z } from 'zod'

export const signUpSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8)
})

export const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
})

export const categorySchema = z.object({
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/)
})

export const assetCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  priceCents: z.coerce.number().int().min(50),
  currency: z.string().default('USD'),
  categoryId: z.string(),
  previewType: z.enum(['IMAGE','AUDIO','VIDEO','CODE','FILE']),
  previewKey: z.string().optional(),
  downloadKey: z.string().min(1)
})

export const vendorUpdateSchema = z.object({
  status: z.enum(['PENDING','APPROVED','REJECTED'])
})

export const assetStatusSchema = z.object({
  status: z.enum(['PENDING','APPROVED','REJECTED'])
})
