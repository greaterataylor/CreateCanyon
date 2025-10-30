//app/api/checkout/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth'
import { getStripe } from '@/lib/stripe'   // ← change

export async function POST(req: NextRequest) {
  const user = await requireUser()
  const form = await req.formData()
  const assetId = form.get('assetId')?.toString()
  if (!assetId) return NextResponse.json({ error: 'Missing assetId' }, { status: 400 })

  const asset = await prisma.asset.findUnique({ where: { id: assetId } })
  if (!asset || asset.status !== 'APPROVED') {
    return NextResponse.json({ error: 'Asset unavailable' }, { status: 400 })
  }

  const stripe = getStripe() // ← instantiate at request-time

  const order = await prisma.order.create({
    data: {
      userId: user.id,
      totalCents: asset.priceCents,
      currency: asset.currency,
      status: 'created',
      items: { create: [{ assetId: asset.id, priceCents: asset.priceCents, quantity: 1 }] }
    }
  })

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: user.email,
    line_items: [{
      price_data: {
        currency: asset.currency.toLowerCase(),
        product_data: { name: asset.title, description: process.env.STRIPE_PRICE_DESCRIPTION || 'Digital Asset' },
        unit_amount: asset.priceCents
      },
      quantity: 1
    }],
    success_url: process.env.STRIPE_SUCCESS_URL || `${process.env.NEXT_PUBLIC_BASE_URL}/`,
    cancel_url: process.env.STRIPE_CANCEL_URL || `${process.env.NEXT_PUBLIC_BASE_URL}/assets/${asset.id}`,
    metadata: { orderId: order.id }
  })

  await prisma.order.update({ where: { id: order.id }, data: { stripeSessionId: session.id } })
  return NextResponse.redirect(session.url!, { status: 303 })
}

// These keep the route purely dynamic & on Node runtime (good for Stripe)
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
