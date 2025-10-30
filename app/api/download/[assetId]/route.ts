//app/api/download/[assetId]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { presignDownload } from '@/lib/s3'

export async function POST(req: NextRequest, { params }: { params: { assetId: string } }) {
  const user = await requireUser()
  const purchase = await prisma.purchase.findFirst({ where: { userId: user.id, assetId: params.assetId } , include: { asset: true } })
  if (!purchase) return NextResponse.json({ error: 'Not purchased' }, { status: 403 })
  const key = purchase.asset.downloadKey
  const url = await presignDownload(key, process.env.S3_PRIVATE_BUCKET || '')
  return NextResponse.redirect(url, { status: 302 })
}
