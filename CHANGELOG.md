# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-05

First public release.

### Added

- Chat-first web UI with a Buyer window and a Seller window side by side, each with its own Claude assistant, suggestion chips and a side panel (cart and recent orders for buyers; listings, orders to ship and stats for sellers).
- Rich result cards rendered from tool results: product grids, product details, cart, orders, seller stats and category chips.
- A single registry of 16 marketplace tools (9 buyer, 6 seller, 1 shared) with zod input schemas, buyer and seller scope checks, domain events and one-line activity summaries.
- In-app assistants built on the Anthropic TypeScript SDK: a streaming manual tool-use loop with prompt caching, configurable model and effort, optional server-side refusal fallbacks, and conversation history persisted per demo actor.
- An MCP server over stateless Streamable HTTP at `/mcp`, exposing the same tools plus resources (`marketplace://products`, `marketplace://products/{id}`, `marketplace://orders`) and prompts (`shopping_assistant`, `seller_briefing`); the bearer token selects the demo buyer or seller.
- Live updates over Server-Sent Events (`GET /api/events`) and an Activity feed that labels each action with its source, chat or MCP.
- Read-only REST API for products, categories, cart, orders, listings and seller stats, plus `GET /api/health`.
- Offline mode: without `ANTHROPIC_API_KEY`, chat falls back to a rule-based keyword helper that streams the same events, and conversations from one mode are never replayed in the other.
- SQLite storage through Node's built-in `node:sqlite`, seeded on first run with three demo actors, 33 products and sample order history.
- Checkout that splits the cart into one order per seller, with flat $5.99 shipping under $35, stock decrements and cancellation that restores stock.
- A dependency-free mock API (`npm run mock -w web`) for UI work without the server.
- Server test suite (vitest) covering the tools, REST API, MCP server, offline helper and the Claude tool-use loop against a mock Messages API.
- Project documentation: README, shared contract (`docs/CONTRACT.md`), contributing guide, code of conduct, security policy, issue forms, pull request template and CI on Node 22, 24 and 26.

[0.1.0]: https://github.com/BrandeisPatrick/open-marketplace/releases/tag/v0.1.0
