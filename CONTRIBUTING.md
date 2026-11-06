# Contributing to Open Marketplace

Thanks for your interest in improving Open Marketplace. This guide covers local setup, the project's conventions and what a pull request needs before it can be merged. By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

The guides in [`docs/`](docs/README.md) cover running the app, connecting over MCP, the tools, the architecture and configuration. If you work with an AI coding agent, [`AGENTS.md`](AGENTS.md) is a condensed version of this guide written for agents; `CLAUDE.md` imports it for Claude Code.

## Development setup

You need Node.js 22.13 or newer and npm. An Anthropic API key is optional: without one, chat runs in offline keyword mode and everything else works the same.

```bash
git clone https://github.com/BrandeisPatrick/open-marketplace.git
cd open-marketplace
cp .env.example .env      # optionally set ANTHROPIC_API_KEY
npm install
npm run dev               # server on http://localhost:3001, UI on http://localhost:5173
```

The repository is an npm workspace with two packages, `server` and `web`. The SQLite database is created and seeded at `data/marketplace.db` on first run; delete it to start from a clean seed.

Never commit `.env`, API keys or other credentials. `.env` is listed in `.gitignore`; keep it that way, and do not paste keys into issues, pull requests or test fixtures.

## Project layout

See [Repository structure](docs/architecture.md#repository-structure) in the architecture guide for an annotated tree. The short version: `server/src/marketplace` holds the tool registry and the store, `server/src/agent` the chat assistants, `server/src/mcp` the MCP server, `server/src/routes` the Express routers, and `web/src` the React UI.

## Scripts

Run these from the repo root.

| Command | What it does |
|---|---|
| `npm run dev` | Server (watch mode, port 3001) and web UI (Vite, port 5173) together |
| `npm start` | Server only; also serves the built UI from `web/dist` if it exists |
| `npm run build` | Builds the web UI and typechecks the server |
| `npm test` | Server test suite (vitest) |
| `npm run typecheck` | Typechecks both packages |
| `npm run mock -w web` | Starts the dependency-free mock API (see below) |

## The contract is the source of truth

[`docs/CONTRACT.md`](docs/CONTRACT.md) defines every shape the packages exchange: the data model, tool inputs and outputs, domain events, REST routes, the chat streaming protocol and the MCP surface. If a pull request changes any of these shapes, it must update `docs/CONTRACT.md` in the same pull request. Reviewers will check the code against the contract.

## Adding a marketplace tool

Every marketplace action is defined once in [`server/src/marketplace/tools.ts`](server/src/marketplace/tools.ts). That one definition serves both the in-app chat assistants and the MCP server, so there is no separate wiring for each.

1. **Put the domain logic in the store.** Queries and marketplace rules live in `server/src/marketplace/store.ts` as plain functions over SQLite. The store does not emit events. Throw `ToolError` with a readable message for expected failures such as an unknown id or insufficient stock.
2. **Define the tool** with `defineTool({...})` in `tools.ts`:
   - `name` (snake_case) and a short human `title`.
   - `description`, written for a language model: what the tool does, when to use it and which units its fields use. Prices in inputs are US dollars; outputs carry integer cents plus a formatted string.
   - `scope`: `buyer`, `seller` or `any`. Buyers see `buyer` and `any` tools, sellers see `seller` and `any` tools, and an out-of-scope call fails before the handler runs.
   - `readOnly: true` if it never changes state, or `additive: true` if it only adds state. These become the MCP `readOnlyHint` and `destructiveHint` annotations.
   - `inputSchema`, a zod object. Give every field a `.describe(...)`; the schema is converted to JSON Schema for Claude and passed to MCP as is.
   - `handler(actor, input, ctx)`, which calls the store and returns a plain JSON object. If the tool changes state, emit the matching domain event (for example `cart.updated` or `order.updated`) with `events.emit`, passing `ctx.source`, so the other window and the Activity feed update live.
   - `summarize(actor, input, output)`, a one-line activity summary such as `Ada added 1 × Stoneware Mug to the cart`.
3. **Register it** by adding it to the `TOOLS` array. From there it is picked up automatically: `anthropicToolDefs` gives it to the chat assistants for the matching role, `createMcpServer` registers it for MCP clients with the matching token, and every call from either side runs through `executeTool`, which handles validation, scope checks and the `agent.tool_call` event. Keep the existing order stable, because the chat assistants cache the tool list.
4. **Write tests** in `server/test`, using the helpers in `server/test/helpers.ts` (`freshDb`, `buyer`, `seller`, `captureEvents`, `startApp`). Cover the happy path, scope enforcement and the main error cases. If the tool is part of the MCP or HTTP surface you care about, add a case to `mcp.test.ts` or `http.test.ts`.
5. **Update the docs**: the tool table in `docs/CONTRACT.md` section 4 (inputs and outputs) and the table for the tool's scope in [`docs/tools.md`](docs/tools.md).
6. **Update the web UI if the result is visual.** Add pending and done chip labels in `web/src/lib/toolLabels.ts` (otherwise a generic label derived from the name is shown), and if the result should render as a card, add a case to `renderCard` in `web/src/components/Transcript.tsx` and list the mapping in `docs/CONTRACT.md` section 9. Shared types live in `web/src/types.ts`.
7. **Consider the assistants.** If Claude needs guidance on when to use the tool, adjust the system prompts in `server/src/agent/prompts.ts`. The offline keyword helper in `server/src/agent/offline.ts` is a separate, rule-based fallback and only needs a change if the tool should be reachable without an API key.

## Working on the UI with the mock API

`web/scripts/mock-api.mjs` is a dependency-free stand-in for the server, built against `docs/CONTRACT.md`. It serves the REST routes, streams `POST /api/chat` as a keyword-scripted SSE response and sends a sample event on `GET /api/events` about every four seconds. It does not implement MCP; `/mcp` returns an error.

```bash
npm run mock -w web                                   # mock on http://localhost:3001
npm run dev -w web                                    # UI on http://localhost:5173, proxied to 3001
```

The mock listens on port 3001 by default, the same port as the real server, so do not run both at once. To use another port, set `PORT` for the mock and point the Vite proxy at it with `API_PROXY_TARGET`:

```bash
PORT=3002 npm run mock -w web
API_PROXY_TARGET=http://localhost:3002 npm run dev -w web
```

Set `MOCK_AI=0` to simulate offline mode and `MOCK_EVENTS=0` to turn off the sample events. The mock keeps its state in memory and resets when it restarts.

## Testing expectations

Before you open a pull request, run these from the repo root and make sure all three pass:

```bash
npm run typecheck
npm test
npm run build
```

CI runs the same three commands on Node 22, 24 and 26 for every push to `main` and every pull request. Tests use an in-memory database for each file, listen on ephemeral ports and use a mock of the Anthropic Messages API, so they need no API key and do not touch your local database. New behavior should come with tests; bug fixes should come with a test that fails without the fix.

## Commits and pull requests

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
type(scope): subject
```

- **Type** is one of `feat` (a new feature), `fix` (a bug fix), `docs` (documentation only), `refactor` (a code change that neither fixes a bug nor adds a feature), `test` (adding or fixing tests), `chore` (maintenance that changes no shipped behavior), `ci` (the CI workflow) or `build` (the build setup, scripts or dependencies).
- **Scope** is optional and names the area: `server`, `web`, `mcp` or `docs`.
- **Subject** is in the imperative mood, lower case, without a trailing period, and describes the effect of the change.

Examples:

```
feat(server): add a wishlist tool for buyers
fix(web): reopen the live-events stream when it goes silent
docs(mcp): document the X-Marketplace-Token header
```

The first commits in the history predate this convention and use plain sentence-case subjects.

- Use the commit body to explain why, when the subject alone does not.
- Pull request titles follow the same `type(scope): subject` format.
- Keep pull requests small and focused on one change. Separate refactors from behavior changes.
- Fill in the pull request template: a summary, what changed, how you tested it and the checklist.
- Update `docs/CONTRACT.md` and the affected guides in `docs/` (for tools, `docs/tools.md`) in the same pull request when your change affects them.
- Do not add dependencies without discussing it in an issue first.

## Reporting bugs and proposing features

Use the [issue forms](https://github.com/BrandeisPatrick/open-marketplace/issues/new/choose): **Bug report** for something that does not work as documented, and **Feature request** for new capabilities. For a bug, include steps to reproduce, the surface involved (web UI, REST API, MCP, chat assistant or offline mode), your Node.js version and your operating system. For larger changes, open a feature request to agree on the approach before writing code.

Do not report security vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md) instead.
