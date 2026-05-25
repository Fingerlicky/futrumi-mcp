# futrumi-mcp

Remote MCP server that exposes published Futrumi recommendations to AI assistants (Claude, ChatGPT, Codex).

Wraps the public read-only surface of the Futrumi GraphQL API as a small set of intent-shaped tools.

## Quickstart

```bash
npm install
cp .env.example .env
npm run dev
```

Server listens on `http://localhost:8080/mcp` using MCP Streamable HTTP.

## Inspector

```bash
npx @modelcontextprotocol/inspector
```

Then connect to `http://localhost:8080/mcp` with transport "Streamable HTTP".

## Tools

| Tool | Purpose |
|---|---|
| `search_recommendations` | Intent-shaped search ("tipy na X v Y") — returns a candidate set the model filters |
| `find_recommendations_near` | Geo lookup near coords or place name |
| `get_recommendation` | Full recommendation detail with expert quote, meals, photos |
| `get_business` | Full business detail with all expert recommendations |
| `get_expert` | Expert profile + their recommendations |
| `list_experts` | Paginated expert directory |

## Environment

See `.env.example`.

## Implementation notes

Running notes about design decisions, deviations, and open questions live in [`implementation-notes.html`](implementation-notes.html). Open it in any browser.
