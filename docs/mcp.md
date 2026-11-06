# Connect an agent over MCP

Any MCP client can shop or sell on Open Marketplace through the same tools the in-app assistants use.

## Endpoint and tokens

The server speaks MCP over stateless Streamable HTTP at `http://localhost:3001/mcp`. Each request gets a fresh MCP server and transport, so there is no session to manage. Only `POST` is supported; `GET` and `DELETE` on `/mcp` return a JSON-RPC "Method not allowed" error.

The token picks who the agent acts as. Send it as `Authorization: Bearer <token>` (or as `X-Marketplace-Token: <token>`). With no token, or an unknown one, the agent acts as the demo buyer.

| Token | Acts as |
|---|---|
| `mk_buyer_demo` | Ada, the demo buyer |
| `mk_seller_demo` | Northwind Goods, the demo seller |
| none or unknown | Ada, the demo buyer |

The examples below assume the server is running on the default port; see [Getting started](getting-started.md).

## Claude Code

```bash
claude mcp add --transport http marketplace http://localhost:3001/mcp --header "Authorization: Bearer mk_buyer_demo"
```

Use `mk_seller_demo` instead to run the Northwind Goods store.

## Claude Desktop

Add the server to `claude_desktop_config.json`, using the `mcp-remote` bridge:

```json
{
  "mcpServers": {
    "marketplace": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:3001/mcp", "--header", "Authorization: Bearer mk_buyer_demo"]
    }
  }
}
```

## Raw JSON-RPC with curl

The transport is stateless, so no session or `initialize` handshake is required:

```bash
curl -s http://localhost:3001/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Authorization: Bearer mk_buyer_demo' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_products","arguments":{"query":"mechanical keyboard","max_price":100}}}'
```

Tool results come back as a text content block holding the JSON output, plus `structuredContent` with the same object. Expected failures, such as an unknown product id or insufficient stock, return `isError: true` with a readable message.

## Resources and prompts

Besides tools, the server exposes read-only resources and prompts.

| Resource | Contents |
|---|---|
| `marketplace://products` | Every active product |
| `marketplace://products/{id}` | Full details for one active product |
| `marketplace://orders` | The buyer's orders, or the orders placed with the seller's store, newest first |

| Prompt | Scope | Arguments | Purpose |
|---|---|---|---|
| `shopping_assistant` | buyer | `need` | Find, compare and recommend products for a need, asking before anything is bought |
| `seller_briefing` | seller | none | A briefing on revenue, orders to ship, low stock and best sellers, with a to-do list |

Actions taken over MCP appear in the app's Activity feed with an MCP badge, and in the other window, exactly like actions taken in chat.

## What agents can do

The token's role decides which tools the server registers. A buyer token sees the buyer tools and the shared tool; a seller token sees the seller tools and the shared tool. A tool outside the caller's scope is not listed, and the registry rejects an out-of-scope call before its handler runs.

The server's instructions remind agents to call `checkout` or `cancel_order` only when the user explicitly asks or confirms, and to confirm before publishing a listing or changing an order.

See [Marketplace tools](tools.md) for every tool by scope, and [`CONTRACT.md`](CONTRACT.md) for exact input and output shapes.

## Security notes

Open Marketplace is a local demo. Read the [security policy](../SECURITY.md) before running it anywhere other than your own machine.

- **The tokens are public demo values, not authentication.** `mk_buyer_demo` and `mk_seller_demo` are published in the documentation, and a request with no token or an unknown token acts as the demo buyer.
- **Browser origins are limited to localhost.** The `/mcp` endpoint rejects, with HTTP 403, any request whose `Origin` header is not `localhost`, `127.0.0.1` or `[::1]` (any port, http or https). This lets browser-based MCP clients on localhost connect and blocks other websites, including DNS-rebinding attacks. Non-browser clients such as Claude Code, `mcp-remote` and curl send no `Origin` header and are unaffected.
- **The Origin check does not protect against other machines.** The server listens on all network interfaces by default, and anyone who can reach its port can use the demo accounts. Do not expose it to the public internet or an untrusted network without adding real authentication, authorization and rate limiting.

## See also

- [Marketplace tools](tools.md)
- [Getting started](getting-started.md)
- [Architecture](architecture.md)
- [Shared contract](CONTRACT.md)
- [Security policy](../SECURITY.md)
