# AGENTS.md

Guidance for AI coding agents and humans working in this repository.

## Project

Open Marketplace is an AI-first, two-sided marketplace where chat is the interface: buyers and sellers each talk to a Claude assistant in side-by-side windows that update live over Server-Sent Events. Every marketplace action is a tool in one registry that drives both the in-app assistants (Anthropic TypeScript SDK) and an MCP server (stateless Streamable HTTP at `/mcp`).

## Repository layout

npm workspaces with two packages:

- `server/`: Express 5, TypeScript, `node:sqlite`, zod 4, vitest.
  - `server/src/marketplace/`: tool registry (`tools.ts`), store with SQL and marketplace rules (`store.ts`), seed data, types.
  - `server/src/agent/`: Claude tool-use loop, offline keyword helper, system prompts.
  - `server/src/mcp/`: MCP server built from the tool registry.
  - `server/src/routes/`: Express routers for REST and SSE, chat and MCP.
  - `server/test/`: vitest suites and helpers (`helpers.ts`, `mock-anthropic.ts`).
- `web/`: Vite 8, React 19, Tailwind 4. `web/scripts/mock-api.mjs` is a stand-in server for UI work.
- `docs/`: `CONTRACT.md` (the shared contract) and the guides; start at `docs/README.md`.
- `data/`: the SQLite database, created on first run and git-ignored.

See `docs/architecture.md` for the annotated tree and how the parts connect.

## Commands

Run from the repo root unless noted.

```bash
npm install                 # install both workspaces
npm run dev                 # server on :3001 (watch mode) and web UI on :5173
npm run typecheck           # typecheck server and web
npm test                    # server test suite (vitest run)
npm run build               # build web UI and typecheck server
npm test -w server -- test/search.test.ts   # run one test file
npm test -w server -- -t "checkout"         # run tests whose name matches
npm run mock -w web         # dependency-free mock API on :3001 for UI work
```

The mock and the real server both default to port 3001, so do not run both at once. Set `PORT` for the mock and `API_PROXY_TARGET` for the Vite dev server to use another port; `MOCK_AI=0` simulates offline mode and `MOCK_EVENTS=0` turns off sample events. The mock does not implement MCP.

Without `ANTHROPIC_API_KEY`, chat runs in offline keyword mode and everything else works.

## Rules

- **One definition per action.** Every marketplace action is defined once in `server/src/marketplace/tools.ts` and serves both chat and MCP through `executeTool`. Do not add separate chat or MCP wiring for an action. Domain logic goes in `server/src/marketplace/store.ts`. Keep the order of the `TOOLS` array stable, because the assistants cache the tool list.
- **The contract is the source of truth.** `docs/CONTRACT.md` defines the data model, JSON shapes, tool inputs and outputs, domain events, REST routes, the chat streaming protocol and the MCP surface. A change to any of these updates `docs/CONTRACT.md` in the same pull request.
- **Keep the tool docs current.** When a tool is added, removed, renamed or changes scope, update `docs/tools.md` as well as `docs/CONTRACT.md`.
- **Tests are hermetic.** Each test file gets a fresh in-memory database (`MARKETPLACE_DB=:memory:` in `server/vitest.config.ts`), HTTP tests listen on ephemeral ports, and the Claude loop runs against a mock Anthropic Messages API (`server/test/mock-anthropic.ts`). No test may call the real API or need a key. New behavior comes with tests; bug fixes come with a test that fails without the fix.
- **No secrets.** Never read, print or commit `.env`, API keys or other credentials, and never put them in fixtures, logs, issues or pull requests. `.env.example` is the only env file in the repository.
- **No new dependencies** without discussing it in an issue first.
- **Node.js 22.13 or newer.** The database uses the built-in `node:sqlite`; there are no native modules.

## Commits and pull requests

Use Conventional Commits: `type(scope): subject`.

- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `build`.
- Optional scopes: `server`, `web`, `mcp`, `docs`.
- Subject in the imperative mood, lower case, no trailing period.
- Pull request titles follow the same format.

Examples: `feat(server): add a wishlist tool for buyers`, `fix(web): reopen the live-events stream when it goes silent`, `docs(mcp): document the X-Marketplace-Token header`.

Keep pull requests small and focused, and fill in the pull request template. Full details are in `CONTRIBUTING.md`.

## Definition of done

A change is done when all three pass from the repo root, the same commands CI runs on Node 22, 24 and 26:

```bash
npm run typecheck
npm test
npm run build
```

And, where it applies: `docs/CONTRACT.md` and `docs/tools.md` match the code, and the diff contains no secrets.
