# futrumi-mcp

Remote MCP server that exposes published Futrumi recommendations to AI assistants (Claude, ChatGPT, Codex). Wraps the public read-only surface of the Futrumi GraphQL API as a small set of intent-shaped tools.

**Production endpoint:** `https://mcp.futrumi.cz/mcp` (Streamable HTTP, anonymous, no auth).
**Health check:** `https://mcp.futrumi.cz/healthz`.

## Connecting

### Claude Desktop or Claude.ai (web)

Settings → Customize → Connectors → Add custom connector → paste `https://mcp.futrumi.cz/mcp`. No authentication. Within a few seconds the 6 Futrumi tools appear in the tool picker.

### Claude Code (CLI)

```bash
claude mcp add --transport http --scope user futrumi https://mcp.futrumi.cz/mcp
```

### Codex CLI

Edit `~/.codex/config.toml`:

```toml
[mcp_servers.futrumi]
command = "npx"
args = ["-y", "mcp-remote", "https://mcp.futrumi.cz/mcp"]
```

### Local dev (this repo)

```bash
npm install
cp .env.example .env
npm run dev
```

Server listens on `http://localhost:8080/mcp`. Test with `npx @modelcontextprotocol/inspector` against that URL.

## Tools

| Tool | Purpose |
|---|---|
| `search_recommendations` | Intent-shaped search ("tipy na X v Y") with local semantic/concept ranking |
| `find_recommendations_near` | Geo lookup near coords or place name |
| `get_recommendation` | Full recommendation detail with expert quote, meals, photos |
| `get_business` | Full business detail with all expert recommendations |
| `get_expert` | Expert profile + their recommendations |
| `list_experts` | Paginated expert directory |

All tools are read-only (annotated `readOnlyHint: true`).

## Environment

See `.env.example`. All variables have sensible defaults — the server runs out of the box pointing at `https://futrumi-prod-w7u56.ondigitalocean.app/graphql`.

## Troubleshooting

| Symptom | Likely cause + fix |
|---|---|
| Connector can't connect | `curl https://mcp.futrumi.cz/healthz` should return `{"ok":true,...}`. If not, the upstream Futrumi backend or the MCP server is down — ping `info@futrumi.cz`. |
| Tool returns "Geocoding failed for ..." | The Nominatim free geocoder didn't recognize the place name. Try a more specific Prague district (`Praha 7`, `Holešovice`) or pass explicit `latitude`/`longitude`. |
| 0 results for a search | The search radius is too narrow or the area has no expert-recommended places. Try a larger `radiusMeters` (default is 1500 m for `find_recommendations_near`, 2000 m for `search_recommendations`). |
| Czech place name returns wrong city | Nominatim may pick a less-frequent match. Append the country: `"Karlín, Praha"` instead of just `"Karlín"`. |
| Model picks the "wrong" tool (e.g., search vs. find_near) | They are very similar — `find_recommendations_near` is geo-only; `search_recommendations` ranks by a natural-language `query`. If the user gave a cuisine/category, prefer `search_recommendations`. |
| Tool input rejected with `expected string, received undefined` for `id` | The parameter names are self-documenting: `business_id` for `get_business`, `recommendation_id` for `get_recommendation`, `expert_id` for `get_expert`. |

## Project docs

- [`DEPLOY.md`](DEPLOY.md) — production deploy guide (DigitalOcean App Platform)
- [`connector-description.md`](connector-description.md) — reusable copy (tagline, short and long descriptions) for submission forms
- [`server.json`](server.json) — metadata for the official MCP Registry

## License & contributing

This repository is published as a reference for the Futrumi MCP integration. The server itself runs at `https://mcp.futrumi.cz/mcp` and is open for anyone to connect to. Issues and PRs are welcome.
