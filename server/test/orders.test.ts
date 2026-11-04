import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_ADDRESS } from '../src/marketplace/seed.js';
import * as store from '../src/marketplace/store.js';
import { executeTool, ToolError } from '../src/marketplace/tools.js';
import type { Cart, Order, ProductSummary } from '../src/marketplace/types.js';
import { buyer, captureEvents, freshDb, O, P } from './helpers.js';

const call = <T>(name: string, input: Record<string, unknown> = {}) => executeTool(buyer(), name, input, 'chat') as T;
const stockOf = (id: string) => store.getProduct(id, { includeInactive: true }).stock;

describe('cart', () => {
  beforeEach(freshDb);

  it('add_to_cart and view_cart', () => {
    const added = call<{ cart: Cart; added: { product: ProductSummary; quantity: number } }>('add_to_cart', {
      product_id: P.tklKeyboard,
      quantity: 2,
    });
    expect(added.added).toMatchObject({ quantity: 2, product: { id: P.tklKeyboard, price: '$89.00' } });
    expect(added.cart).toMatchObject({ buyer_id: 'usr_ada', item_count: 2, subtotal_cents: 17800, subtotal: '$178.00' });
    expect(added.cart.items[0]).toMatchObject({ quantity: 2, line_total_cents: 17800, line_total: '$178.00' });

    call('add_to_cart', { product_id: P.stonewareMug }); // default quantity 1
    call('add_to_cart', { product_id: P.tklKeyboard }); // merges into the existing line
    const { cart } = call<{ cart: Cart }>('view_cart');
    expect(cart.items.map((i) => [i.product.id, i.quantity])).toEqual([
      [P.tklKeyboard, 3],
      [P.stonewareMug, 1],
    ]);
    expect(cart.subtotal_cents).toBe(3 * 8900 + 1800);

    const { cart: after } = call<{ cart: Cart }>('remove_from_cart', { product_id: P.stonewareMug });
    expect(after.items).toHaveLength(1);
  });

  it('enforces stock and availability', () => {
    expect(() => call('add_to_cart', { product_id: P.chefKnife, quantity: 3 })).toThrow(/Only 2 .* in stock/);
    call('add_to_cart', { product_id: P.chefKnife, quantity: 2 });
    expect(() => call('add_to_cart', { product_id: P.chefKnife })).toThrow(/already in the cart/);
    expect(() => call('add_to_cart', { product_id: P.headlamp })).toThrow(/out of stock/);
    expect(() => call('add_to_cart', { product_id: 'prod_nope1234' })).toThrow(ToolError);
    expect(() => call('remove_from_cart', { product_id: P.candle })).toThrow(/isn't in the cart/);
  });
});

describe('checkout', () => {
  beforeEach(freshDb);

  it('creates one order per seller, decrements stock, empties the cart and emits events', () => {
    call('add_to_cart', { product_id: P.tklKeyboard, quantity: 2 }); // Northwind, $178 -> free shipping
    call('add_to_cart', { product_id: P.stonewareMug, quantity: 1 }); // Pixel & Pine, $18 -> $5.99 shipping
    const events = captureEvents();
    const out = call<{ orders: Order[]; total_cents: number; total: string }>('checkout');
    events.stop();

    expect(out.orders).toHaveLength(2);
    const nw = out.orders.find((o) => o.seller_id === 'usr_northwind')!;
    const pp = out.orders.find((o) => o.seller_id === 'usr_pixelpine')!;
    expect(nw).toMatchObject({ status: 'placed', subtotal_cents: 17800, shipping_cents: 0, total_cents: 17800, buyer_name: 'Ada' });
    expect(pp).toMatchObject({ status: 'placed', subtotal_cents: 1800, shipping_cents: 599, total_cents: 2399, seller_name: 'Pixel & Pine' });
    expect(nw.items).toEqual([
      expect.objectContaining({ product_id: P.tklKeyboard, quantity: 2, unit_price_cents: 8900, unit_price: '$89.00', line_total_cents: 17800 }),
    ]);
    expect(out.total_cents).toBe(20199);
    expect(out.total).toBe('$201.99');
    expect(nw.shipping_address).toBe(DEMO_ADDRESS); // defaults to the most recent order's address

    expect(stockOf(P.tklKeyboard)).toBe(12);
    expect(stockOf(P.stonewareMug)).toBe(59);
    expect(store.getCart('usr_ada').items).toHaveLength(0);

    const created = events.list.filter((e) => e.type === 'order.created');
    expect(created).toHaveLength(2);
    expect(created.every((e) => e.source === 'chat' && e.actor.id === 'usr_ada')).toBe(true);
    expect(events.list.some((e) => e.type === 'cart.updated' && e.cart.items.length === 0)).toBe(true);
    expect(events.list.filter((e) => e.type === 'product.updated')).toHaveLength(2);
    const toolCall = events.list.find((e) => e.type === 'agent.tool_call');
    expect(toolCall).toMatchObject({ tool: 'checkout', ok: true, source: 'chat', summary: 'Ada checked out: 2 orders totaling $201.99' });
    expect(events.list.every((e) => typeof e.id === 'string' && !Number.isNaN(Date.parse(e.at)))).toBe(true);

    const listed = call<{ orders: Order[] }>('list_orders');
    expect(listed.orders.slice(0, 2).map((o) => o.id).sort()).toEqual([nw.id, pp.id].sort());
  });

  it('uses a given shipping address', () => {
    call('add_to_cart', { product_id: P.candle });
    const out = call<{ orders: Order[] }>('checkout', { shipping_address: '1 Test Street, Springfield' });
    expect(out.orders[0]!.shipping_address).toBe('1 Test Street, Springfield');
  });

  it('fails on an empty cart or insufficient stock without changing anything', () => {
    expect(() => call('checkout')).toThrow(/cart is empty/);
    call('add_to_cart', { product_id: P.lowProfileKeyboard, quantity: 4 });
    store.updateListing('usr_northwind', P.lowProfileKeyboard, { stock: 1 });
    const before = store.listBuyerOrders('usr_ada').length;
    expect(() => call('checkout')).toThrow(/Only 1 of/);
    expect(store.listBuyerOrders('usr_ada')).toHaveLength(before);
    expect(store.getCart('usr_ada').item_count).toBe(4);
    expect(stockOf(P.lowProfileKeyboard)).toBe(1);
  });
});

describe('cancel_order', () => {
  beforeEach(freshDb);

  it('cancels a placed order and restores stock', () => {
    call('add_to_cart', { product_id: P.tklKeyboard, quantity: 3 });
    const { orders } = call<{ orders: Order[] }>('checkout');
    expect(stockOf(P.tklKeyboard)).toBe(11);
    const events = captureEvents();
    const { order } = call<{ order: Order }>('cancel_order', { order_id: orders[0]!.id });
    events.stop();
    expect(order.status).toBe('cancelled');
    expect(stockOf(P.tklKeyboard)).toBe(14);
    expect(events.list.some((e) => e.type === 'order.updated' && e.order.status === 'cancelled')).toBe(true);
    expect(() => call('cancel_order', { order_id: order.id })).toThrow(/already cancelled/);
  });

  it('only cancels orders that are still placed', () => {
    expect(() => call('cancel_order', { order_id: O.nwShipped })).toThrow(/already shipped/);
    expect(() => call('cancel_order', { order_id: O.nwDelivered })).toThrow(/been delivered/);
    expect(() => call('cancel_order', { order_id: 'ord_missing1' })).toThrow(/No order/);
    expect(call<{ order: Order }>('cancel_order', { order_id: O.nwPlaced }).order.status).toBe('cancelled');
  });
});
