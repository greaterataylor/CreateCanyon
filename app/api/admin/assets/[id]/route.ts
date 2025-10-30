//app/api/admin/assets/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { assetStatusSchema } from '@/lib/validation'

type Params = Promise<{ id: string }>

export async function POST(req: NextRequest, { params }: { params: Params }) {
  await requireAdmin()
  const { id } = await params

  const form = await req.formData()
  const status = (form.get('status') || '').toString()
  const parsed = assetStatusSchema.safeParse({ status })
  if (!parsed.success) {
    return NextResponse.redirect(new URL('/admin/assets', process.env.NEXT_PUBLIC_BASE_URL))
  }

  await prisma.asset.update({ where: { id }, data: { status: parsed.data.status } })
  return NextResponse.redirect(new URL('/admin/assets', process.env.NEXT_PUBLIC_BASE_URL))
}
