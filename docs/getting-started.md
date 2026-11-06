# Getting started

Install Open Marketplace, run it locally with or without an Anthropic API key, and walk through the buyer, seller and agent flows in five minutes.

## Requirements

- Node.js 22.13 or newer, and npm
- An Anthropic API key (optional; without one the app runs in offline mode)

## Install and run

```bash
git clone https://github.com/BrandeisPatrick/open-marketplace.git
cd open-marketplace
cp .env.example .env      # then set ANTHROPIC_API_KEY=sk-ant-...
npm install
npm run dev               # API + MCP on http://localhost:3001, UI on http://localhost:5173
```

Open **http://localhost:5173** (if that port is busy, Vite picks the next free one and prints it).

`npm run dev` starts the server in watch mode and the Vite dev server together. To run the server alone and serve a built UI, see [Configuration and scripts](configuration.md#scripts).

## Run without an API key

Without `ANTHROPIC_API_KEY` the UI, REST API and MCP server work normally and the chat falls back to an offline keyword helper. Buyers can try "find a mechanical keyboard", "gifts under $50", "add the first one", "show my cart" and "checkout"; sellers can try "orders to ship", "how are sales?" and "mark ord_… shipped". The UI shows an offline banner, and the first reply explains how to turn the assistant on.

Conversations belong to the mode that wrote them: add or remove the key and restart, and both windows start with a fresh history, so the offline helper's replies are never replayed to Claude as its own words.

## Demo accounts and data

The database is a single SQLite file (`data/marketplace.db`) seeded on first run with three demo actors, 33 products and some order history. Delete the file to start fresh.

| Actor | Role | MCP token |
|---|---|---|
| Ada | buyer | `mk_buyer_demo` |
| Northwind Goods | seller | `mk_seller_demo` |
| Pixel & Pine | second seller (so checkout can split orders) | none |

The tokens are public demo values, not credentials. See [Security notes](mcp.md#security-notes) before running the server anywhere other than your own machine.

## Five-minute demo

1. **Buyer window:** click *Show me mechanical keyboards*. The assistant searches and the reply comes back as product cards; press **Add** on one, then say *checkout*.
2. **Seller window:** the new order appears in *Needs shipping* the moment it is placed. Ask *Which orders need shipping?* and press **Mark shipped** on the card.
3. **External agent:** run the [curl command](mcp.md#raw-json-rpc-with-curl) from the MCP guide (or [add the MCP server to Claude Code](mcp.md#claude-code) and ask it to *buy a coffee mug under $20 from the marketplace*). The purchase lands in the Activity feed with an **MCP** badge and in the seller window, exactly like one made in chat.
4. **Seller agent:** connect with `mk_seller_demo` and ask the agent *how are sales, and what is low on stock?* It answers with the same `seller_stats` tool the in-app assistant uses.

## Next steps

- [Connect an agent over MCP](mcp.md) to shop or sell from Claude Code, Claude Desktop or your own agent.
- Browse the [marketplace tools](tools.md) that both the assistants and MCP clients call.
- Read the [architecture](architecture.md) overview before changing the code, then the [contributing guide](../CONTRIBUTING.md).

## See also

- [Documentation index](README.md)
- [Configuration and scripts](configuration.md)
- [Connect an agent over MCP](mcp.md)
- [Security policy](../SECURITY.md)
