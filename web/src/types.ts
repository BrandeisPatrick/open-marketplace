// Shapes exchanged with the server, copied from docs/CONTRACT.md (§3, §5, §6, §7).
// Keep them in sync with the contract; UI-only additions are at the bottom.

export type Role = 'buyer' | 'seller';

// ── §3 JSON shapes ───────────────────────────────────────────────────────────

export type Actor = { id: string; name: string; role: 'buyer' | 'seller' };

export type ProductSummary = {
  id: string; title: string; price_cents: number; price: string /* "$49.99" */;
  currency: 'USD'; stock: number; category: string; emoji: string;
  rating: number; review_count: number; seller_id: string; seller_name: string;
  status: 'active' | 'draft' | 'archived';
};
export type ProductDetail = ProductSummary & {
  description: string; tags: string[]; created_at: string; updated_at: string;
};
export type Cart = {
  buyer_id: string;
  items: { product: ProductSummary; quantity: number; line_total_cents: number; line_total: string }[];
  item_count: number; subtotal_cents: number; subtotal: string;
};
export type OrderItem = { product_id: string; title: string; emoji: string;
  unit_price_cents: number; unit_price: string; quantity: number; line_total_cents: number };
export type Order = {
  id: string; buyer_id: string; buyer_name: string; seller_id: string; seller_name: string;
  status: 'placed' | 'shipped' | 'delivered' | 'cancelled';
  items: OrderItem[]; subtotal_cents: number; shipping_cents: number;
  total_cents: number; total: string; shipping_address: string | null;
  created_at: string; updated_at: string;
};
export type SellerStats = {
  revenue_cents: number; revenue: string; orders_total: number;
  orders_by_status: Record<Order['status'], number>; units_sold: number;
  active_listings: number;
  top_products: { product_id: string; title: string; emoji: string; units: number; revenue_cents: number; revenue: string }[];
  low_stock: ProductSummary[];          // stock <= 5, active
  needs_shipping: Order[];              // status 'placed'
};
export type Category = { name: string; count: number };

export type OrderStatus = Order['status'];
export type CartLine = Cart['items'][number];

// ── §4 tool outputs (what `tool_result.result` holds when ok) ────────────────

export type SearchProductsOutput = { products: ProductSummary[]; total: number; query: string };
export type ProductOutput = { product: ProductDetail };
export type CartOutput = { cart: Cart; added?: { product: ProductSummary; quantity: number } };
export type CheckoutOutput = { orders: Order[]; total_cents: number; total: string };
export type OrdersOutput = { orders: Order[] };
export type OrderOutput = { order: Order };
export type ListingsOutput = { products: ProductDetail[] };
export type StatsOutput = { stats: SellerStats };
export type CategoriesOutput = { categories: Category[] };

// ── §5 domain events (SSE /api/events) ───────────────────────────────────────

export type EventOrigin = 'chat' | 'mcp' | 'api';

export type MarketplaceEvent = { id: string; at: string /* ISO */ } & (
  | { type: 'product.created'; product: ProductSummary; actor: Actor; source: EventOrigin }
  | { type: 'product.updated'; product: ProductSummary; actor: Actor; source: EventOrigin }
  | { type: 'cart.updated';    cart: Cart; actor: Actor; source: EventOrigin }
  | { type: 'order.created';   order: Order; actor: Actor; source: EventOrigin }
  | { type: 'order.updated';   order: Order; actor: Actor; source: EventOrigin }
  | { type: 'agent.tool_call'; tool: string; actor: Actor; source: 'chat' | 'mcp'; ok: boolean; summary: string }
);
export type MarketplaceEventType = MarketplaceEvent['type'];

// ── §6 REST responses ────────────────────────────────────────────────────────

export type Health = {
  ok: true;
  ai: { enabled: boolean; model: string; effort: string };
  mcp: { path: '/mcp'; url: string; tokens: { buyer: 'mk_buyer_demo'; seller: 'mk_seller_demo' } };
  actors: { buyer: Actor; seller: Actor };
};
export type ProductsResponse = { products: ProductSummary[]; total: number };
export type ConversationResponse = { id: string; role: Role; actor: Actor; items: TranscriptItem[] };

// ── §7 chat streaming protocol ───────────────────────────────────────────────

export type ChatEvent =
  | { type: 'status'; text: string }                                   // optional, e.g. "thinking"
  | { type: 'text_delta'; text: string }                               // append to the current assistant text
  | { type: 'tool_call'; id: string; name: string; input: unknown }     // assistant decided to call a tool
  | { type: 'tool_result'; id: string; name: string; ok: boolean; result: unknown } // result = tool output JSON or error message
  | { type: 'done'; usage?: { input_tokens: number; output_tokens: number } }
  | { type: 'error'; message: string };

export type TranscriptItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant_text'; text: string }
  | { kind: 'tool_call'; id: string; name: string; input: unknown }
  | { kind: 'tool_result'; id: string; name: string; ok: boolean; result: unknown };

// ── UI-only ──────────────────────────────────────────────────────────────────

/** A failed turn (stream `error` event or network failure); never persisted by the server. */
export type ErrorItem = { kind: 'error'; message: string };
export type ChatItem = TranscriptItem | ErrorItem;
export type ToolCallItem = Extract<TranscriptItem, { kind: 'tool_call' }>;
export type ToolResultItem = Extract<TranscriptItem, { kind: 'tool_result' }>;
