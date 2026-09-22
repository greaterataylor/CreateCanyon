export function allocateProportionally(total: bigint, weights: readonly bigint[]): bigint[] {
  if (total < 0n || weights.some(w => w < 0n)) throw new Error("Negative allocation");
  const sum = weights.reduce((a,b) => a+b, 0n);
  if (sum === 0n) { if (total !== 0n) throw new Error("Cannot allocate to zero weights"); return weights.map(() => 0n); }
  const values = weights.map(w => total * w / sum);
  let remainder = total - values.reduce((a,b) => a+b, 0n);
  const rank = weights.map((w,i) => ({ i, remainder: total * w % sum })).sort((a,b) => a.remainder > b.remainder ? -1 : a.remainder < b.remainder ? 1 : a.i-b.i);
  for (const entry of rank) { if (!remainder) break; values[entry.i] = values[entry.i]! + 1n; remainder--; }
  return values;
}
/** Cumulative apportionment: every partial refund adds up exactly to a full reversal. */
export function refundAllocation(parts: { seller: bigint; fee: bigint; tax: bigint }, previouslyRefunded: bigint, refundAmount: bigint) {
  const total = parts.seller + parts.fee + parts.tax;
  if (refundAmount <= 0n || previouslyRefunded < 0n || previouslyRefunded + refundAmount > total) throw new Error("Refund exceeds remaining amount");
  // Hierarchical cumulative floors keep every component monotone, avoiding a
  // negative one-cent commission reversal when two independent floors jump.
  const cumulative = (amount: bigint) => {
    const tax = amount * parts.tax / total;
    const net = amount-tax;
    const seller = parts.seller+parts.fee === 0n ? 0n : net*parts.seller/(parts.seller+parts.fee);
    return { seller, tax, fee: net-seller };
  };
  const before = cumulative(previouslyRefunded), after = cumulative(previouslyRefunded + refundAmount);
  return { seller: after.seller-before.seller, tax: after.tax-before.tax, fee: after.fee-before.fee };
}
export function minorToSafeNumber(value: bigint | string): number {
  const amount = BigInt(value);
  if (amount < 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Money exceeds safe integer range");
  return Number(amount);
}
