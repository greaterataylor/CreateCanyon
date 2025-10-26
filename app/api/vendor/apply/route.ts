import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST() {
  const user = await requireUser()
  if (user.vendorProfile) return NextResponse.redirect(new URL('/dashboard', process.env.NEXT_PUBLIC_BASE_URL))
  const profile = await prisma.vendorProfile.create({
    data: {
      userId: user.id,
      displayName: user.name || user.email.split('@')[0],
      status: 'PENDING'
    }
  })
  return NextResponse.redirect(new URL('/dashboard', process.env.NEXT_PUBLIC_BASE_URL))
}
