import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** server/src -> repo root */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SERVER_VERSION = '0.1.0';
export const WEB_DEV_ORIGIN = 'http://localhost:5173';

function flag(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? '');
}

function parseEffort(value: string | undefined): Effort {
  const v = value?.trim().toLowerCase();
  if (!v) return 'medium';
  if ((EFFORTS as readonly string[]).includes(v)) return v as Effort;
  console.warn(`[config] Ignoring MARKETPLACE_EFFORT="${value}" (expected one of ${EFFORTS.join(', ')}); using "medium".`);
  return 'medium';
}

function parsePort(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n < 65536 && value?.trim() ? n : 3001;
}

/** `:memory:` passes through; relative paths resolve against the repo root (where `.env` lives). */
function resolveDbPath(value: string | undefined): string {
  const v = value?.trim();
  if (!v) return path.join(REPO_ROOT, 'data', 'marketplace.db');
  if (v === ':memory:') return v;
  return path.isAbsolute(v) ? v : path.resolve(REPO_ROOT, v);
}

const webDist = path.join(REPO_ROOT, 'web', 'dist');

export const config = {
  port: parsePort(process.env.PORT),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
  model: process.env.MARKETPLACE_MODEL?.trim() || 'claude-opus-5-5',
  effort: parseEffort(process.env.MARKETPLACE_EFFORT),
  /** Server-side refusal fallbacks (beta). Off unless MARKETPLACE_FALLBACKS is 1/true/yes/on. */
  fallbacks: flag(process.env.MARKETPLACE_FALLBACKS),
  dbPath: resolveDbPath(process.env.MARKETPLACE_DB),
  webOrigin: WEB_DEV_ORIGIN,
  webDist,
  /** `npm start` (or NODE_ENV=production) serves the built UI from web/dist when it exists. */
  serveWeb:
    (process.env.NODE_ENV === 'production' || process.env.npm_lifecycle_event === 'start') &&
    fs.existsSync(path.join(webDist, 'index.html')),
};

export function aiEnabled(): boolean {
  return Boolean(config.anthropicApiKey);
}
