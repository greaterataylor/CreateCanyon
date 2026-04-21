import { currencyAmount } from './utils'

export function orderDisplayNumber(order: { id: string; createdAt?: Date | string | null }) {
  const date = order.createdAt ? new Date(order.createdAt) : null
  const ymd = date && !Number.isNaN(date.getTime())
    ? `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
    : '00000000'
  return `ORD-${ymd}-${String(order.id || '').slice(-6).toUpperCase()}`
}

export function receiptDisplayNumber(order: { id: string; createdAt?: Date | string | null }) {
  return `RCT-${orderDisplayNumber(order).replace(/^ORD-/, '')}`
}

export function allocateAmountAcrossLineItems(totalCents: number, lineTotals: number[]) {
  if (!lineTotals.length) return []
  const safeTotal = Math.max(Math.round(totalCents || 0), 0)
  const base = lineTotals.map((value) => Math.max(Math.round(value || 0), 0))
  const denominator = base.reduce((sum, value) => sum + value, 0)
  if (!denominator) {
    const even = Math.floor(safeTotal / lineTotals.length)
    const remainder = safeTotal - even * lineTotals.length
    return lineTotals.map((_, index) => even + (index < remainder ? 1 : 0))
  }
  const preliminary = base.map((value) => Math.floor((safeTotal * value) / denominator))
  let remainder = safeTotal - preliminary.reduce((sum, value) => sum + value, 0)
  let index = 0
  while (remainder > 0) {
    preliminary[index % preliminary.length] += 1
    remainder -= 1
    index += 1
  }
  return preliminary
}

export function moneyWithCurrency(cents: number, currency = 'USD') {
  return `${currency.toUpperCase()} ${currencyAmount(cents)}`
}
