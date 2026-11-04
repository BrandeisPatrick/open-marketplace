import { createHash, randomInt } from 'node:crypto';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/** 4999 -> "$49.99" */
export function formatCents(cents: number): string {
  return usd.format(cents / 100);
}

/** Tool inputs are dollars; storage is integer cents. */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** `prod_k3x9a0qz`-style id with a random 8-char base36 suffix. */
export function newId(prefix: string): string {
  let suffix = '';
  for (let i = 0; i < 8; i++) suffix += BASE36[randomInt(36)];
  return `${prefix}_${suffix}`;
}

/** Deterministic id (same shape as newId) so seeded data has stable ids across fresh databases. */
export function stableId(prefix: string, key: string): string {
  const n = BigInt('0x' + createHash('sha256').update(key).digest('hex').slice(0, 16));
  return `${prefix}_${n.toString(36).padStart(8, '0').slice(-8)}`;
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function daysAgoIso(days: number, hours = 0): string {
  return new Date(Date.now() - (days * 24 + hours) * 3_600_000).toISOString();
}
