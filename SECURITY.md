# Security policy

## Supported versions

Open Marketplace is developed on a single branch. Security fixes are made against the latest commit on `main`; older commits and tags do not receive backported fixes.

| Version | Supported |
|---|---|
| Latest commit on `main` | Yes |
| Anything older | No |

## Security model

Open Marketplace is a local demo, and its security model reflects that. Please read this before you run it anywhere other than your own machine.

- **Demo accounts, not real authentication.** There are no user accounts or passwords. MCP clients choose who they act as with the public demo tokens `mk_buyer_demo` (the demo buyer) and `mk_seller_demo` (the demo seller), which are published in the README. A request with no token or an unknown token acts as the demo buyer. The REST API and the chat endpoint always act as the demo buyer or seller and take no credentials at all.
- **No real payments.** Checkout creates orders in the local SQLite database. No payment details are collected and no money moves.
- **Intended for localhost.** The REST API grants cross-origin (CORS) access only to `localhost`, `127.0.0.1` and `[::1]` origins, and the MCP endpoint rejects requests whose `Origin` header is not one of those, which also blocks DNS-rebinding attacks from web pages. These checks protect against malicious websites, not against other machines: the server listens on all network interfaces by default, and anyone who can reach its port can use the demo accounts and the chat assistants.
- **Not for the internet as is.** Do not expose the server to the public internet or an untrusted network without adding real authentication, authorization and rate limiting. In particular, an exposed chat endpoint lets anyone spend your Anthropic API credits.

Reports about the absence of authentication on the demo accounts are expected behavior, not vulnerabilities. Reports about ways the code is less safe than described here are very welcome.

## How the API key is handled

The Anthropic API key is read on the server from the `ANTHROPIC_API_KEY` environment variable, which `npm run dev` and `npm start` load from `.env` in the repo root. `.env` is listed in `.gitignore`. The following was verified in the code:

- The key is read once in `server/src/config.ts` and used only in `server/src/agent/chat.ts` to construct the Anthropic client. No other server module reads it.
- `GET /api/health` returns only whether the assistants are enabled (a boolean), the model name and the effort level. No route returns the key or the server configuration object.
- The browser never receives the key. The web UI only displays the variable name in its offline-mode hints, and the startup log reports only whether the assistants are on.
- The test suite runs with `ANTHROPIC_API_KEY` set to an empty string and a mock of the Messages API, so tests never use a real key.

Never commit `.env` or paste API keys into issues, pull requests or logs.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's private vulnerability reporting:

**[Open a private security advisory](https://github.com/BrandeisPatrick/open-marketplace/security/advisories/new)**

Do not open a public issue, pull request or discussion for a vulnerability. Include as much of the following as you can:

- A description of the problem and its impact.
- Steps to reproduce, or a proof of concept.
- The commit you tested against, your Node.js version and your operating system.
- Any suggested fix or mitigation.

## What to expect

This project is maintained by one person on a best-effort basis, so there is no guaranteed response time. You can expect an acknowledgment of your report, an assessment of whether it is in scope, and updates in the advisory as a fix progresses. Once a fix is available on `main`, the advisory can be published with credit to you, unless you prefer to stay anonymous. Please allow a reasonable amount of time for a fix before disclosing the issue publicly.
