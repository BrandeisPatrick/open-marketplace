// One registry of marketplace actions. The in-app assistants (Anthropic tool use) and the MCP server
// both execute tools through `executeTool`, so validation, scope checks and events are identical.
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { events } from '../events.js';
import { dollarsToCents, formatCents, plural, truncate } from './format.js';
import * as store from './store.js';
import {
  CATEGORIES,
  ORDER_STATUSES,
  SORT_KEYS,
  ToolError,
  type Actor,
  type AgentSource,
  type Order,
  type ProductSummary,
  type Role,
} from './types.js';

export { ToolError } from './types.js';

export type ToolScope = 'buyer' | 'seller' | 'any';

export interface ToolContext {
  source: AgentSource;
}

export interface ToolDef<S extends z.ZodObject = z.ZodObject, O extends object = object> {
  name: string;
  /** Short human title (MCP `title`). */
  title: string;
  /** Written for an LLM: what it does, when to use it, units. */
  description: string;
  scope: ToolScope;
  /** Never changes marketplace state (MCP readOnlyHint). */
  readOnly?: boolean;
  /** Only adds state, never removes or overwrites it (MCP destructiveHint: false). */
  additive?: boolean;
  inputSchema: S;
  handler(actor: Actor, input: z.output<S>, ctx: ToolContext): O;
  /** One-line human summary for the activity feed, e.g. `Ada searched for "mechanical keyboard" (5 results)`. */
  summarize(actor: Actor, input: z.output<S>, output: O): string;
}

export type AnyTool = ToolDef<z.ZodObject, object>;

export function defineTool<S extends z.ZodObject, O extends object>(def: ToolDef<S, O>): ToolDef<S, O> {
  return def;
}

// ─── shared schema pieces ──────────────────────────────────────────────────

const productId = z.string().trim().min(1).describe('Product id from a search or listing result, e.g. "prod_ab12cd34".');
const orderId = z.string().trim().min(1).describe('Order id, e.g. "ord_ab12cd34".');
const category = z.enum(CATEGORIES);
const orderStatus = z.enum(ORDER_STATUSES);
const usd = (n: number) => formatCents(dollarsToCents(n));

function emitProductUpdates(actor: Actor, source: AgentSource, ids: string[]): void {
  for (const product of store.getProductSummaries(ids)) {
    events.emit({ type: 'product.updated', product, actor, source });
  }
}

const itemIds = (orders: Order[]) => orders.flatMap((o) => o.items.map((i) => i.product_id));

// ─── buyer tools ───────────────────────────────────────────────────────────

const searchProducts = defineTool({
  name: 'search_products',
  title: 'Search products',
  scope: 'buyer',
  readOnly: true,
  description:
    'Search the marketplace catalog of active products. Matches keywords against titles, descriptions, tags and ' +
    'categories (title matches rank highest). Use it whenever the shopper describes something they want, even vaguely: ' +
    'put 1-4 key words in `query` (e.g. "mechanical keyboard", "coffee", "gift") and express constraints with the ' +
    'filters instead of in the query: max_price for "under $50", category to narrow, sort for "cheapest" or ' +
    '"best rated", in_stock_only when they need it now. Price filters are US dollars. Results carry price_cents ' +
    'plus a formatted price string, stock, rating and seller. Returns up to `limit` products and the `total` number ' +
    'of matches; if results are thin, search again with different or broader words.',
  inputSchema: z.object({
    query: z.string().trim().max(200).optional()
      .describe('Keywords, e.g. "mechanical keyboard". Omit to browse (for example a whole category).'),
    category: category.optional().describe('Only return products in this category.'),
    min_price: z.number().min(0).optional().describe('Minimum price in US dollars, inclusive.'),
    max_price: z.number().min(0).optional().describe('Maximum price in US dollars, inclusive (50 for "under $50").'),
    in_stock_only: z.boolean().optional().describe('Only return products with at least one unit in stock.'),
    sort: z.enum(SORT_KEYS).optional()
      .describe('relevance (default; best match first, or highest rated when there is no query), price_asc, price_desc or rating.'),
    limit: z.number().int().min(1).max(20).default(8).describe('Maximum number of products to return (1-20).'),
  }),
  handler(_actor, input) {
    if (input.min_price !== undefined && input.max_price !== undefined && input.min_price > input.max_price) {
      throw new ToolError('min_price is greater than max_price.');
    }
    return store.searchProducts({
      query: input.query,
      category: input.category,
      minPriceCents: input.min_price === undefined ? undefined : dollarsToCents(input.min_price),
      maxPriceCents: input.max_price === undefined ? undefined : dollarsToCents(input.max_price),
      inStockOnly: input.in_stock_only,
      sort: input.sort,
      limit: input.limit,
    });
  },
  summarize(actor, input, out) {
    const what = input.query ? `searched for "${input.query}"` : `browsed ${input.category ?? 'the catalog'}`;
    const filters = [
      input.query && input.category ? `in ${input.category}` : '',
      input.min_price !== undefined ? `from ${usd(input.min_price)}` : '',
      input.max_price !== undefined ? `under ${usd(input.max_price)}` : '',
    ].filter(Boolean);
    return `${actor.name} ${what}${filters.length ? ` ${filters.join(' ')}` : ''} (${plural(out.total, 'result')})`;
  },
});

const getProduct = defineTool({
  name: 'get_product',
  title: 'Get product details',
  scope: 'buyer',
  readOnly: true,
  description:
    'Get full details for one product: description, tags, stock, rating, review count and seller. Use it before ' +
    'recommending a specific item in depth or when the shopper asks about specifics that search results do not show.',
  inputSchema: z.object({ product_id: productId }),
  handler: (_actor, input) => ({ product: store.getProduct(input.product_id) }),
  summarize: (actor, _input, out) => `${actor.name} viewed "${truncate(out.product.title, 60)}"`,
});

const addToCart = defineTool({
  name: 'add_to_cart',
  title: 'Add to cart',
  scope: 'buyer',
  additive: true,
  description:
    "Add a product to the shopper's cart, or increase its quantity if it is already there. Call it when the shopper " +
    'asks to add or buy an item, or agrees to your suggestion. The total quantity in the cart cannot exceed the ' +
    'available stock. Returns the updated cart (line totals and subtotal in cents plus formatted strings).',
  inputSchema: z.object({
    product_id: productId,
    quantity: z.number().int().min(1).max(99).default(1).describe('Units to add (default 1).'),
  }),
  handler(actor, input, ctx) {
    const result = store.addToCart(actor.id, input.product_id, input.quantity);
    events.emit({ type: 'cart.updated', cart: result.cart, actor, source: ctx.source });
    return result;
  },
  summarize: (actor, _input, out) =>
    `${actor.name} added ${out.added.quantity} × ${truncate(out.added.product.title, 50)} to the cart`,
});

const removeFromCart = defineTool({
  name: 'remove_from_cart',
  title: 'Remove from cart',
  scope: 'buyer',
  description: "Remove a product line (all units of it) from the shopper's cart. Returns the updated cart.",
  inputSchema: z.object({ product_id: productId }),
  handler(actor, input, ctx) {
    const { cart } = store.removeFromCart(actor.id, input.product_id);
    events.emit({ type: 'cart.updated', cart, actor, source: ctx.source });
    return { cart };
  },
  summarize(actor, input) {
    const title = store.getProductSummaries([input.product_id])[0]?.title ?? input.product_id;
    return `${actor.name} removed ${truncate(title, 50)} from the cart`;
  },
});

const viewCart = defineTool({
  name: 'view_cart',
  title: 'View cart',
  scope: 'buyer',
  readOnly: true,
  description:
    "Show the shopper's cart: items, quantities, line totals and subtotal. Shipping is added at checkout: each " +
    "seller's items become a separate order, free at $35 or more, otherwise $5.99 per order.",
  inputSchema: z.object({}),
  handler: (actor) => ({ cart: store.getCart(actor.id) }),
  summarize: (actor, _input, out) =>
    `${actor.name} viewed the cart (${plural(out.cart.item_count, 'item')}, ${out.cart.subtotal})`,
});

const checkout = defineTool({
  name: 'checkout',
  title: 'Check out',
  scope: 'buyer',
  description:
    'Place orders for everything in the cart. Creates one order per seller (like separate shipments), adds flat ' +
    'shipping of $5.99 to each seller order under $35 (free at $35 or more), decrements stock and empties the cart. ' +
    'Fails if the cart is empty or an item no longer has enough stock. IMPORTANT: only call this when the shopper ' +
    'has explicitly asked to check out or place the order, or has just confirmed your proposal to do so. Never call ' +
    'it on your own initiative. shipping_address is optional; without it the address from the most recent order is used.',
  inputSchema: z.object({
    shipping_address: z.string().trim().min(5).max(300).optional()
      .describe('Full shipping address, only if the shopper gave one.'),
  }),
  handler(actor, input, ctx) {
    const result = store.checkout(actor.id, input.shipping_address);
    for (const order of result.orders) events.emit({ type: 'order.created', order, actor, source: ctx.source });
    events.emit({ type: 'cart.updated', cart: store.getCart(actor.id), actor, source: ctx.source });
    emitProductUpdates(actor, ctx.source, itemIds(result.orders));
    return result;
  },
  summarize: (actor, _input, out) =>
    `${actor.name} checked out: ${plural(out.orders.length, 'order')} totaling ${out.total}`,
});

const listOrders = defineTool({
  name: 'list_orders',
  title: 'List orders',
  scope: 'buyer',
  readOnly: true,
  description:
    "List the shopper's orders, newest first, with items, totals and status (placed, shipped, delivered or cancelled). " +
    'Optionally filter by status.',
  inputSchema: z.object({ status: orderStatus.optional().describe('Only orders with this status.') }),
  handler: (actor, input) => ({ orders: store.listBuyerOrders(actor.id, input.status) }),
  summarize: (actor, input, out) =>
    `${actor.name} checked ${input.status ? `${input.status} ` : ''}orders (${out.orders.length})`,
});

const getOrder = defineTool({
  name: 'get_order',
  title: 'Get order',
  scope: 'buyer',
  readOnly: true,
  description: "Get one of the shopper's orders by id, with items, totals, shipping address and status.",
  inputSchema: z.object({ order_id: orderId }),
  handler: (actor, input) => ({ order: store.getBuyerOrder(actor.id, input.order_id) }),
  summarize: (actor, _input, out) => `${actor.name} viewed order ${out.order.id} (${out.order.status})`,
});

const cancelOrder = defineTool({
  name: 'cancel_order',
  title: 'Cancel order',
  scope: 'buyer',
  description:
    "Cancel one of the shopper's orders. Only orders that are still 'placed' (not yet shipped) can be cancelled; " +
    'the stock goes back to the seller. Only call this when the shopper explicitly asked to cancel that order or ' +
    'confirmed your proposal to do so.',
  inputSchema: z.object({ order_id: orderId }),
  handler(actor, input, ctx) {
    const order = store.cancelOrder(actor.id, input.order_id);
    events.emit({ type: 'order.updated', order, actor, source: ctx.source });
    emitProductUpdates(actor, ctx.source, itemIds([order]));
    return { order };
  },
  summarize: (actor, _input, out) => `${actor.name} cancelled order ${out.order.id} (${out.order.total})`,
});

// ─── seller tools ──────────────────────────────────────────────────────────

const listingFields = {
  title: z.string().trim().min(3).max(120).describe('Specific, honest product title (under ~80 characters is best).'),
  description: z.string().trim().min(10).max(2000).describe('2-4 sentences. Only facts the seller provided; no invented specs.'),
  price: z.number().positive().max(100_000).describe('Price in US dollars, e.g. 24.99.'),
  stock: z.number().int().min(0).max(100_000).describe('Units on hand (absolute number, not a change).'),
  category,
  tags: z.array(z.string().trim().min(1).max(30)).max(10).describe('3-6 short lowercase search tags.'),
  emoji: z.string().trim().min(1).max(16).describe('One emoji shown as the product image, e.g. "🕯️".'),
};

const createListing = defineTool({
  name: 'create_listing',
  title: 'Create listing',
  scope: 'seller',
  additive: true,
  description:
    "Publish a new product listing in the seller's store. Only call this after the seller approved the draft you " +
    'showed them (title, description, price, stock, category, tags), or if they explicitly said to just list it. ' +
    'price is in US dollars; stock is units on hand. status defaults to "active" (visible to buyers immediately); ' +
    'use "draft" to save it unpublished. Keep the copy honest: never invent specs the seller did not give you. ' +
    'Returns the created product.',
  inputSchema: z.object({
    ...listingFields,
    tags: listingFields.tags.optional(),
    emoji: listingFields.emoji.optional(),
    status: z.enum(['active', 'draft']).optional().describe('"active" (default) publishes now; "draft" saves it unpublished.'),
  }),
  handler(actor, input, ctx) {
    const product = store.createListing(actor.id, {
      title: input.title,
      description: input.description,
      priceCents: dollarsToCents(input.price),
      stock: input.stock,
      category: input.category,
      tags: input.tags,
      emoji: input.emoji,
      status: input.status,
    });
    events.emit({ type: 'product.created', product: summaryOf(product), actor, source: ctx.source });
    return { product };
  },
  summarize: (actor, _input, out) =>
    out.product.status === 'draft'
      ? `${actor.name} saved a draft listing "${truncate(out.product.title, 50)}"`
      : `${actor.name} listed "${truncate(out.product.title, 50)}" at ${out.product.price}`,
});

const updateListing = defineTool({
  name: 'update_listing',
  title: 'Update listing',
  scope: 'seller',
  description:
    "Change fields on one of the seller's own listings: price (US dollars), stock (the new absolute number of units " +
    'on hand, not a delta), title, description, tags, category, emoji, or status ("active" to publish, "draft" to ' +
    'unpublish, "archived" to retire it). Only the fields you pass are changed. Fails for products owned by other sellers.',
  inputSchema: z.object({
    product_id: productId,
    title: listingFields.title.optional(),
    description: listingFields.description.optional(),
    price: listingFields.price.optional(),
    stock: listingFields.stock.optional(),
    category: category.optional(),
    tags: listingFields.tags.optional(),
    emoji: listingFields.emoji.optional(),
    status: z.enum(['active', 'draft', 'archived']).optional(),
  }),
  handler(actor, input, ctx) {
    const { product_id, price, ...rest } = input;
    const patch = { ...rest, priceCents: price === undefined ? undefined : dollarsToCents(price) };
    if (Object.values(patch).every((v) => v === undefined)) {
      throw new ToolError('Nothing to update. Pass at least one field to change (e.g. price or stock).');
    }
    const { product, changed } = store.updateListing(actor.id, product_id, stripUndefined(patch));
    if (changed.length > 0) events.emit({ type: 'product.updated', product: summaryOf(product), actor, source: ctx.source });
    return { product };
  },
  summarize(actor, input, out) {
    const parts = [
      input.price !== undefined ? `price ${out.product.price}` : '',
      input.stock !== undefined ? `stock ${out.product.stock}` : '',
      input.status !== undefined ? `status ${out.product.status}` : '',
      ['title', 'description', 'tags', 'category', 'emoji'].some((k) => input[k as keyof typeof input] !== undefined)
        ? 'details'
        : '',
    ].filter(Boolean);
    return `${actor.name} updated "${truncate(out.product.title, 50)}" (${parts.join(', ')})`;
  },
});

const listMyListings = defineTool({
  name: 'list_my_listings',
  title: 'List my listings',
  scope: 'seller',
  readOnly: true,
  description:
    "List the seller's own listings, newest first, with full details including price, stock and status. Shows every " +
    'status unless filtered. Useful for inventory questions and for pricing a new item against similar ones.',
  inputSchema: z.object({ status: z.enum(['active', 'draft', 'archived']).optional().describe('Only listings with this status.') }),
  handler: (actor, input) => ({ products: store.listSellerListings(actor.id, input.status) }),
  summarize: (actor, input, out) =>
    `${actor.name} reviewed ${input.status ? `${input.status} ` : ''}listings (${out.products.length})`,
});

const getSellerOrders = defineTool({
  name: 'get_seller_orders',
  title: 'Get store orders',
  scope: 'seller',
  readOnly: true,
  description:
    "List orders placed with this seller's store, newest first, with buyer, items, totals, shipping address and " +
    'status. Use status "placed" to see orders that still need to be shipped.',
  inputSchema: z.object({ status: orderStatus.optional().describe('Only orders with this status.') }),
  handler: (actor, input) => ({ orders: store.listSellerOrders(actor.id, input.status) }),
  summarize: (actor, input, out) =>
    `${actor.name} checked ${input.status ? `${input.status} ` : ''}store orders (${out.orders.length})`,
});

const updateOrderStatus = defineTool({
  name: 'update_order_status',
  title: 'Update order status',
  scope: 'seller',
  description:
    "Advance one of the store's orders one step: placed → shipped, or shipped → delivered. Cancelled and delivered " +
    'orders cannot change. Use it when the seller says they shipped or delivered an order (or confirms your proposal).',
  inputSchema: z.object({
    order_id: orderId,
    status: z.enum(['shipped', 'delivered']).describe('The new status.'),
  }),
  handler(actor, input, ctx) {
    const order = store.updateOrderStatus(actor.id, input.order_id, input.status);
    events.emit({ type: 'order.updated', order, actor, source: ctx.source });
    return { order };
  },
  summarize: (actor, _input, out) => `${actor.name} marked order ${out.order.id} as ${out.order.status}`,
});

const sellerStats = defineTool({
  name: 'seller_stats',
  title: 'Store stats',
  scope: 'seller',
  readOnly: true,
  description:
    "The seller's store dashboard: revenue from non-cancelled orders (including shipping), order counts by status, " +
    'units sold, active listings, top products, low-stock listings (5 units or fewer) and orders waiting to ship ' +
    '(oldest first). Use it for questions about sales, revenue, best sellers, "how am I doing" or what needs attention.',
  inputSchema: z.object({}),
  handler: (actor) => ({ stats: store.sellerStats(actor.id) }),
  summarize: (actor, _input, out) =>
    `${actor.name} checked store stats (${out.stats.revenue} revenue, ${out.stats.needs_shipping.length} to ship)`,
});

// ─── shared tools ──────────────────────────────────────────────────────────

const listCategories = defineTool({
  name: 'list_categories',
  title: 'List categories',
  scope: 'any',
  readOnly: true,
  description: 'List the marketplace product categories with the number of active products in each.',
  inputSchema: z.object({}),
  handler: () => ({ categories: store.listCategories() }),
  summarize: (actor) => `${actor.name} browsed the categories`,
});

// ─── registry ──────────────────────────────────────────────────────────────

export const TOOLS: readonly AnyTool[] = [
  searchProducts,
  getProduct,
  addToCart,
  removeFromCart,
  viewCart,
  checkout,
  listOrders,
  getOrder,
  cancelOrder,
  createListing,
  updateListing,
  listMyListings,
  getSellerOrders,
  updateOrderStatus,
  sellerStats,
  listCategories,
];

const TOOL_INDEX = new Map(TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): AnyTool | undefined {
  return TOOL_INDEX.get(name);
}

export function inScope(tool: AnyTool, role: Role): boolean {
  return tool.scope === 'any' || tool.scope === role;
}

/** Buyers see buyer + any tools; sellers see seller + any tools. Order is stable (prompt caching depends on it). */
export function toolsForActor(actor: Actor | Role): AnyTool[] {
  const role = typeof actor === 'string' ? actor : actor.role;
  return TOOLS.filter((t) => inScope(t, role));
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ');
}

/**
 * Validates, checks scope, runs the handler and emits an `agent.tool_call` event (ok or not).
 * Throws ToolError with a readable message on any failure; returns the tool's output object.
 */
export function executeTool(actor: Actor, name: string, rawInput: unknown, source: AgentSource): object {
  const fail = (message: string): never => {
    events.emit({
      type: 'agent.tool_call',
      tool: name,
      actor,
      source,
      ok: false,
      summary: `${actor.name}'s ${name} call failed: ${truncate(message, 160)}`,
    });
    throw new ToolError(message);
  };

  const tool = TOOL_INDEX.get(name);
  if (!tool) return fail(`Unknown tool "${name}".`);
  if (!inScope(tool, actor.role)) {
    return fail(`${name} is only available to ${tool.scope}s, and ${actor.name} is a ${actor.role}.`);
  }
  const parsed = tool.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) return fail(`Invalid input for ${name}: ${formatIssues(parsed.error)}`);

  let output: object;
  try {
    output = tool.handler(actor, parsed.data, { source });
  } catch (err) {
    if (err instanceof ToolError) return fail(err.message);
    console.error(`[tools] ${name} failed unexpectedly:`, err);
    return fail(`Internal error while running ${name}. Please try again.`);
  }

  let summary: string;
  try {
    summary = tool.summarize(actor, parsed.data, output);
  } catch {
    summary = `${actor.name} used ${name}`;
  }
  events.emit({ type: 'agent.tool_call', tool: name, actor, source, ok: true, summary });
  return output;
}

/** JSON Schema (draft 2020-12, input side so defaulted fields stay optional) for a tool's input. */
export function inputJsonSchema(tool: AnyTool): Anthropic.Tool.InputSchema {
  const schema = z.toJSONSchema(tool.inputSchema, { io: 'input' }) as Record<string, unknown>;
  delete schema.$schema;
  if (schema.type !== 'object') throw new Error(`Tool ${tool.name} input schema is not an object schema`);
  return schema as Anthropic.Tool.InputSchema;
}

const anthropicDefsCache = new Map<Role, Anthropic.Tool[]>();

/** Anthropic tool definitions for an actor's scope; built once per role so every request sends identical bytes. */
export function anthropicToolDefs(actor: Actor | Role): Anthropic.Tool[] {
  const role = typeof actor === 'string' ? actor : actor.role;
  let defs = anthropicDefsCache.get(role);
  if (!defs) {
    defs = toolsForActor(role).map((t) => ({ name: t.name, description: t.description, input_schema: inputJsonSchema(t) }));
    anthropicDefsCache.set(role, defs);
  }
  return defs;
}

// ─── helpers ───────────────────────────────────────────────────────────────

function summaryOf(p: ProductSummary): ProductSummary {
  return {
    id: p.id,
    title: p.title,
    price_cents: p.price_cents,
    price: p.price,
    currency: p.currency,
    stock: p.stock,
    category: p.category,
    emoji: p.emoji,
    rating: p.rating,
    review_count: p.review_count,
    seller_id: p.seller_id,
    seller_name: p.seller_name,
    status: p.status,
  };
}

function stripUndefined<T extends object>(obj: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}
