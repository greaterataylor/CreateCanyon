// lib/stripe.ts
import Stripe from 'stripe';

let stripeSingleton: Stripe | null = null;

/**
 * Lazily create (and memoize) a Stripe client.
 * This avoids crashing the build when STRIPE_SECRET_KEY isn't present at build time.
 */
export function getStripe(): Stripe {
  if (stripeSingleton) return stripeSingleton;

  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    // Throw when actually used (request-time), not at module import.
    throw new Error('Missing STRIPE_SECRET_KEY. Set it in your environment (.env/.env.local or hosting env).');
  }

  // Stripe v19+ prefers the options-object form
  stripeSingleton = new Stripe({ apiKey });
  return stripeSingleton;
}
