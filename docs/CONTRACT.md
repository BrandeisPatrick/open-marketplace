# Open Marketplace — shared contract (server ⇄ web ⇄ MCP)

This file is the single source of truth for the shapes the `server/` and `web/`
packages exchange. Both packages are built against it in parallel; do not
change a shape without updating this file.

## 1. Concept

An AI-first, Amazon-style two-sided marketplace:

- **Chat is the primary interface.** Buyers shop by talking to a shopping
  assistant; sellers run their store by talking to an operations assistant.
  The UI renders rich cards (products, cart, orders, listings, stats) from the
  assistant's tool results — the chat *is* the app, side panels just mirror state.
- **Every marketplace action is a tool.** One registry of tools drives both the
  in-app assistants (Claude via the Anthropic SDK) and the **MCP server**, so any
  external agent (Claude Code, Claude Desktop, a buyer's own agent) can shop or
  sell through the same actions.
- **Two windows, one marketplace.** The UI shows a Buyer window and a Seller
  window side by side. Actions in one (or over MCP) show up live in the other.

Demo actors (seeded):

| actor | id | name | role | MCP token |
|---|---|---|---|---|
| buyer | `usr_ada` | Ada | buyer | `mk_buyer_demo` |
| seller | `usr_northwind` | Northwind Goods | seller | `mk_seller_demo` |
| 2nd seller | `usr_pixelpine` | Pixel & Pine | seller | (none) |

## 2. Data model (SQLite via `node:sqlite`, file `data/marketplace.db`)

```
users(id PK, name, role 'buyer'|'seller', api_token UNIQUE NULL, created_at)
products(id PK, seller_id, title, description, price_cents INT, currency 'USD',
         stock INT, category, tags JSON-array-text, emoji, rating REAL,
         review_count INT, status 'active'|'draft'|'archived', created_at, updated_at)
cart_items(buyer_id, product_id, quantity, PK(buyer_id, product_id))
orders(id PK, buyer_id, seller_id, status 'placed'|'shipped'|'delivered'|'cancelled',
       subtotal_cents, shipping_cents, total_cents, shipping_address, created_at, updated_at)
order_items(order_id, product_id, title, emoji, unit_price_cents, quantity)
conversations(id PK, actor_id, role, messages JSON-text (Anthropic MessageParam[]), prompt_fingerprint,
              mode 'claude'|'offline' (which assistant wrote it; a history from the other mode is discarded on first access),
              created_at, updated_at)
```

IDs: `usr_…`, `prod_…`, `ord_…`, `conv_…` (short random suffix, e.g. 8 base36 chars).
Timestamps: ISO-8601 strings. Money: integer cents plus a formatted string.
Checkout creates **one order per seller** (like Amazon splits shipments).
Shipping: flat `shipping_cents = 0` if subtotal ≥ $35 else 599.

Seed: ~30 active products across categories `electronics`, `home`, `kitchen`,
`books`, `toys`, `outdoors`, `fashion`, `office` (most owned by Northwind, ~8 by
Pixel & Pine), realistic titles/descriptions/prices/stock/rating, each with an
`emoji`. Also seed 3–4 historical orders for Ada (mixed statuses) so the seller
dashboard is not empty. Seeding happens on first run (idempotent).

## 3. JSON shapes (returned by tools, REST and MCP)

```ts
type Actor = { id: string; name: string; role: 'buyer' | 'seller' };

type ProductSummary = {
  id: string; title: string; price_cents: number; price: string /* "$49.99" */;
  currency: 'USD'; stock: number; category: string; emoji: string;
  rating: number; review_count: number; seller_id: string; seller_name: string;
  status: 'active' | 'draft' | 'archived';
};
type ProductDetail = ProductSummary & {
  description: string; tags: string[]; created_at: string; updated_at: string;
};
type Cart = {
  buyer_id: string;
  items: { product: ProductSummary; quantity: number; line_total_cents: number; line_total: string }[];
  item_count: number; subtotal_cents: number; subtotal: string;
};
type OrderItem = { product_id: string; title: string; emoji: string;
  unit_price_cents: number; unit_price: string; quantity: number; line_total_cents: number };
type Order = {
  id: string; buyer_id: string; buyer_name: string; seller_id: string; seller_name: string;
  status: 'placed' | 'shipped' | 'delivered' | 'cancelled';
  items: OrderItem[]; subtotal_cents: number; shipping_cents: number;
  total_cents: number; total: string; shipping_address: string | null;
  created_at: string; updated_at: string;
};
type SellerStats = {
  revenue_cents: number; revenue: string; orders_total: number;
  orders_by_status: Record<Order['status'], number>; units_sold: number;
  active_listings: number;
  top_products: { product_id: string; title: string; emoji: string; units: number; revenue_cents: number; revenue: string }[];
  low_stock: ProductSummary[];          // stock <= 5, active
  needs_shipping: Order[];              // status 'placed'
};
type Category = { name: string; count: number };
```

## 4. Tool registry (shared by chat agents and MCP)

Each tool: `{ name, description, scope: 'buyer'|'seller'|'any', inputSchema (zod v4 object), handler(actor, input) }`.
A buyer conversation / buyer MCP token sees `buyer` + `any` tools; a seller sees
`seller` + `any`. Calling a tool outside your scope throws a ToolError.
Tool errors are thrown as `ToolError(message)` and surface as
`tool_result { is_error: true, content: message }` (chat) / `{ isError: true }` (MCP).
Prices in tool **inputs** are dollars (numbers); outputs always carry cents + formatted.

| name | scope | input | output |
|---|---|---|---|
| `search_products` | buyer | `{ query?: string; category?: string; min_price?: number; max_price?: number; in_stock_only?: boolean; sort?: 'relevance'\|'price_asc'\|'price_desc'\|'rating'; limit?: number (1–20, default 8) }` | `{ products: ProductSummary[]; total: number; query: string }` |
| `get_product` | buyer | `{ product_id: string }` | `{ product: ProductDetail }` |
| `add_to_cart` | buyer | `{ product_id: string; quantity?: number (default 1) }` | `{ cart: Cart; added: { product: ProductSummary; quantity: number } }` |
| `remove_from_cart` | buyer | `{ product_id: string }` | `{ cart: Cart }` |
| `view_cart` | buyer | `{}` | `{ cart: Cart }` |
| `checkout` | buyer | `{ shipping_address?: string }` | `{ orders: Order[]; total_cents: number; total: string }` — empties cart, decrements stock, one order per seller; error if cart empty or stock insufficient |
| `list_orders` | buyer | `{ status?: Order['status'] }` | `{ orders: Order[] }` (newest first) |
| `get_order` | buyer | `{ order_id: string }` | `{ order: Order }` |
| `cancel_order` | buyer | `{ order_id: string }` | `{ order: Order }` — only from `placed`; restores stock |
| `create_listing` | seller | `{ title: string; description: string; price: number; stock: number; category: string; tags?: string[]; emoji?: string; status?: 'active'\|'draft' }` | `{ product: ProductDetail }` |
| `update_listing` | seller | `{ product_id: string; title?; description?; price?; stock?; category?; tags?; emoji?; status?: 'active'\|'draft'\|'archived' }` | `{ product: ProductDetail }` — only own products |
| `list_my_listings` | seller | `{ status?: 'active'\|'draft'\|'archived' }` | `{ products: ProductDetail[] }` |
| `get_seller_orders` | seller | `{ status?: Order['status'] }` | `{ orders: Order[] }` (newest first, only this seller's) |
| `update_order_status` | seller | `{ order_id: string; status: 'shipped'\|'delivered' }` | `{ order: Order }` — placed→shipped→delivered only |
| `seller_stats` | seller | `{}` | `{ stats: SellerStats }` |
| `list_categories` | any | `{}` | `{ categories: Category[] }` |

Search = case-insensitive match over title/description/tags/category with a
simple relevance score (title hits weigh most); filters applied before sort.
Only `active` products are searchable/purchasable.

## 5. Domain events (server-internal bus → SSE `/api/events`)

```ts
type MarketplaceEvent =
  | { type: 'product.created'; product: ProductSummary; actor: Actor; source: 'chat'|'mcp'|'api' }
  | { type: 'product.updated'; product: ProductSummary; actor: Actor; source }
  | { type: 'cart.updated';    cart: Cart; actor: Actor; source }
  | { type: 'order.created';   order: Order; actor: Actor; source }
  | { type: 'order.updated';   order: Order; actor: Actor; source }
  | { type: 'agent.tool_call'; tool: string; actor: Actor; source: 'chat'|'mcp'; ok: boolean; summary: string };
// every event also carries  id: string; at: string (ISO)
```
`source` is `'chat'` for the in-app assistants, `'mcp'` for external agents,
`'api'` for REST. `agent.tool_call` fires for every tool execution (both
sources) with a one-line human summary, e.g. `Ada searched for "mechanical keyboard" (5 results)`.

## 6. REST API (Express 5, JSON, port `PORT` default 3001)

| method & path | response |
|---|---|
| `GET /api/health` | `{ ok: true, ai: { enabled: boolean; model: string; effort: string }, mcp: { path: '/mcp'; url: string; tokens: { buyer: 'mk_buyer_demo'; seller: 'mk_seller_demo' } }, actors: { buyer: Actor; seller: Actor } }` |
| `GET /api/products?q=&category=&limit=` | `{ products: ProductSummary[]; total }` |
| `GET /api/products/:id` | `{ product: ProductDetail }` |
| `GET /api/categories` | `{ categories: Category[] }` |
| `GET /api/buyer/cart` | `{ cart: Cart }` (demo buyer) |
| `GET /api/buyer/orders` | `{ orders: Order[] }` |
| `GET /api/seller/listings` | `{ products: ProductDetail[] }` (demo seller) |
| `GET /api/seller/orders` | `{ orders: Order[] }` |
| `GET /api/seller/stats` | `{ stats: SellerStats }` |
| `GET /api/events` | SSE: `event: <type>\ndata: <MarketplaceEvent JSON>\n\n`, plus `event: ping` / `data: {}` every 15s as a liveness signal; the web client reopens a stream that stays silent for 40s (a dev proxy can keep the browser's connection open after the API server restarted) |
| `GET /api/conversations/:role` | `{ id: string; role; actor: Actor; items: TranscriptItem[] }` (role = `buyer`\|`seller`, one conversation per demo actor; a history written in the other assistant mode, offline helper vs Claude, is discarded, so switching modes starts fresh) |
| `DELETE /api/conversations/:role` | `{ ok: true }` — clears history |
| `POST /api/chat` body `{ role: 'buyer'\|'seller'; message: string }` | **SSE stream** (see §7) |

CORS enabled for `http://localhost:5173`. In production (`npm start`) the
server also serves `web/dist` at `/` with an SPA fallback.

## 7. Chat streaming protocol (`POST /api/chat`)

Response is `Content-Type: text/event-stream`; each event is a line
`data: <JSON>\n\n` (no `event:` field, the JSON has `type`). Order of events
for one assistant turn:

```ts
type ChatEvent =
  | { type: 'status'; text: string }                                   // optional, e.g. "thinking"
  | { type: 'text_delta'; text: string }                               // append to the current assistant text
  | { type: 'tool_call'; id: string; name: string; input: unknown }     // assistant decided to call a tool
  | { type: 'tool_result'; id: string; name: string; ok: boolean; result: unknown } // result = tool output JSON or error message
  | { type: 'done'; usage?: { input_tokens: number; output_tokens: number } }
  | { type: 'error'; message: string };
```
A turn may interleave several `text_delta` runs and tool calls; the client
starts a new assistant text bubble after each `tool_result`. `done` or `error`
always ends the stream. Transcript items the server persists/replays:

```ts
type TranscriptItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant_text'; text: string }
  | { kind: 'tool_call'; id: string; name: string; input: unknown }
  | { kind: 'tool_result'; id: string; name: string; ok: boolean; result: unknown };
```

**Offline mode** (no `ANTHROPIC_API_KEY`): the same endpoint streams the same
event types, produced by a small rule-based fallback (keyword search, cart,
orders, listings, stats) so the UI is demo-able without a key; its first text
explains that the AI assistant is off and how to enable it.

## 8. MCP server (`POST /mcp`, Streamable HTTP, stateless)

- `@modelcontextprotocol/sdk` `McpServer` named `open-marketplace`; a fresh
  server+transport per request (`sessionIdGenerator: undefined`); `GET`/`DELETE /mcp`
  return the JSON-RPC "Method not allowed" shape.
- Identity: `Authorization: Bearer <token>` or `X-Marketplace-Token: <token>`
  where the token is a user's `api_token`; no/unknown token → demo buyer.
  The actor's scope decides which tools are registered.
- Tools: the registry above (zod shapes → `registerTool`). Results: `content:[{type:'text', text: JSON}]`
  plus `structuredContent` with the same object; errors → `isError: true`.
- Resources: `marketplace://products` (all active ProductSummary JSON),
  `marketplace://products/{id}` (ProductDetail), `marketplace://orders` (actor's orders).
- Prompts: `shopping_assistant` (arg `need`), `seller_briefing` (no args).
- Connect from Claude Code:
  `claude mcp add --transport http marketplace http://localhost:3001/mcp --header "Authorization: Bearer mk_buyer_demo"`

## 9. Web app (Vite + React 19 + TypeScript + Tailwind 4, port 5173)

- Dev server proxies `/api` and `/mcp` to `http://localhost:3001`.
- Layout: header (name, AI status pill from `/api/health`, MCP endpoint pill with copy
  button, activity toggle) → two columns: **Buyer window** (left) and **Seller window**
  (right); on narrow screens a tab switch. A collapsible **Activity** strip/drawer lists
  live events from `/api/events` (newest first, show `source` badge: Chat / MCP / API).
- Each window: persona header (avatar initial, name, role), transcript, composer with
  3–4 suggestion chips, and a collapsible side panel: buyer → cart + recent orders;
  seller → listings + orders needing shipping + stats tiles. Panels refetch on events.
- Transcript rendering: user bubble; assistant markdown (react-markdown); tool chips
  ("Searching products…" → "Found 5 products") and **cards** keyed by tool name:
  product grid (`search_products`, `list_my_listings`), product detail (`get_product`,
  `create_listing`, `update_listing`), cart (`add_to_cart`, `remove_from_cart`, `view_cart`),
  order cards (`checkout`, `list_orders`, `get_order`, `cancel_order`, `get_seller_orders`,
  `update_order_status`), stats tiles (`seller_stats`), category chips (`list_categories`).
  Error results render as a small red chip with the message.
- Offline banner when `health.ai.enabled === false`.
