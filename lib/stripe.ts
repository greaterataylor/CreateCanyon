// lib/stripe.ts
import Stripe from 'stripe';

let stripeSingleton: Stripe | null = null;

export function getStripe(): Stripe {
  if (stripeSingleton) return stripeSingleton;

  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    throw new Error('Missing STRIPE_SECRET_KEY. Set it in your environment.');
  }

  // Pass the API key as a string (correct for v19)
  stripeSingleton = new Stripe(apiKey); // or: new Stripe(apiKey, { /* optional config */ })
  return stripeSingleton;
}
