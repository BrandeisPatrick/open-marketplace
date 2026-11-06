# Configuration and scripts

The environment variables the server reads and the npm scripts you run from the repo root.

## Environment variables

Settings are read from environment variables; `npm run dev` and `npm start` load them from `.env` in the repo root when the file exists. Copy [`.env.example`](../.env.example) to get started.

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | (empty) | Enables the AI assistants; without it chat runs in offline mode |
| `PORT` | `3001` | Server port (the Vite dev server proxies `/api` and `/mcp` here) |
| `MARKETPLACE_MODEL` | `claude-opus-5-5` | Claude model for both assistants |
| `MARKETPLACE_EFFORT` | `medium` | `low`, `medium`, `high`, `xhigh` or `max` |
| `MARKETPLACE_FALLBACKS` | `0` | `1` turns on server-side refusal fallbacks (beta) for chat requests |
| `MARKETPLACE_DB` | `data/marketplace.db` | SQLite file (`:memory:` works for throwaway runs) |

An unrecognized `MARKETPLACE_EFFORT` value is ignored with a warning, and `medium` is used. A relative `MARKETPLACE_DB` path is resolved against the repo root.

Never commit `.env` or paste API keys into issues, pull requests or logs. See the [security policy](../SECURITY.md) for how the key is handled.

## Scripts

Run these from the repo root.

| Command | What it does |
|---|---|
| `npm run dev` | Server (watch mode, port 3001) and web UI (Vite, port 5173) together |
| `npm start` | Server only; also serves the built UI from `web/dist` if it exists |
| `npm run build` | Builds the web UI and typechecks the server |
| `npm test` | Server test suite (vitest) |
| `npm run typecheck` | Typechecks both packages |
| `npm run mock -w web` | Dependency-free mock of the server for UI work (see the [contributing guide](../CONTRIBUTING.md#working-on-the-ui-with-the-mock-api)) |

## See also

- [Getting started](getting-started.md)
- [Architecture](architecture.md)
- [Contributing guide](../CONTRIBUTING.md)
- [Security policy](../SECURITY.md)
