# Documentation

Guides and reference for running, connecting to, configuring and changing Open Marketplace.

Start with [Getting started](getting-started.md) to run the app locally. The other pages go deeper on one area each, and [`CONTRACT.md`](CONTRACT.md) is the exact specification the code is checked against.

| Page | What it covers | Who it is for |
|---|---|---|
| [Getting started](getting-started.md) | Requirements, install and run, offline mode, demo accounts and a five-minute demo | Anyone trying the app for the first time |
| [Connect an agent over MCP](mcp.md) | The `/mcp` endpoint, tokens, Claude Code and Claude Desktop setup, curl, resources and prompts | Anyone pointing an external agent at the marketplace |
| [Marketplace tools](tools.md) | The 16 tools by scope and the conventions every tool follows | Agent builders and contributors adding or changing tools |
| [Architecture](architecture.md) | How the UI, chat agents, MCP server, tool registry and database fit together, the repository structure and the test suite | Contributors |
| [Configuration and scripts](configuration.md) | Environment variables and npm scripts | Anyone running or developing the app |
| [Shared contract](CONTRACT.md) | Data model, JSON shapes, tool inputs and outputs, domain events, REST routes, the chat streaming protocol and the MCP surface | Contributors changing any shape the packages exchange |

## Project policies

- [Contributing guide](../CONTRIBUTING.md): development setup, adding a marketplace tool, commit conventions and the pull request checklist.
- [Security policy](../SECURITY.md): the security model of the demo and how to report a vulnerability privately.
- [Changelog](../CHANGELOG.md): notable changes in each release.

## See also

- [Project README](../README.md)
- [Getting started](getting-started.md)
- [Contributing guide](../CONTRIBUTING.md)
