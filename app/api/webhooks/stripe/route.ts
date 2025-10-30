//app/api/webhooks/stripe/route.ts
 import { NextRequest, NextResponse } from 'next/server'
 import { stripe } from '@/lib/stripe'
 import { prisma } from '@/lib/prisma'
 import { randomUUID } from 'crypto'

 export async function POST(req: NextRequest) {
   const sig = req.headers.get('stripe-signature') || ''
   const raw = await req.text()
   let event
   try {
     event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET || '')
   } catch (err:any) {
     return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 })
   }

   if (event.type === 'checkout.session.completed') {
     const session = event.data.object as any
     const orderId = session.metadata?.orderId as string | undefined
     if (orderId) {
       const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true, user: true } })
       if (order && order.status !== 'paid') {
         await prisma.order.update({ where: { id: order.id }, data: { status: 'paid' } })
         for (const item of order.items) {
           const exists = await prisma.purchase.findFirst({ where: { userId: order.userId, assetId: item.assetId } })
           if (!exists) {
             await prisma.purchase.create({
               data: {
                 userId: order.userId,
                 assetId: item.assetId,
                 orderId: order.id,
                 licenseKey: randomUUID()
               }
             })
           }
         }
       }
     }
   }

   return NextResponse.json({ received: true })
 }

// App Router replacements for old `config`:
// Ensure Node runtime (Stripe's SDK relies on Node APIs) and no caching.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
