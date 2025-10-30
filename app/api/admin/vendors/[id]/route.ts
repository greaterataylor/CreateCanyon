//app/api/admin/vendors/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { vendorUpdateSchema } from '@/lib/validation'

type Params = Promise<{ id: string }>

export async function POST(req: NextRequest, { params }: { params: Params }) {
  await requireAdmin()
  const { id } = await params

  const form = await req.formData()
  const status = (form.get('status') || '').toString()
  const parsed = vendorUpdateSchema.safeParse({ status })
  if (!parsed.success) {
    return NextResponse.redirect(new URL('/admin/vendors', process.env.NEXT_PUBLIC_BASE_URL))
  }

  await prisma.vendorProfile.update({ where: { id }, data: { status: parsed.data.status } })
  return NextResponse.redirect(new URL('/admin/vendors', process.env.NEXT_PUBLIC_BASE_URL))
}
