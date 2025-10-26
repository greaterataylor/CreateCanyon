import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { assetStatusSchema } from '@/lib/validation'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  await requireAdmin()
  const form = await req.formData()
  const status = (form.get('status') || '').toString()
  const parsed = assetStatusSchema.safeParse({ status })
  if (!parsed.success) return NextResponse.redirect(new URL('/admin/assets', process.env.NEXT_PUBLIC_BASE_URL))
  await prisma.asset.update({ where: { id: params.id }, data: { status: parsed.data.status } })
  return NextResponse.redirect(new URL('/admin/assets', process.env.NEXT_PUBLIC_BASE_URL))
}
