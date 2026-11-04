import { Router, type Request, type Response } from 'express';
import { aiEnabled, config } from '../config.js';
import { events } from '../events.js';
import { DEMO_TOKENS } from '../marketplace/seed.js';
import * as store from '../marketplace/store.js';
import { ORDER_STATUSES, PRODUCT_STATUSES, SORT_KEYS, ToolError, type MarketplaceEvent, type ProductStatus, type SortKey } from '../marketplace/types.js';
import { chatRoutes, SSE_HEADERS } from './chat.js';

/** Heartbeat interval. The web client reopens a stream that stays silent for a few of these (see web/src/api.ts). */
const PING_MS = 15_000;
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

function query(req: Request, name: string): string | undefined {
  const value = req.query[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first.trim() !== '' ? first.trim() : undefined;
}

function intParam(raw: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  return raw !== undefined && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

function oneOf<T extends string>(raw: string | undefined, allowed: readonly T[], name: string): T | undefined {
  if (raw === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(raw)) throw new ToolError(`Invalid ${name} "${raw}". Use one of: ${allowed.join(', ')}.`);
  return raw as T;
}

/** The URL external agents should use: the server's own port on localhost, or this host when deployed. */
function mcpUrl(req: Request): string {
  const host = req.get('host') ?? '';
  if (!host || LOCAL_HOST.test(host)) return `http://localhost:${req.socket.localPort ?? config.port}/mcp`;
  return `${req.protocol}://${host}/mcp`;
}

function sendError(res: Response, err: unknown, notFound = false): void {
  if (err instanceof ToolError) {
    res.status(notFound ? 404 : 400).json({ error: err.message });
    return;
  }
  throw err;
}

export function apiRouter(): Router {
  const r = Router();

  r.get('/health', (req, res) => {
    res.json({
      ok: true,
      ai: { enabled: aiEnabled(), model: config.model, effort: config.effort },
      mcp: { path: '/mcp', url: mcpUrl(req), tokens: { buyer: DEMO_TOKENS.buyer, seller: DEMO_TOKENS.seller } },
      actors: store.demoActors(),
    });
  });

  r.get('/products', (req, res) => {
    try {
      const result = store.searchProducts({
        query: query(req, 'q'),
        category: query(req, 'category'),
        sort: oneOf<SortKey>(query(req, 'sort'), SORT_KEYS, 'sort'),
        limit: intParam(query(req, 'limit'), 1, 100, 50),
      });
      res.json({ products: result.products, total: result.total });
    } catch (err) {
      sendError(res, err);
    }
  });

  r.get('/products/:id', (req, res) => {
    try {
      res.json({ product: store.getProduct(req.params.id) });
    } catch (err) {
      sendError(res, err, true);
    }
  });

  r.get('/categories', (_req, res) => {
    res.json({ categories: store.listCategories() });
  });

  r.get('/buyer/cart', (_req, res) => {
    res.json({ cart: store.getCart(store.demoActor('buyer').id) });
  });

  r.get('/buyer/orders', (req, res) => {
    try {
      res.json({ orders: store.listBuyerOrders(store.demoActor('buyer').id, oneOf(query(req, 'status'), ORDER_STATUSES, 'status')) });
    } catch (err) {
      sendError(res, err);
    }
  });

  r.get('/seller/listings', (req, res) => {
    try {
      const status = oneOf<ProductStatus>(query(req, 'status'), PRODUCT_STATUSES, 'status');
      res.json({ products: store.listSellerListings(store.demoActor('seller').id, status) });
    } catch (err) {
      sendError(res, err);
    }
  });

  r.get('/seller/orders', (req, res) => {
    try {
      res.json({ orders: store.listSellerOrders(store.demoActor('seller').id, oneOf(query(req, 'status'), ORDER_STATUSES, 'status')) });
    } catch (err) {
      sendError(res, err);
    }
  });

  r.get('/seller/stats', (_req, res) => {
    res.json({ stats: store.sellerStats(store.demoActor('seller').id) });
  });

  // Live domain events: `event: <type>` + `data: <json>`, plus a `ping` event every PING_MS as a liveness signal.
  r.get('/events', (req, res) => {
    res.writeHead(200, SSE_HEADERS);
    res.flushHeaders();
    res.write(': connected\n\n');
    const send = (event: MarketplaceEvent) => {
      if (!res.writableEnded) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const unsubscribe = events.subscribe(send);
    const ping = setInterval(() => {
      if (!res.writableEnded) res.write('event: ping\ndata: {}\n\n');
    }, PING_MS);
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      unsubscribe();
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
  });

  r.use(chatRoutes());

  r.use((req, res) => {
    res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
  });

  return r;
}
