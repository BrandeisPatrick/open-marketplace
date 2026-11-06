# Marketplace tools

Every marketplace action is one of 16 tools: 9 for buyers, 6 for sellers and 1 shared, each called the same way from chat and over MCP.

## Conventions

These hold for every tool:

- **One definition serves chat and MCP.** Each tool is defined once in `server/src/marketplace/tools.ts` as a zod input schema plus a handler. The same definition becomes an Anthropic tool definition for the in-app assistants and an MCP tool, and every call from either side goes through one `executeTool` path with the same input validation, scope checks, domain events and one-line activity summary.
- **Prices in dollars in, cents out.** Prices in tool inputs are US dollars. Outputs always carry integer cents plus a formatted string.
- **Scope checks.** Each tool has a scope of `buyer`, `seller` or `any`. Buyers see buyer and shared tools, sellers see seller and shared tools, and an out-of-scope call fails before the handler runs. Over MCP, the token decides the scope; see [Connect an agent over MCP](mcp.md#what-agents-can-do).
- **Read-only and additive hints.** Tools that never change state are marked read-only, and tools that only add state are marked additive. Over MCP these become the `readOnlyHint` and `destructiveHint` annotations: read-only tools carry `readOnlyHint: true`, additive tools carry `destructiveHint: false`, and every other tool that changes state carries `destructiveHint: true`.
- **Live updates.** A tool that changes state emits a domain event, so the other window and the Activity feed update immediately, whichever side made the call.

The exact input and output shapes of every tool are in [`CONTRACT.md`](CONTRACT.md#4-tool-registry-shared-by-chat-agents-and-mcp).

## Buyer tools

| Tool | Purpose |
|---|---|
| `search_products` | Keyword search over titles, descriptions, tags and categories, with price, category and stock filters and sorting |
| `get_product` | Full details for one product |
| `add_to_cart` | Add a product (or more units of it) to the cart, within available stock |
| `remove_from_cart` | Remove a product line from the cart |
| `view_cart` | Cart lines, quantities and subtotal |
| `checkout` | Place the order: one order per seller, flat $5.99 shipping under $35, stock decremented, cart emptied |
| `list_orders` | The buyer's orders, newest first |
| `get_order` | One order with items and status |
| `cancel_order` | Cancel an order that has not shipped; stock is restored |

## Seller tools

| Tool | Purpose |
|---|---|
| `create_listing` | Publish (or save as a draft) a new listing |
| `update_listing` | Change price, stock, copy, category, tags or status of an own listing |
| `list_my_listings` | The seller's listings with stock and status |
| `get_seller_orders` | Orders placed with the store, filterable by status |
| `update_order_status` | Advance an order: placed → shipped → delivered |
| `seller_stats` | Revenue, orders by status, units sold, top products, low stock, orders to ship |

## Shared tools

| Tool | Purpose |
|---|---|
| `list_categories` | Categories with active product counts |

`list_categories` has scope `any`, so both buyers and sellers can call it.

## See also

- [Connect an agent over MCP](mcp.md)
- [Architecture](architecture.md)
- [Shared contract](CONTRACT.md)
- [Contributing guide](../CONTRIBUTING.md), including how to add a marketplace tool
