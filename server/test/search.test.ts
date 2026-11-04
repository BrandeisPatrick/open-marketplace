import { beforeEach, describe, expect, it } from 'vitest';
import * as store from '../src/marketplace/store.js';
import { executeTool, ToolError } from '../src/marketplace/tools.js';
import type { ProductSummary } from '../src/marketplace/types.js';
import { buyer, freshDb, P, seller } from './helpers.js';

type SearchOut = { products: ProductSummary[]; total: number; query: string };
const search = (input: Record<string, unknown>) => executeTool(buyer(), 'search_products', input, 'chat') as SearchOut;

describe('search_products', () => {
  beforeEach(freshDb);

  it('ranks title matches first and echoes the query', () => {
    const out = search({ query: 'mechanical keyboard' });
    expect(out.query).toBe('mechanical keyboard');
    expect(out.total).toBe(3);
    expect(out.products.every((p) => /mechanical keyboard/i.test(p.title))).toBe(true);

    const coffee = search({ query: 'coffee' });
    expect(coffee.total).toBeGreaterThanOrEqual(4);
    // Title hits (mug, kit, grinder) outrank tag/description-only hits (travel mug, espresso machine).
    expect(coffee.products.slice(0, 3).every((p) => /coffee/i.test(p.title))).toBe(true);
    expect(coffee.products.slice(3).some((p) => !/coffee/i.test(p.title))).toBe(true);
  });

  it('folds simple plurals and matches tags', () => {
    const singular = search({ query: 'keyboard' }).products.map((p) => p.id);
    const plural = search({ query: 'keyboards' }).products.map((p) => p.id);
    expect(plural).toEqual(singular);
    const headphones = search({ query: 'headphones' }).products.map((p) => p.title);
    expect(headphones.some((t) => /earbuds/i.test(t))).toBe(true); // tagged "headphones"
    expect(search({ query: 'zzzz-nothing' }).total).toBe(0);
  });

  it('applies price, category and stock filters before sorting', () => {
    const gifts = search({ query: 'gift', max_price: 50 });
    expect(gifts.total).toBeGreaterThan(3);
    expect(gifts.products.every((p) => p.price_cents <= 5000)).toBe(true);

    const range = search({ min_price: 20, max_price: 40, limit: 20 });
    expect(range.products.every((p) => p.price_cents >= 2000 && p.price_cents <= 4000)).toBe(true);

    const kitchen = search({ category: 'kitchen', limit: 20 });
    expect(kitchen.total).toBe(7);
    expect(kitchen.products.every((p) => p.category === 'kitchen')).toBe(true);

    expect(search({ query: 'headlamp' }).total).toBe(1);
    expect(search({ query: 'headlamp', in_stock_only: true }).total).toBe(0);
  });

  it('sorts by price and rating, and respects limit', () => {
    const asc = search({ query: 'gift', sort: 'price_asc', limit: 20 }).products.map((p) => p.price_cents);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    const desc = search({ sort: 'price_desc', limit: 20 }).products.map((p) => p.price_cents);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
    expect(desc[0]).toBe(38900);
    const rating = search({ sort: 'rating', limit: 20 }).products.map((p) => p.rating);
    expect(rating).toEqual([...rating].sort((a, b) => b - a));

    const limited = search({ query: 'gift', limit: 2 });
    expect(limited.products).toHaveLength(2);
    expect(limited.total).toBeGreaterThan(2);
    expect(search({}).products).toHaveLength(8); // default limit
  });

  it('only returns active products', () => {
    expect(search({ query: 'candle' }).total).toBe(1);
    store.updateListing('usr_pixelpine', P.candle, { status: 'archived' });
    expect(search({ query: 'candle' }).total).toBe(0);
    expect(() => store.getProduct(P.candle)).toThrow(ToolError);
  });

  it('rejects invalid input with readable errors', () => {
    expect(() => search({ limit: 50 })).toThrow(/Invalid input for search_products: limit/);
    expect(() => search({ category: 'garden' })).toThrow(/category/);
    expect(() => search({ min_price: 80, max_price: 20 })).toThrow(/min_price is greater than max_price/);
    expect(() => executeTool(seller(), 'search_products', { query: 'x' }, 'mcp')).toThrow(/only available to buyers/);
  });
});
