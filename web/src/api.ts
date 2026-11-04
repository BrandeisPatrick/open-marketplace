import type {
  Cart,
  Category,
  ChatEvent,
  ConversationResponse,
  Health,
  MarketplaceEvent,
  MarketplaceEventType,
  Order,
  ProductDetail,
  ProductsResponse,
  Role,
  SellerStats,
} from './types';

// ── REST (CONTRACT §6) ───────────────────────────────────────────────────────

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const UNREACHABLE = 'Can’t reach the marketplace server. Is it running on port 3001?';

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

async function failureMessage(res: Response): Promise<string> {
  if (res.status === 502 || res.status === 503 || res.status === 504) return UNREACHABLE;
  try {
    const text = await res.text();
    try {
      const body = JSON.parse(text) as { error?: unknown; message?: unknown };
      const msg = body.error ?? body.message;
      if (typeof msg === 'string' && msg) return msg;
      if (msg && typeof msg === 'object' && 'message' in msg && typeof msg.message === 'string') return msg.message;
    } catch {
      /* not JSON */
    }
    // The Vite proxy answers 500 with an empty body when the server is down.
    if (res.status === 500 && !text.trim()) return UNREACHABLE;
    if (text.trim() && text.length < 240 && !text.trimStart().startsWith('<')) return text.trim();
  } catch {
    /* body unreadable */
  }
  return `Request failed (${res.status}${res.statusText ? ` ${res.statusText}` : ''})`;
}

/** fetch + JSON with readable errors. Aborts propagate as AbortError. */
export async function getJSON<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { accept: 'application/json', ...(init.headers as Record<string, string>) } });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new ApiError(UNREACHABLE, 0);
  }
  if (!res.ok) throw new ApiError(await failureMessage(res), res.status);
  return (await res.json()) as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const getHealth = () => getJSON<Health>('/api/health');

export const getProducts = (params: { q?: string; category?: string; limit?: number } = {}) =>
  getJSON<ProductsResponse>(`/api/products${query(params)}`);

export const getProduct = (id: string) => getJSON<{ product: ProductDetail }>(`/api/products/${encodeURIComponent(id)}`);

export const getCategories = () => getJSON<{ categories: Category[] }>('/api/categories');

export const getBuyerCart = () => getJSON<{ cart: Cart }>('/api/buyer/cart');

export const getBuyerOrders = () => getJSON<{ orders: Order[] }>('/api/buyer/orders');

export const getSellerListings = () => getJSON<{ products: ProductDetail[] }>('/api/seller/listings');

export const getSellerOrders = () => getJSON<{ orders: Order[] }>('/api/seller/orders');

export const getSellerStats = () => getJSON<{ stats: SellerStats }>('/api/seller/stats');

export const getConversation = (role: Role, signal?: AbortSignal) =>
  getJSON<ConversationResponse>(`/api/conversations/${role}`, { signal });

export const deleteConversation = (role: Role) =>
  getJSON<{ ok: true }>(`/api/conversations/${role}`, { method: 'DELETE' });

// ── Chat stream (CONTRACT §7) ────────────────────────────────────────────────

/** Parses one SSE block ("data: {...}" lines) into a ChatEvent, or null for comments/garbage. */
function parseBlock(block: string): ChatEvent | null {
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('data:')) data.push(line.slice(line.startsWith('data: ') ? 6 : 5));
  }
  if (!data.length) return null;
  try {
    const evt = JSON.parse(data.join('\n')) as ChatEvent;
    return evt && typeof evt === 'object' && typeof evt.type === 'string' ? evt : null;
  } catch {
    return null;
  }
}

/**
 * POSTs a message and feeds each streamed ChatEvent to `onEvent` until the body ends.
 * Resolves when the stream closes; rejects on network/HTTP failure or abort.
 */
export async function streamChat(
  role: Role,
  message: string,
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ role, message }),
      signal,
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new ApiError(UNREACHABLE, 0);
  }
  if (!res.ok) throw new ApiError(await failureMessage(res), res.status);
  if (!res.body) throw new ApiError('The server sent an empty response.', res.status);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      // Normalise CRLF/CR line endings; a trailing CR waits for the next chunk (it may be half of CRLF).
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n|\r(?!$)/g, '\n');
      let cut: number;
      while ((cut = buffer.indexOf('\n\n')) !== -1) {
        const evt = parseBlock(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 2);
        if (evt) onEvent(evt);
      }
    }
    buffer += decoder.decode();
    const tail = parseBlock(buffer.replace(/\r\n?/g, '\n').trim());
    if (tail) onEvent(tail);
  } finally {
    reader.releaseLock();
  }
}

// ── Live events (CONTRACT §5) ────────────────────────────────────────────────

export const MARKETPLACE_EVENT_TYPES: readonly MarketplaceEventType[] = [
  'product.created',
  'product.updated',
  'cart.updated',
  'order.created',
  'order.updated',
  'agent.tool_call',
];

/** The server sends `event: ping` every 15s; a stream silent for longer than this is reopened. */
const STALE_MS = 40_000;
const WATCHDOG_MS = 5_000;

/**
 * Subscribes to `/api/events`. Reconnects with backoff if the browser gives up (e.g. the server was down when we
 * connected), and reopens a stream that has gone silent: a dev proxy can keep the browser's connection open after
 * the API server behind it restarted, so the browser never sees an error and would otherwise wait forever. The
 * server's `ping` events make silence measurable. Returns an unsubscribe function.
 */
export function subscribeEvents(
  onEvent: (event: MarketplaceEvent) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  let source: EventSource | null = null;
  let retry: number | undefined;
  let attempt = 0;
  let stopped = false;
  let lastSeen = Date.now();

  const handle = (msg: MessageEvent<string>) => {
    lastSeen = Date.now();
    try {
      const evt = JSON.parse(msg.data) as MarketplaceEvent;
      if (evt && typeof evt.type === 'string') onEvent(evt);
    } catch {
      /* ignore malformed payloads */
    }
  };
  const heartbeat = () => {
    lastSeen = Date.now();
  };

  const closeSource = (es: EventSource) => {
    for (const type of MARKETPLACE_EVENT_TYPES) es.removeEventListener(type, handle);
    es.removeEventListener('ping', heartbeat);
    es.close();
    if (source === es) source = null;
  };

  const connect = () => {
    const es = new EventSource('/api/events');
    source = es;
    lastSeen = Date.now();
    for (const type of MARKETPLACE_EVENT_TYPES) es.addEventListener(type, handle);
    es.addEventListener('ping', heartbeat);
    es.onmessage = handle; // events sent without an `event:` field
    es.onopen = () => {
      attempt = 0;
      lastSeen = Date.now();
      onStatus?.(true);
    };
    es.onerror = () => {
      onStatus?.(false);
      if (es.readyState === EventSource.CLOSED && !stopped) {
        closeSource(es);
        retry = window.setTimeout(connect, Math.min(30_000, 1_000 * 2 ** attempt++));
      }
    };
  };

  const watchdog = window.setInterval(() => {
    if (stopped || !source || source.readyState !== EventSource.OPEN || Date.now() - lastSeen < STALE_MS) return;
    closeSource(source);
    onStatus?.(false);
    connect();
  }, WATCHDOG_MS);

  connect();
  return () => {
    stopped = true;
    window.clearTimeout(retry);
    window.clearInterval(watchdog);
    if (source) closeSource(source);
  };
}
