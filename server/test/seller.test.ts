import { beforeEach, describe, expect, it } from 'vitest';
import * as store from '../src/marketplace/store.js';
import { anthropicToolDefs, executeTool, toolsForActor, ToolError } from '../src/marketplace/tools.js';
import type { Order, ProductDetail, SellerStats } from '../src/marketplace/types.js';
import { buyer, captureEvents, freshDb, O, P, seller } from './helpers.js';

const asSeller = <T>(name: string, input: Record<string, unknown> = {}) => executeTool(seller(), name, input, 'mcp') as T;

describe('scope enforcement', () => {
  beforeEach(freshDb);

  it('keeps buyer and seller tools apart', () => {
    expect(() => executeTool(buyer(), 'seller_stats', {}, 'chat')).toThrow(ToolError);
    expect(() => executeTool(buyer(), 'seller_stats', {}, 'chat')).toThrow(/only available to sellers/);
    expect(() => executeTool(buyer(), 'create_listing', {}, 'mcp')).toThrow(ToolError);
    expect(() => executeTool(seller(), 'checkout', {}, 'mcp')).toThrow(/only available to buyers/);
    expect(() => executeTool(buyer(), 'no_such_tool', {}, 'chat')).toThrow(/Unknown tool/);
    expect(executeTool(buyer(), 'list_categories', {}, 'chat')).toHaveProperty('categories');
    expect(executeTool(seller(), 'list_categories', {}, 'mcp')).toHaveProperty('categories');

    expect(toolsForActor(buyer()).map((t) => t.name)).toEqual([
      'search_products', 'get_product', 'add_to_cart', 'remove_from_cart', 'view_cart', 'checkout', 'list_orders',
      'get_order', 'cancel_order', 'list_categories',
    ]);
    expect(toolsForActor(seller()).map((t) => t.name)).toEqual([
      'create_listing', 'update_listing', 'list_my_listings', 'get_seller_orders', 'update_order_status', 'seller_stats',
      'list_categories',
    ]);
  });

  it("refuses to edit another seller's listing", () => {
    expect(() => asSeller('update_listing', { product_id: P.candle, price: 10 })).toThrow(/belongs to Pixel & Pine/);
    expect(store.getProduct(P.candle).price_cents).toBe(2400);
  });

  it('emits a failed agent.tool_call for rejected calls', () => {
    const events = captureEvents();
    expect(() => executeTool(buyer(), 'seller_stats', {}, 'mcp')).toThrow();
    events.stop();
    expect(events.list).toEqual([expect.objectContaining({ type: 'agent.tool_call', tool: 'seller_stats', ok: false, source: 'mcp' })]);
  });

  it('builds Anthropic tool definitions from the zod schemas', () => {
    for (const def of [...anthropicToolDefs(buyer()), ...anthropicToolDefs(seller())]) {
      expect(def.input_schema.type).toBe('object');
      expect(def.input_schema).not.toHaveProperty('$schema');
      expect(typeof def.description).toBe('string');
    }
    const search = anthropicToolDefs(buyer()).find((t) => t.name === 'search_products')!;
    expect(Object.keys(search.input_schema.properties as object)).toEqual([
      'query', 'category', 'min_price', 'max_price', 'in_stock_only', 'sort', 'limit',
    ]);
    expect(search.input_schema.required ?? []).not.toContain('limit');
    const create = anthropicToolDefs(seller()).find((t) => t.name === 'create_listing')!;
    expect(create.input_schema.required).toEqual(['title', 'description', 'price', 'stock', 'category']);
    expect(anthropicToolDefs(buyer())).toBe(anthropicToolDefs(buyer())); // cached: identical bytes every request
  });
});

describe('listings', () => {
  beforeEach(freshDb);

  it('creates and updates listings with dollars in and cents out', () => {
    const events = captureEvents();
    const { product } = asSeller<{ product: ProductDetail }>('create_listing', {
      title: 'Hand-Poured Beeswax Candle',
      description: 'A small-batch beeswax candle with a cotton wick.',
      price: 19.5,
      stock: 12,
      category: 'home',
      tags: ['Candle', 'beeswax', 'candle'],
      emoji: '🕯️',
    });
    expect(product).toMatchObject({ price_cents: 1950, price: '$19.50', status: 'active', seller_id: 'usr_northwind', tags: ['candle', 'beeswax'] });
    expect(product.id).toMatch(/^prod_[0-9a-z]{8}$/);
    expect(events.list.some((e) => e.type === 'product.created' && e.product.id === product.id && e.source === 'mcp')).toBe(true);

    const updated = asSeller<{ product: ProductDetail }>('update_listing', { product_id: product.id, price: 21, stock: 30 });
    expect(updated.product).toMatchObject({ price_cents: 2100, stock: 30 });
    expect(events.list.filter((e) => e.type === 'product.updated')).toHaveLength(1);
    events.stop();

    expect(() => asSeller('update_listing', { product_id: product.id })).toThrow(/Nothing to update/);
    const draft = asSeller<{ product: ProductDetail }>('update_listing', { product_id: product.id, status: 'draft' });
    expect(draft.product.status).toBe('draft');
    expect(asSeller<{ products: ProductDetail[] }>('list_my_listings', { status: 'draft' }).products.map((p) => p.id)).toEqual([product.id]);
    expect(() => executeTool(buyer(), 'get_product', { product_id: product.id }, 'chat')).toThrow(/No product/);
  });
});

describe('update_order_status', () => {
  beforeEach(freshDb);

  it('moves placed -> shipped -> delivered, one step at a time', () => {
    const shipped = asSeller<{ order: Order }>('update_order_status', { order_id: O.nwPlaced, status: 'shipped' });
    expect(shipped.order.status).toBe('shipped');
    const delivered = asSeller<{ order: Order }>('update_order_status', { order_id: O.nwPlaced, status: 'delivered' });
    expect(delivered.order.status).toBe('delivered');
    expect(() => asSeller('update_order_status', { order_id: O.nwPlaced, status: 'delivered' })).toThrow(/already delivered/);
    expect(() => asSeller('update_order_status', { order_id: O.nwPlaced, status: 'shipped' })).toThrow(/one step at a time/);
  });

  it('rejects skipping steps, cancelled orders and other sellers', () => {
    executeTool(buyer(), 'add_to_cart', { product_id: P.tklKeyboard }, 'chat');
    const { orders } = executeTool(buyer(), 'checkout', {}, 'chat') as { orders: Order[] };
    const id = orders[0]!.id;
    expect(() => asSeller('update_order_status', { order_id: id, status: 'delivered' })).toThrow(/one step at a time/);
    executeTool(buyer(), 'cancel_order', { order_id: id }, 'chat');
    expect(() => asSeller('update_order_status', { order_id: id, status: 'shipped' })).toThrow(/cancelled/);
    expect(() => asSeller('update_order_status', { order_id: O.ppDelivered, status: 'shipped' })).toThrow(/No order/);
    expect(() => asSeller('update_order_status', { order_id: O.nwPlaced, status: 'placed' })).toThrow(/Invalid input/);
  });
});

describe('seller_stats', () => {
  beforeEach(freshDb);

  it('summarizes the seeded Northwind store', () => {
    const { stats } = asSeller<{ stats: SellerStats }>('seller_stats');
    expect(stats.revenue_cents).toBe(6300 + 17900 + 6099);
    expect(stats.revenue).toBe('$302.99');
    expect(stats.orders_total).toBe(3);
    expect(stats.orders_by_status).toEqual({ placed: 1, shipped: 1, delivered: 1, cancelled: 0 });
    expect(stats.units_sold).toBe(5);
    expect(stats.active_listings).toBe(24);
    expect(stats.top_products[0]).toMatchObject({ title: 'Over-Ear Noise-Cancelling Headphones', units: 1, revenue_cents: 17900, revenue: '$179.00' });
    expect(stats.low_stock.map((p) => p.stock)).toEqual([0, 2, 3, 4, 4, 5, 5]);
    expect(stats.low_stock.every((p) => p.seller_id === 'usr_northwind' && p.status === 'active')).toBe(true);
    expect(stats.needs_shipping.map((o) => o.id)).toEqual([O.nwPlaced]);
  });

  it('tracks new and cancelled orders', () => {
    executeTool(buyer(), 'add_to_cart', { product_id: P.tklKeyboard, quantity: 2 }, 'chat');
    const { orders } = executeTool(buyer(), 'checkout', {}, 'chat') as { orders: Order[] };
    let { stats } = asSeller<{ stats: SellerStats }>('seller_stats');
    expect(stats.revenue_cents).toBe(30299 + 17800);
    expect(stats.units_sold).toBe(7);
    expect(stats.needs_shipping.map((o) => o.id)).toEqual([O.nwPlaced, orders[0]!.id]); // oldest first
    expect(stats.top_products[0]).toMatchObject({ product_id: P.tklKeyboard, units: 2 });

    executeTool(buyer(), 'cancel_order', { order_id: orders[0]!.id }, 'chat');
    ({ stats } = asSeller<{ stats: SellerStats }>('seller_stats'));
    expect(stats.revenue_cents).toBe(30299);
    expect(stats.orders_by_status.cancelled).toBe(1);
    expect(stats.orders_total).toBe(4);
  });
});
