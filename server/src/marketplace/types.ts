// Shapes shared by tools, REST, MCP and the chat stream. Mirrors docs/CONTRACT.md §3, §5 and §7.

export const CATEGORIES = ['electronics', 'home', 'kitchen', 'books', 'toys', 'outdoors', 'fashion', 'office'] as const;
export type CategoryName = (typeof CATEGORIES)[number];

export const ORDER_STATUSES = ['placed', 'shipped', 'delivered', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PRODUCT_STATUSES = ['active', 'draft', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const SORT_KEYS = ['relevance', 'price_asc', 'price_desc', 'rating'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export type Role = 'buyer' | 'seller';

/** Which assistant wrote a stored conversation: the Claude agent or the offline keyword helper. */
export type ConversationMode = 'claude' | 'offline';

export interface Actor {
  id: string;
  name: string;
  role: Role;
}

export interface ProductSummary {
  id: string;
  title: string;
  price_cents: number;
  price: string;
  currency: 'USD';
  stock: number;
  category: string;
  emoji: string;
  rating: number;
  review_count: number;
  seller_id: string;
  seller_name: string;
  status: ProductStatus;
}

export interface ProductDetail extends ProductSummary {
  description: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface CartLine {
  product: ProductSummary;
  quantity: number;
  line_total_cents: number;
  line_total: string;
}

export interface Cart {
  buyer_id: string;
  items: CartLine[];
  item_count: number;
  subtotal_cents: number;
  subtotal: string;
}

export interface OrderItem {
  product_id: string;
  title: string;
  emoji: string;
  unit_price_cents: number;
  unit_price: string;
  quantity: number;
  line_total_cents: number;
}

export interface Order {
  id: string;
  buyer_id: string;
  buyer_name: string;
  seller_id: string;
  seller_name: string;
  status: OrderStatus;
  items: OrderItem[];
  subtotal_cents: number;
  shipping_cents: number;
  total_cents: number;
  total: string;
  shipping_address: string | null;
  created_at: string;
  updated_at: string;
}

export interface TopProduct {
  product_id: string;
  title: string;
  emoji: string;
  units: number;
  revenue_cents: number;
  revenue: string;
}

export interface SellerStats {
  revenue_cents: number;
  revenue: string;
  orders_total: number;
  orders_by_status: Record<OrderStatus, number>;
  units_sold: number;
  active_listings: number;
  top_products: TopProduct[];
  low_stock: ProductSummary[];
  needs_shipping: Order[];
}

export interface Category {
  name: string;
  count: number;
}

/** Where an action came from: the in-app assistants, an external MCP agent, or the REST API. */
export type EventSource = 'chat' | 'mcp' | 'api';
/** Tool executions only ever come from an agent. */
export type AgentSource = 'chat' | 'mcp';

export type MarketplaceEventBody =
  | { type: 'product.created'; product: ProductSummary; actor: Actor; source: EventSource }
  | { type: 'product.updated'; product: ProductSummary; actor: Actor; source: EventSource }
  | { type: 'cart.updated'; cart: Cart; actor: Actor; source: EventSource }
  | { type: 'order.created'; order: Order; actor: Actor; source: EventSource }
  | { type: 'order.updated'; order: Order; actor: Actor; source: EventSource }
  | { type: 'agent.tool_call'; tool: string; actor: Actor; source: AgentSource; ok: boolean; summary: string };

export type MarketplaceEvent = MarketplaceEventBody & { id: string; at: string };
export type MarketplaceEventType = MarketplaceEvent['type'];

export type ChatEvent =
  | { type: 'status'; text: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; result: unknown }
  | { type: 'done'; usage?: { input_tokens: number; output_tokens: number } }
  | { type: 'error'; message: string };

export type TranscriptItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant_text'; text: string }
  | { kind: 'tool_call'; id: string; name: string; input: unknown }
  | { kind: 'tool_result'; id: string; name: string; ok: boolean; result: unknown };

/**
 * A user-facing failure of a marketplace action (bad input, out of scope, not found, out of stock...).
 * The message is shown to the model (tool_result is_error) and to MCP clients (isError), so keep it readable.
 */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}
