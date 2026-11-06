import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Order, ProductDetail, ProductSummary } from '../src/marketplace/types.js';
import { captureEvents, freshDb, P, startApp } from './helpers.js';

let app: Awaited<ReturnType<typeof startApp>>;

async function connect(headers?: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'vitest', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${app.url}/mcp`), headers ? { requestInit: { headers } } : undefined);
  await client.connect(transport);
  return client;
}

function textOf(result: { contents: object[] }): unknown {
  const first = result.contents[0] as { text?: string } | undefined;
  return JSON.parse(String(first?.text));
}

describe('MCP server (Streamable HTTP, stateless)', () => {
  beforeAll(async () => {
    freshDb();
    app = await startApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('buyer token: buyer tools, tool calls, resources and prompts', async () => {
    const client = await connect({ Authorization: 'Bearer mk_buyer_demo' });
    expect(client.getServerVersion()).toMatchObject({ name: 'open-marketplace' });
    expect(client.getInstructions()).toMatch(/Ada \(buyer\)/);

    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('search_products');
    expect(names).not.toContain('seller_stats');
    const searchTool = (await client.listTools()).tools.find((t) => t.name === 'search_products')!;
    expect(searchTool.annotations).toMatchObject({ readOnlyHint: true });
    expect(Object.keys(searchTool.inputSchema.properties ?? {})).toContain('max_price');

    const events = captureEvents();
    const result = await client.callTool({ name: 'search_products', arguments: { query: 'keyboard' } });
    events.stop();
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { products: ProductSummary[]; total: number };
    expect(structured.products.length).toBeGreaterThan(0);
    expect(structured.products[0]!.title).toMatch(/keyboard/i);
    const text = (result.content as { type: string; text: string }[])[0]!;
    expect(JSON.parse(text.text)).toEqual(structured);
    expect(events.list).toContainEqual(expect.objectContaining({ type: 'agent.tool_call', tool: 'search_products', source: 'mcp', ok: true }));

    const failed = await client.callTool({ name: 'add_to_cart', arguments: { product_id: P.headlamp } });
    expect(failed.isError).toBe(true);
    expect((failed.content as { text: string }[])[0]!.text).toMatch(/out of stock/);

    const products = textOf(await client.readResource({ uri: 'marketplace://products' })) as { products: ProductSummary[]; total: number };
    expect(products.total).toBe(33);
    const detail = textOf(await client.readResource({ uri: `marketplace://products/${P.tklKeyboard}` })) as { product: ProductDetail };
    expect(detail.product).toMatchObject({ id: P.tklKeyboard, tags: expect.arrayContaining(['keyboard']) });
    const orders = textOf(await client.readResource({ uri: 'marketplace://orders' })) as { orders: Order[] };
    expect(orders.orders.every((o) => o.buyer_id === 'usr_ada')).toBe(true);
    await expect(client.readResource({ uri: 'marketplace://products/prod_missing0' })).rejects.toThrow(/No product/);

    const templates = (await client.listResourceTemplates()).resourceTemplates.map((t) => t.uriTemplate);
    expect(templates).toContain('marketplace://products/{id}');
    const listed = (await client.listResources()).resources.map((r) => r.uri);
    expect(listed).toEqual(expect.arrayContaining(['marketplace://products', 'marketplace://orders', `marketplace://products/${P.tklKeyboard}`]));

    expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual(['shopping_assistant']);
    const prompt = await client.getPrompt({ name: 'shopping_assistant', arguments: { need: 'a gift under $50 for a coffee lover' } });
    expect(JSON.stringify(prompt.messages)).toMatch(/coffee lover/);
    await client.close();
  });

  it('seller token: seller tools only', async () => {
    const client = await connect({ Authorization: 'Bearer mk_seller_demo' });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('seller_stats');
    expect(names).not.toContain('search_products');
    const stats = await client.callTool({ name: 'seller_stats', arguments: {} });
    expect((stats.structuredContent as { stats: { revenue: string } }).stats.revenue).toMatch(/^\$/);
    const orders = textOf(await client.readResource({ uri: 'marketplace://orders' })) as { orders: Order[] };
    expect(orders.orders.every((o) => o.seller_id === 'usr_northwind')).toBe(true);
    expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual(['seller_briefing']);
    const outOfScope = await client.callTool({ name: 'checkout', arguments: {} });
    expect(outOfScope.isError).toBe(true);
    await client.close();
  });

  it('identifies the actor from X-Marketplace-Token, defaulting to the demo buyer', async () => {
    const viaHeader = await connect({ 'X-Marketplace-Token': 'mk_seller_demo' });
    expect((await viaHeader.listTools()).tools.map((t) => t.name)).toContain('seller_stats');
    await viaHeader.close();
    for (const headers of [undefined, { Authorization: 'Bearer not-a-token' }]) {
      const anon = await connect(headers);
      expect((await anon.listTools()).tools.map((t) => t.name)).toContain('search_products');
      await anon.close();
    }
  });

  it('answers GET/DELETE with 405 and refuses foreign browser origins', async () => {
    for (const method of ['GET', 'DELETE']) {
      const res = await fetch(`${app.url}/mcp`, { method });
      expect(res.status).toBe(405);
      expect(await res.json()).toEqual({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
    }
    const foreign = await fetch(`${app.url}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Origin: 'https://evil.example' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(foreign.status).toBe(403);

    const preflight = await fetch(`${app.url}/mcp`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:6274',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type,mcp-protocol-version,mcp-session-id',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost:6274');
    const allowed = preflight.headers.get('access-control-allow-headers')!.toLowerCase();
    for (const h of ['authorization', 'mcp-session-id', 'mcp-protocol-version']) expect(allowed).toContain(h);

    const post = await fetch(`${app.url}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(post.headers.get('access-control-expose-headers')).toMatch(/Mcp-Session-Id/i);
  });

  it('returns a JSON-RPC parse error for malformed bodies', async () => {
    const res = await fetch(`${app.url}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ jsonrpc: '2.0', error: { code: -32700 } });
  });
});
