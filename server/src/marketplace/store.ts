// Data access + marketplace rules. Pure functions over SQLite; no events (the tool layer emits those).
import type Anthropic from '@anthropic-ai/sdk';
import { all, get, run, transaction } from '../db.js';
import { formatCents, newId, nowIso } from './format.js';
import { DEMO_BUYER_ID, DEMO_SELLER_ID, shippingFor } from './seed.js';
import {
  CATEGORIES,
  ORDER_STATUSES,
  ToolError,
  type Actor,
  type Cart,
  type Category,
  type Order,
  type OrderStatus,
  type ProductDetail,
  type ProductStatus,
  type ProductSummary,
  type Role,
  type SellerStats,
  type SortKey,
} from './types.js';

// ─── rows ──────────────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  name: string;
  role: Role;
  api_token: string | null;
  created_at: string;
}

interface ProductRow {
  id: string;
  seller_id: string;
  seller_name: string;
  title: string;
  description: string;
  price_cents: number;
  currency: string;
  stock: number;
  category: string;
  tags: string;
  emoji: string;
  rating: number;
  review_count: number;
  status: ProductStatus;
  created_at: string;
  updated_at: string;
}

interface OrderRow {
  id: string;
  buyer_id: string;
  buyer_name: string;
  seller_id: string;
  seller_name: string;
  status: OrderStatus;
  subtotal_cents: number;
  shipping_cents: number;
  total_cents: number;
  shipping_address: string | null;
  created_at: string;
  updated_at: string;
}

interface OrderItemRow {
  order_id: string;
  product_id: string;
  title: string;
  emoji: string;
  unit_price_cents: number;
  quantity: number;
}

interface ConversationRow {
  id: string;
  actor_id: string;
  role: Role;
  messages: string;
  prompt_fingerprint: string | null;
  created_at: string;
  updated_at: string;
}

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

// ─── users ─────────────────────────────────────────────────────────────────

function toActor(row: UserRow): Actor {
  return { id: row.id, name: row.name, role: row.role };
}

export function getActor(id: string): Actor | undefined {
  const row = get<UserRow>('SELECT * FROM users WHERE id = ?', id);
  return row ? toActor(row) : undefined;
}

export function actorForToken(token: string | null | undefined): Actor | undefined {
  const t = token?.trim();
  if (!t) return undefined;
  const row = get<UserRow>('SELECT * FROM users WHERE api_token = ?', t);
  return row ? toActor(row) : undefined;
}

export function demoActor(role: Role): Actor {
  const actor = getActor(role === 'buyer' ? DEMO_BUYER_ID : DEMO_SELLER_ID);
  if (!actor) throw new Error(`Demo ${role} is missing from the database`);
  return actor;
}

export function demoActors(): { buyer: Actor; seller: Actor } {
  return { buyer: demoActor('buyer'), seller: demoActor('seller') };
}

// ─── products ──────────────────────────────────────────────────────────────

const PRODUCT_SELECT = 'SELECT p.*, u.name AS seller_name FROM products p JOIN users u ON u.id = p.seller_id';

function parseTags(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function toSummary(r: ProductRow): ProductSummary {
  return {
    id: r.id,
    title: r.title,
    price_cents: r.price_cents,
    price: formatCents(r.price_cents),
    currency: 'USD',
    stock: r.stock,
    category: r.category,
    emoji: r.emoji,
    rating: r.rating,
    review_count: r.review_count,
    seller_id: r.seller_id,
    seller_name: r.seller_name,
    status: r.status,
  };
}

function toDetail(r: ProductRow): ProductDetail {
  return {
    ...toSummary(r),
    description: r.description,
    tags: parseTags(r.tags),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function productRow(id: string): ProductRow | undefined {
  return get<ProductRow>(`${PRODUCT_SELECT} WHERE p.id = ?`, id.trim());
}

/** Buyers only ever see active products; sellers can see their own drafts/archived ones. */
export function getProduct(id: string, opts: { includeInactive?: boolean } = {}): ProductDetail {
  const row = productRow(id);
  if (!row || (!opts.includeInactive && row.status !== 'active')) {
    throw new ToolError(`No product with id "${id}". Use an id from search results, e.g. "prod_ab12cd34".`);
  }
  return toDetail(row);
}

export function getProductSummaries(ids: string[]): ProductSummary[] {
  return [...new Set(ids)].flatMap((id) => {
    const row = productRow(id);
    return row ? [toSummary(row)] : [];
  });
}

export function listActiveProducts(): ProductSummary[] {
  return all<ProductRow>(`${PRODUCT_SELECT} WHERE p.status = 'active' ORDER BY p.created_at DESC, p.rowid DESC`).map(toSummary);
}

export function assertCategory(category: string): string {
  const c = category.trim().toLowerCase();
  if (!(CATEGORIES as readonly string[]).includes(c)) {
    throw new ToolError(`Unknown category "${category}". Choose one of: ${CATEGORIES.join(', ')}.`);
  }
  return c;
}

export function listCategories(): Category[] {
  const counts = new Map(
    all<{ category: string; n: number }>(
      "SELECT category, COUNT(*) AS n FROM products WHERE status = 'active' GROUP BY category",
    ).map((r) => [r.category, r.n]),
  );
  const names = new Set<string>([...CATEGORIES, ...counts.keys()]);
  return [...names]
    .map((name) => ({ name, count: counts.get(name) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// ─── search ────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'with', 'of', 'to', 'in', 'on', 'at', 'by', 'from', 'my', 'me', 'i', 'im',
  'we', 'our', 'you', 'your', 'some', 'any', 'something', 'that', 'this', 'these', 'those', 'is', 'are', 'it', 'its',
  'please', 'find', 'search', 'show', 'looking', 'look', 'want', 'need', 'get', 'buy', 'like', 'under', 'over',
  'below', 'above', 'than', 'less', 'more', 'around', 'about', 'cheap', 'cheapest', 'best', 'good', 'nice', 'great',
  'product', 'products', 'item', 'items', 'thing', 'things', 'one', 'ones',
]);

function fold(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

function words(text: string): string[] {
  return fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function queryTokens(query: string): string[] {
  const withoutPrices = query.replace(/\$\s?\d+(?:[.,]\d+)?/g, ' ');
  return [...new Set(words(withoutPrices).filter((w) => (w.length >= 2 || /\d/.test(w)) && !STOPWORDS.has(w)))];
}

/** Crude plural folding: "keyboards" -> "keyboard", "accessories" -> "accessory", "boxes" -> "box". */
function variants(token: string): string[] {
  const out = new Set([token]);
  if (token.length > 4 && token.endsWith('ies')) out.add(`${token.slice(0, -3)}y`);
  if (token.length > 3 && token.endsWith('es')) out.add(token.slice(0, -2));
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) out.add(token.slice(0, -1));
  return [...out].filter((v) => v.length >= 2);
}

/** Word-prefix match, so "mug" matches "mugs" but "pen" does not match "open". */
function hits(fieldWords: string[], tokenVariants: string[]): boolean {
  return fieldWords.some((w) => tokenVariants.some((v) => w.startsWith(v)));
}

function relevance(row: ProductRow, tokens: string[]): number {
  const title = words(row.title);
  const tags = parseTags(row.tags).flatMap(words);
  const category = words(row.category);
  const description = words(row.description);
  let score = 0;
  let matched = 0;
  for (const token of tokens) {
    const v = variants(token);
    const inTitle = hits(title, v);
    const inTags = hits(tags, v);
    const inCategory = hits(category, v);
    const inDescription = hits(description, v);
    if (!inTitle && !inTags && !inCategory && !inDescription) continue;
    matched++;
    score += (inTitle ? 10 : 0) + (inTags ? 6 : 0) + (inCategory ? 4 : 0) + (inDescription ? 2 : 0);
  }
  if (matched === 0) return 0;
  if (tokens.length > 1) {
    score *= matched / tokens.length;
    if (matched === tokens.length) score += 12;
    if (` ${title.join(' ')} `.includes(` ${tokens.join(' ')}`)) score += 8;
  }
  return score;
}

export interface SearchOptions {
  query?: string;
  category?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  inStockOnly?: boolean;
  sort?: SortKey;
  limit?: number;
}

export interface SearchResult {
  products: ProductSummary[];
  total: number;
  query: string;
}

/** Case-insensitive match over title/description/tags/category; filters first, then sort, then limit. */
export function searchProducts(opts: SearchOptions): SearchResult {
  const query = opts.query?.trim() ?? '';
  const category = opts.category?.trim() ? assertCategory(opts.category) : undefined;
  let rows = all<ProductRow>(`${PRODUCT_SELECT} WHERE p.status = 'active'`);
  if (category) rows = rows.filter((r) => r.category === category);
  if (opts.minPriceCents !== undefined) rows = rows.filter((r) => r.price_cents >= opts.minPriceCents!);
  if (opts.maxPriceCents !== undefined) rows = rows.filter((r) => r.price_cents <= opts.maxPriceCents!);
  if (opts.inStockOnly) rows = rows.filter((r) => r.stock > 0);

  const tokens = queryTokens(query);
  let scored = rows.map((row) => ({ row, score: tokens.length ? relevance(row, tokens) : 0 }));
  if (tokens.length) scored = scored.filter((s) => s.score > 0);

  const byPopularity = (a: ProductRow, b: ProductRow) =>
    b.rating - a.rating || b.review_count - a.review_count || a.title.localeCompare(b.title);
  const sort = opts.sort ?? 'relevance';
  scored.sort((a, b) => {
    switch (sort) {
      case 'price_asc':
        return a.row.price_cents - b.row.price_cents || byPopularity(a.row, b.row);
      case 'price_desc':
        return b.row.price_cents - a.row.price_cents || byPopularity(a.row, b.row);
      case 'rating':
        return byPopularity(a.row, b.row);
      default:
        return b.score - a.score || byPopularity(a.row, b.row);
    }
  });
  const limit = Math.max(1, Math.floor(opts.limit ?? 8));
  return { products: scored.slice(0, limit).map((s) => toSummary(s.row)), total: scored.length, query };
}

// ─── cart ──────────────────────────────────────────────────────────────────

type CartRow = ProductRow & { quantity: number };

function cartRows(buyerId: string): CartRow[] {
  return all<CartRow>(
    `SELECT p.*, u.name AS seller_name, ci.quantity AS quantity
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       JOIN users u ON u.id = p.seller_id
      WHERE ci.buyer_id = ?
      ORDER BY ci.rowid`,
    buyerId,
  );
}

export function getCart(buyerId: string): Cart {
  const items = cartRows(buyerId).map((r) => {
    const line = r.price_cents * r.quantity;
    return { product: toSummary(r), quantity: r.quantity, line_total_cents: line, line_total: formatCents(line) };
  });
  const subtotal = sum(items.map((i) => i.line_total_cents));
  return {
    buyer_id: buyerId,
    items,
    item_count: sum(items.map((i) => i.quantity)),
    subtotal_cents: subtotal,
    subtotal: formatCents(subtotal),
  };
}

export function addToCart(buyerId: string, productId: string, quantity: number) {
  return transaction(() => {
    const row = productRow(productId);
    if (!row || row.status !== 'active') {
      throw new ToolError(`No product with id "${productId}". Use an id from search results, e.g. "prod_ab12cd34".`);
    }
    const inCart = get<{ quantity: number }>(
      'SELECT quantity FROM cart_items WHERE buyer_id = ? AND product_id = ?', buyerId, row.id,
    )?.quantity ?? 0;
    if (row.stock <= 0) throw new ToolError(`"${row.title}" is out of stock right now.`);
    const desired = inCart + quantity;
    if (desired > row.stock) {
      throw new ToolError(
        inCart > 0
          ? `Only ${row.stock} of "${row.title}" in stock and ${inCart} already in the cart, so at most ${Math.max(0, row.stock - inCart)} more can be added.`
          : `Only ${row.stock} of "${row.title}" in stock.`,
      );
    }
    run(
      `INSERT INTO cart_items (buyer_id, product_id, quantity) VALUES (?, ?, ?)
       ON CONFLICT (buyer_id, product_id) DO UPDATE SET quantity = excluded.quantity`,
      buyerId, row.id, desired,
    );
    return { cart: getCart(buyerId), added: { product: toSummary(row), quantity } };
  });
}

export function removeFromCart(buyerId: string, productId: string): { cart: Cart; removed: ProductSummary } {
  return transaction(() => {
    const row = cartRows(buyerId).find((r) => r.id === productId.trim());
    if (!row) throw new ToolError(`Product "${productId}" isn't in the cart.`);
    run('DELETE FROM cart_items WHERE buyer_id = ? AND product_id = ?', buyerId, row.id);
    return { cart: getCart(buyerId), removed: toSummary(row) };
  });
}

// ─── orders ────────────────────────────────────────────────────────────────

const ORDER_SELECT = `SELECT o.*, b.name AS buyer_name, s.name AS seller_name
                        FROM orders o JOIN users b ON b.id = o.buyer_id JOIN users s ON s.id = o.seller_id`;
const NEWEST_FIRST = 'ORDER BY o.created_at DESC, o.rowid DESC';

function hydrate(row: OrderRow): Order {
  const items = all<OrderItemRow>('SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid', row.id).map((i) => ({
    product_id: i.product_id,
    title: i.title,
    emoji: i.emoji,
    unit_price_cents: i.unit_price_cents,
    unit_price: formatCents(i.unit_price_cents),
    quantity: i.quantity,
    line_total_cents: i.unit_price_cents * i.quantity,
  }));
  return {
    id: row.id,
    buyer_id: row.buyer_id,
    buyer_name: row.buyer_name,
    seller_id: row.seller_id,
    seller_name: row.seller_name,
    status: row.status,
    items,
    subtotal_cents: row.subtotal_cents,
    shipping_cents: row.shipping_cents,
    total_cents: row.total_cents,
    total: formatCents(row.total_cents),
    shipping_address: row.shipping_address,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function getOrder(orderId: string): Order | undefined {
  const row = get<OrderRow>(`${ORDER_SELECT} WHERE o.id = ?`, orderId.trim());
  return row ? hydrate(row) : undefined;
}

function assertStatus(status: string | undefined): OrderStatus | undefined {
  if (status === undefined || status === '') return undefined;
  if (!(ORDER_STATUSES as readonly string[]).includes(status)) {
    throw new ToolError(`Unknown order status "${status}". Use one of: ${ORDER_STATUSES.join(', ')}.`);
  }
  return status as OrderStatus;
}

export function listBuyerOrders(buyerId: string, status?: string): Order[] {
  const s = assertStatus(status);
  const rows = s
    ? all<OrderRow>(`${ORDER_SELECT} WHERE o.buyer_id = ? AND o.status = ? ${NEWEST_FIRST}`, buyerId, s)
    : all<OrderRow>(`${ORDER_SELECT} WHERE o.buyer_id = ? ${NEWEST_FIRST}`, buyerId);
  return rows.map(hydrate);
}

export function getBuyerOrder(buyerId: string, orderId: string): Order {
  const order = getOrder(orderId);
  if (!order || order.buyer_id !== buyerId) throw new ToolError(`No order "${orderId}" among your orders.`);
  return order;
}

export function listSellerOrders(sellerId: string, status?: string, opts: { oldestFirst?: boolean } = {}): Order[] {
  const s = assertStatus(status);
  const order = opts.oldestFirst ? 'ORDER BY o.created_at ASC, o.rowid ASC' : NEWEST_FIRST;
  const rows = s
    ? all<OrderRow>(`${ORDER_SELECT} WHERE o.seller_id = ? AND o.status = ? ${order}`, sellerId, s)
    : all<OrderRow>(`${ORDER_SELECT} WHERE o.seller_id = ? ${order}`, sellerId);
  return rows.map(hydrate);
}

function lastShippingAddress(buyerId: string): string | null {
  return (
    get<{ shipping_address: string }>(
      `SELECT shipping_address FROM orders WHERE buyer_id = ? AND shipping_address IS NOT NULL
        ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      buyerId,
    )?.shipping_address ?? null
  );
}

/** One order per seller, flat shipping per order, stock decremented, cart emptied — all or nothing. */
export function checkout(buyerId: string, shippingAddress?: string): { orders: Order[]; total_cents: number; total: string } {
  return transaction(() => {
    const rows = cartRows(buyerId);
    if (rows.length === 0) throw new ToolError('The cart is empty. Add something before checking out.');
    const problems: string[] = [];
    for (const r of rows) {
      if (r.status !== 'active') problems.push(`"${r.title}" is no longer available; remove it from the cart.`);
      else if (r.stock === 0) problems.push(`"${r.title}" is out of stock; remove it from the cart.`);
      else if (r.stock < r.quantity) problems.push(`Only ${r.stock} of "${r.title}" left but the cart has ${r.quantity}.`);
    }
    if (problems.length) throw new ToolError(`Can't check out yet. ${problems.join(' ')}`);

    const address = shippingAddress?.trim() || lastShippingAddress(buyerId);
    const now = nowIso();
    const bySeller = new Map<string, CartRow[]>();
    for (const r of rows) bySeller.set(r.seller_id, [...(bySeller.get(r.seller_id) ?? []), r]);

    const orderIds: string[] = [];
    for (const [sellerId, items] of bySeller) {
      const id = newId('ord');
      const subtotal = sum(items.map((i) => i.price_cents * i.quantity));
      const shipping = shippingFor(subtotal);
      run(
        `INSERT INTO orders (id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, total_cents,
                             shipping_address, created_at, updated_at)
         VALUES (?, ?, ?, 'placed', ?, ?, ?, ?, ?, ?)`,
        id, buyerId, sellerId, subtotal, shipping, subtotal + shipping, address, now, now,
      );
      for (const i of items) {
        run(
          'INSERT INTO order_items (order_id, product_id, title, emoji, unit_price_cents, quantity) VALUES (?, ?, ?, ?, ?, ?)',
          id, i.id, i.title, i.emoji, i.price_cents, i.quantity,
        );
        run('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?', i.quantity, now, i.id);
      }
      orderIds.push(id);
    }
    run('DELETE FROM cart_items WHERE buyer_id = ?', buyerId);

    const orders = orderIds.map((id) => getOrder(id)!);
    const total = sum(orders.map((o) => o.total_cents));
    return { orders, total_cents: total, total: formatCents(total) };
  });
}

export function cancelOrder(buyerId: string, orderId: string): Order {
  return transaction(() => {
    const order = getBuyerOrder(buyerId, orderId);
    if (order.status === 'cancelled') throw new ToolError(`Order ${order.id} is already cancelled.`);
    if (order.status !== 'placed') {
      throw new ToolError(
        `Order ${order.id} has already ${order.status === 'shipped' ? 'shipped' : 'been delivered'}, so it can't be cancelled. Only orders that haven't shipped can be cancelled.`,
      );
    }
    const now = nowIso();
    for (const item of order.items) {
      run('UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?', item.quantity, now, item.product_id);
    }
    run("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?", now, order.id);
    return getOrder(order.id)!;
  });
}

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = { placed: 'shipped', shipped: 'delivered' };

export function updateOrderStatus(sellerId: string, orderId: string, status: 'shipped' | 'delivered'): Order {
  return transaction(() => {
    const order = getOrder(orderId);
    if (!order || order.seller_id !== sellerId) throw new ToolError(`No order "${orderId}" among your store's orders.`);
    if (order.status === status) throw new ToolError(`Order ${order.id} is already ${status}.`);
    if (order.status === 'cancelled') throw new ToolError(`Order ${order.id} was cancelled by the buyer and can't be updated.`);
    if (NEXT_STATUS[order.status] !== status) {
      throw new ToolError(
        `Order ${order.id} is ${order.status}. Orders move placed → shipped → delivered one step at a time, so it can't be marked ${status} yet.`,
      );
    }
    run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), order.id);
    return getOrder(order.id)!;
  });
}

// ─── listings (seller) ─────────────────────────────────────────────────────

export interface ListingFields {
  title: string;
  description: string;
  priceCents: number;
  stock: number;
  category: string;
  tags: string[];
  emoji: string;
  status: ProductStatus;
}

function cleanTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 10);
}

export function createListing(sellerId: string, fields: Partial<ListingFields> & Omit<ListingFields, 'tags' | 'emoji' | 'status'>): ProductDetail {
  const id = newId('prod');
  const now = nowIso();
  run(
    `INSERT INTO products (id, seller_id, title, description, price_cents, currency, stock, category, tags, emoji,
                           rating, review_count, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
    id, sellerId, fields.title.trim(), fields.description.trim(), fields.priceCents, fields.stock,
    assertCategory(fields.category), JSON.stringify(cleanTags(fields.tags ?? [])), fields.emoji?.trim() || '📦',
    fields.status ?? 'active', now, now,
  );
  return getProduct(id, { includeInactive: true });
}

export function updateListing(
  sellerId: string,
  productId: string,
  patch: Partial<ListingFields>,
): { product: ProductDetail; changed: (keyof ListingFields)[] } {
  return transaction(() => {
    const row = productRow(productId);
    if (!row) throw new ToolError(`No product with id "${productId}".`);
    if (row.seller_id !== sellerId) {
      throw new ToolError(`Product ${row.id} belongs to ${row.seller_name}. You can only edit your own listings.`);
    }
    const before: ListingFields = {
      title: row.title,
      description: row.description,
      priceCents: row.price_cents,
      stock: row.stock,
      category: row.category,
      tags: parseTags(row.tags),
      emoji: row.emoji,
      status: row.status,
    };
    const after: ListingFields = {
      title: patch.title?.trim() ?? before.title,
      description: patch.description?.trim() ?? before.description,
      priceCents: patch.priceCents ?? before.priceCents,
      stock: patch.stock ?? before.stock,
      category: patch.category !== undefined ? assertCategory(patch.category) : before.category,
      tags: patch.tags !== undefined ? cleanTags(patch.tags) : before.tags,
      emoji: patch.emoji?.trim() || before.emoji,
      status: patch.status ?? before.status,
    };
    const changed = (Object.keys(after) as (keyof ListingFields)[]).filter(
      (k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]),
    );
    if (changed.length > 0) {
      run(
        `UPDATE products SET title = ?, description = ?, price_cents = ?, stock = ?, category = ?, tags = ?, emoji = ?,
                             status = ?, updated_at = ?
          WHERE id = ?`,
        after.title, after.description, after.priceCents, after.stock, after.category, JSON.stringify(after.tags),
        after.emoji, after.status, nowIso(), row.id,
      );
    }
    return { product: getProduct(row.id, { includeInactive: true }), changed };
  });
}

export function listSellerListings(sellerId: string, status?: ProductStatus): ProductDetail[] {
  const rows = status
    ? all<ProductRow>(`${PRODUCT_SELECT} WHERE p.seller_id = ? AND p.status = ? ORDER BY p.created_at DESC, p.rowid DESC`, sellerId, status)
    : all<ProductRow>(`${PRODUCT_SELECT} WHERE p.seller_id = ? ORDER BY p.created_at DESC, p.rowid DESC`, sellerId);
  return rows.map(toDetail);
}

// ─── seller stats ──────────────────────────────────────────────────────────

export const LOW_STOCK_THRESHOLD = 5;

export function sellerStats(sellerId: string): SellerStats {
  const byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
  for (const r of all<{ status: OrderStatus; n: number }>(
    'SELECT status, COUNT(*) AS n FROM orders WHERE seller_id = ? GROUP BY status', sellerId,
  )) {
    byStatus[r.status] = r.n;
  }
  const revenue =
    get<{ cents: number }>(
      "SELECT COALESCE(SUM(total_cents), 0) AS cents FROM orders WHERE seller_id = ? AND status != 'cancelled'", sellerId,
    )?.cents ?? 0;
  const units =
    get<{ units: number }>(
      `SELECT COALESCE(SUM(oi.quantity), 0) AS units FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.seller_id = ? AND o.status != 'cancelled'`,
      sellerId,
    )?.units ?? 0;
  const active =
    get<{ n: number }>("SELECT COUNT(*) AS n FROM products WHERE seller_id = ? AND status = 'active'", sellerId)?.n ?? 0;
  const top = all<{ product_id: string; title: string; emoji: string; units: number; revenue_cents: number }>(
    `SELECT oi.product_id AS product_id, COALESCE(p.title, MAX(oi.title)) AS title, COALESCE(p.emoji, MAX(oi.emoji)) AS emoji,
            SUM(oi.quantity) AS units, SUM(oi.quantity * oi.unit_price_cents) AS revenue_cents
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.seller_id = ? AND o.status != 'cancelled'
      GROUP BY oi.product_id
      ORDER BY units DESC, revenue_cents DESC, title ASC
      LIMIT 5`,
    sellerId,
  ).map((t) => ({ ...t, revenue: formatCents(t.revenue_cents) }));
  const lowStock = all<ProductRow>(
    `${PRODUCT_SELECT} WHERE p.seller_id = ? AND p.status = 'active' AND p.stock <= ? ORDER BY p.stock ASC, p.title ASC`,
    sellerId, LOW_STOCK_THRESHOLD,
  ).map(toSummary);

  return {
    revenue_cents: revenue,
    revenue: formatCents(revenue),
    orders_total: sum(Object.values(byStatus)),
    orders_by_status: byStatus,
    units_sold: units,
    active_listings: active,
    top_products: top,
    low_stock: lowStock,
    needs_shipping: listSellerOrders(sellerId, 'placed', { oldestFirst: true }),
  };
}

// ─── conversations ─────────────────────────────────────────────────────────

export interface ConversationRecord {
  id: string;
  actor: Actor;
  role: Role;
  messages: Anthropic.MessageParam[];
  /** Hash of model + system prompt + tools the stored thinking blocks were produced under (null: none yet). */
  fingerprint: string | null;
  created_at: string;
  updated_at: string;
}

function parseMessages(raw: string): Anthropic.MessageParam[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as Anthropic.MessageParam[]) : [];
  } catch {
    return [];
  }
}

/** One conversation per (actor, role); created on first access. */
export function getOrCreateConversation(actor: Actor): ConversationRecord {
  let row = get<ConversationRow>(
    'SELECT * FROM conversations WHERE actor_id = ? AND role = ? ORDER BY created_at DESC LIMIT 1', actor.id, actor.role,
  );
  if (!row) {
    const now = nowIso();
    const id = newId('conv');
    run(
      "INSERT INTO conversations (id, actor_id, role, messages, prompt_fingerprint, created_at, updated_at) VALUES (?, ?, ?, '[]', NULL, ?, ?)",
      id, actor.id, actor.role, now, now,
    );
    row = get<ConversationRow>('SELECT * FROM conversations WHERE id = ?', id)!;
  }
  return {
    id: row.id,
    actor,
    role: row.role,
    messages: parseMessages(row.messages),
    fingerprint: row.prompt_fingerprint,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function saveConversation(id: string, messages: Anthropic.MessageParam[], fingerprint: string | null): void {
  run(
    'UPDATE conversations SET messages = ?, prompt_fingerprint = ?, updated_at = ? WHERE id = ?',
    JSON.stringify(messages), fingerprint, nowIso(), id,
  );
}

export function deleteConversation(actor: Actor): void {
  run('DELETE FROM conversations WHERE actor_id = ? AND role = ?', actor.id, actor.role);
}
