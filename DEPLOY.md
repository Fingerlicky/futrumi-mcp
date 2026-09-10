# Deployment guide

End-to-end steps to ship futrumi-mcp to production and wire it into Claude / ChatGPT / Codex.

## 1. Push the repo to GitHub

```bash
cd futrumi-mcp
git init
git add .
git commit -m "Initial commit: MCP server over Futrumi public API"
gh repo create futured/futrumi-mcp --private --source=. --push
```

Confirm the `github.repo` field in `.do/app.yaml` matches the org/repo path.

## 2. Create the DigitalOcean App

Option A — Dashboard:

1. DigitalOcean → Apps → Create App → GitHub source
2. Pick the `futrumi-mcp` repo, branch `main`
3. App spec → "Edit your app spec" → paste contents of [.do/app.yaml](.do/app.yaml)
4. Choose region `fra` (Frankfurt, same as futrumi-backend)
5. Deploy

Option B — doctl CLI:

```bash
doctl apps create --spec .do/app.yaml
```

Wait for the first deploy to finish (~3–5 min). The platform assigns a temporary URL like `https://futrumi-mcp-xxxxx.ondigitalocean.app`.

## 3. Smoke test the deploy

```bash
APP_URL=https://futrumi-mcp-xxxxx.ondigitalocean.app

# Healthcheck
curl "$APP_URL/healthz"

# MCP handshake
curl -s -X POST "$APP_URL/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'

# Tools list
curl -s -X POST "$APP_URL/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

## 4. Add to Claude as a Custom Connector

We're starting on the DO-assigned URL (no custom domain yet). Use whatever URL the platform gave you in step 2 — that URL is stable, DO won't change it.

1. Open Claude (desktop or web) on a Pro/Max/Team account
2. Settings → Connectors → "Add custom connector"
3. URL: `https://<your-do-url>/mcp`
4. No authentication needed (anonymous)
5. After a few seconds the 6 Futrumi tools appear in the tool picker

Test prompt: *"Najdi mi nějaký dobrý bar kolem Holešovic."*

## 5. Add to Codex CLI

Edit `~/.codex/config.toml`:

```toml
[mcp_servers.futrumi]
command = "npx"
args = ["-y", "mcp-remote", "https://<your-do-url>/mcp"]
```

Codex needs STDIO transport — `mcp-remote` wraps a remote HTTP server as STDIO.

## 6. Custom domain (later — needed before directory submissions)

DigitalOcean's `*.ondigitalocean.app` URL is fine for private testing. Before submitting to the Claude Connectors directory or ChatGPT App Directory (plan phases 4–5), we'll switch to `mcp.futrumi.cz`:

1. DigitalOcean App Platform → Settings → Domains → Add `mcp.futrumi.cz`
2. DO will give you a CNAME target (looks like `something.ondigitalocean.app`)
3. In Wedos (where `futrumi.cz` is registered): DNS → Add record
   - Type: `CNAME`
   - Name: `mcp`
   - Value: the CNAME target from DO
   - TTL: 3600
4. Wait ~5 minutes for HTTPS provisioning
5. Uncomment the `domains:` block in [.do/app.yaml](.do/app.yaml) and re-deploy
6. Update the Claude connector and Codex config to use `https://mcp.futrumi.cz/mcp`

## 7. Next: directory submissions

Once production has been validated for a few days, follow the steps in the plan file for:

- Claude Connectors directory ([submission docs](https://claude.com/docs/connectors/building/submission))
- ChatGPT App Directory ([Apps SDK](https://developers.openai.com/apps-sdk))
- Official MCP Registry (https://registry.modelcontextprotocol.io)

## 8. Live concierge (hlasový průvodce)

Hlasová část (`/live/*`) běží ve stejné službě. Kontrakt pro klienty je v
[src/live/README.md](src/live/README.md).

### Env proměnné

| Klíč | Typ | Význam |
|---|---|---|
| `OPENAI_API_KEY` | **secret** | Bez něj `POST /live/session` vrací 503. |
| `LIVE_ACCESS_CODES` | **secret** | Kódy oddělené čárkou pro hlavičku `x-live-access-code`. Prázdné = bez kontroly (jen lokálně!). |
| `LIVE_ENABLED` | plain | `false` skryje celé `/live/*` za 404. |
| `LIVE_BACKEND_MODEL` | plain | Responses model, na který Live deleguje (`gpt-5.6-luna`). |
| `LIVE_MAX_SESSIONS` | plain | Souběžné session na proces, pak 429. |
| `LIVE_MAX_SESSION_SECONDS` | plain | Tvrdý strop jednoho hovoru (default 600). |

Tajné hodnoty patří jen do DO dashboardu (App → Settings → App-Level
Environment Variables, typ `SECRET`). `.do/app.yaml` drží jen ne-tajné.
Pozor: App Platform spec z repa při pushi sám nepřebírá — je to dokumentace,
hodnoty se mění v dashboardu.

### Smoke test produkce

```bash
APP_URL=https://mcp.futrumi.cz
CODE=<přístupový kód>

# Nový build poznáš podle pole "live"
curl -s "$APP_URL/healthz"
# {"ok":true,...,"live":true}

# Seznam hlasů je bez kódu
curl -s -o /dev/null -w '%{http_code}\n' "$APP_URL/live/voices"        # 200

# Bez kódu se session nevytvoří
curl -s -X POST "$APP_URL/live/session" \
  -H 'content-type: application/json' -d '{"sdp":"v=0\r\n"}'
# 401 {"error":"invalid_access_code"}

# S kódem projde autorizace a padne až validace SDP u OpenAI —
# tím je ověřeno, že klíč na produkci funguje
curl -s -X POST "$APP_URL/live/session" \
  -H 'content-type: application/json' -H "x-live-access-code: $CODE" \
  -d '{"sdp":"v=0\r\n"}'
# 400 {"error":"Live session creation failed.","detail":"400 Offer did not have an audio media section."}

# Regrese: MCP musí dál fungovat
curl -s -X POST "$APP_URL/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | head -c 200
```

Demo stránka `"$APP_URL/live/demo"` je veřejná (noindex) a kód si pamatuje
v localStorage.
