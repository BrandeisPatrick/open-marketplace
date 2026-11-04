import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { events } from '../src/events.js';
import { executeTool } from '../src/marketplace/tools.js';
import type { ChatEvent, MarketplaceEvent } from '../src/marketplace/types.js';
import { buyer, freshDb, P, parseDataFrames, startApp } from './helpers.js';

let app: Awaited<ReturnType<typeof startApp>>;
const get = async (path: string) => {
  const res = await fetch(`${app.url}${path}`);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};

describe('REST API', () => {
  beforeAll(async () => {
    freshDb();
    app = await startApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health', async () => {
    const { status, body } = await get('/api/health');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      ai: { enabled: false, model: 'claude-opus-5-5', effort: 'medium' },
      mcp: { path: '/mcp', tokens: { buyer: 'mk_buyer_demo', seller: 'mk_seller_demo' } },
      actors: { buyer: { id: 'usr_ada', name: 'Ada', role: 'buyer' }, seller: { id: 'usr_northwind', name: 'Northwind Goods', role: 'seller' } },
    });
    expect(body.mcp.url).toMatch(/^http:\/\/localhost:\d+\/mcp$/);
  });

  it('catalog endpoints', async () => {
    const all = await get('/api/products');
    expect(all.body.total).toBe(33);
    expect(all.body.products).toHaveLength(33);
    const kb = await get('/api/products?q=keyboard&limit=2');
    expect(kb.body.products).toHaveLength(2);
    expect(kb.body.total).toBe(3);
    expect((await get('/api/products?category=books')).body.total).toBe(3);
    expect((await get('/api/products?category=nope')).status).toBe(400);
    const detail = await get(`/api/products/${P.tklKeyboard}`);
    expect(detail.body.product).toMatchObject({ id: P.tklKeyboard, tags: expect.any(Array), description: expect.any(String) });
    expect((await get('/api/products/prod_missing0')).status).toBe(404);
    expect((await get('/api/categories')).body.categories).toHaveLength(8);
    expect((await get('/api/nope')).status).toBe(404);
  });

  it('buyer and seller endpoints', async () => {
    expect((await get('/api/buyer/cart')).body.cart).toMatchObject({ buyer_id: 'usr_ada', items: [] });
    expect((await get('/api/buyer/orders')).body.orders).toHaveLength(4);
    expect((await get('/api/seller/listings')).body.products).toHaveLength(24);
    const orders = (await get('/api/seller/orders')).body.orders as { seller_id: string }[];
    expect(orders.every((o) => o.seller_id === 'usr_northwind')).toBe(true);
    expect((await get('/api/seller/stats')).body.stats).toMatchObject({ orders_total: 3, active_listings: 24 });
  });

  it('POST /api/chat streams ChatEvents and ends after done', async () => {
    const res = await fetch(`${app.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'buyer', message: 'find a mechanical keyboard' }),
    });
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const frames = parseDataFrames(await res.text()) as ChatEvent[];
    expect(frames.map((f) => f.type)).toEqual(['text_delta', 'text_delta', 'tool_call', 'tool_result', 'text_delta', 'done']);

    const bad = await fetch(`${app.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin', message: '' }),
    });
    expect(bad.status).toBe(400);
  });

  it('replays and clears conversations', async () => {
    const conv = await get('/api/conversations/buyer');
    expect(conv.body).toMatchObject({ id: expect.stringMatching(/^conv_/), role: 'buyer', actor: { id: 'usr_ada' } });
    expect(conv.body.items.map((i: { kind: string }) => i.kind)).toEqual(['user', 'assistant_text', 'tool_call', 'tool_result', 'assistant_text']);
    const del = await fetch(`${app.url}/api/conversations/buyer`, { method: 'DELETE' });
    expect(await del.json()).toEqual({ ok: true });
    const fresh = await get('/api/conversations/buyer');
    expect(fresh.body.items).toEqual([]);
    expect(fresh.body.id).not.toBe(conv.body.id);
    expect((await get('/api/conversations/admin')).status).toBe(400);
  });

  it('GET /api/events streams typed domain events and cleans up on disconnect', async () => {
    const controller = new AbortController();
    const res = await fetch(`${app.url}/api/events`, { signal: controller.signal });
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    await vi.waitFor(() => expect(events.listenerCount()).toBe(1));

    executeTool(buyer(), 'add_to_cart', { product_id: P.candle }, 'chat');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!buffer.includes('event: agent.tool_call')) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    controller.abort();

    const frames = buffer.split('\n\n').filter((f) => f.startsWith('event: '));
    const parsed = frames.map((f) => {
      const [eventLine, dataLine] = f.split('\n');
      return { name: eventLine!.slice(7), data: JSON.parse(dataLine!.slice(6)) as MarketplaceEvent };
    });
    expect(parsed.map((p) => p.name)).toEqual(['cart.updated', 'agent.tool_call']);
    expect(parsed.every((p) => p.name === p.data.type && p.data.id && p.data.at && p.data.source === 'chat')).toBe(true);
    await vi.waitFor(() => expect(events.listenerCount()).toBe(0));
  });

  it('allows the Vite dev origin', async () => {
    const res = await fetch(`${app.url}/api/chat`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });
});
