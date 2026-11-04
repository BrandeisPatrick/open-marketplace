import { isDict } from './guards';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** Integer cents → "$1,234.56". */
export function money(cents: number | null | undefined): string {
  return typeof cents === 'number' && Number.isFinite(cents) ? usd.format(cents / 100) : '—';
}

/** "ord_ab12cd34xyz" → "#ab12cd34". */
export function shortId(id: string | null | undefined): string {
  if (!id) return '#—';
  const cut = id.indexOf('_');
  return `#${(cut >= 0 ? id.slice(cut + 1) : id).slice(0, 8)}`;
}

/** plural(3, 'item') → "3 items". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

export function compact(n: number): string {
  return n.toLocaleString('en-US', { notation: n >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 });
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** "just now", "5m ago", "3h ago", "2d ago", else a short date. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const sec = Math.round((now - t) / 1000);
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  const d = new Date(t);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric',
  });
}

/** ISO → "HH:MM:SS" in local time. */
export function clockTime(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date(NaN);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

export function fullDate(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString() : '';
}

/** Best-effort human message from an Error, a tool error result, or anything else. */
export function errorText(x: unknown): string {
  const fallback = 'Something went wrong.';
  if (typeof x === 'string') return x.trim() || fallback;
  if (x instanceof Error) return x.message || fallback;
  if (Array.isArray(x)) {
    // Anthropic-style content blocks: [{ type: 'text', text }]
    const text = x.map((b) => (isDict(b) && typeof b.text === 'string' ? b.text : '')).join(' ').trim();
    return text || fallback;
  }
  if (isDict(x)) {
    for (const key of ['message', 'error', 'content', 'text']) {
      const v = x[key];
      if (typeof v === 'string' && v.trim()) return v;
      if (v !== undefined && typeof v === 'object') return errorText(v);
    }
    try {
      return JSON.stringify(x);
    } catch {
      return fallback;
    }
  }
  return fallback;
}
