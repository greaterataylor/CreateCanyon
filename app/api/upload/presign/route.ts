import { NextRequest, NextResponse } from 'next/server'
import { presignUpload } from '@/lib/s3'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const key = searchParams.get('key')
  const contentType = searchParams.get('contentType') || 'application/octet-stream'
  const isPublic = searchParams.get('public') === '1'
  if (!key) return NextResponse.json({ error: 'missing key' }, { status: 400 })
  const bucket = isPublic ? (process.env.S3_PUBLIC_BUCKET || '') : (process.env.S3_PRIVATE_BUCKET || '')
  const url = await presignUpload(key, bucket, contentType)
  return NextResponse.json({ url })
}
