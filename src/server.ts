import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { graphqlEndpoint } from "./graphql-client.js";
import { registerSearchRecommendations } from "./tools/search-recommendations.js";
import { registerFindRecommendationsNear } from "./tools/find-recommendations-near.js";
import { registerGetRecommendation } from "./tools/get-recommendation.js";
import { registerGetBusiness } from "./tools/get-business.js";
import { registerGetExpert } from "./tools/get-expert.js";
import { registerListExperts } from "./tools/list-experts.js";

const SERVER_INFO = {
  name: "futrumi",
  version: "0.1.0",
  title: "Futrumi — Czech restaurant recommendations",
};

const ALLOWED_ORIGINS = [
  "https://claude.ai",
  "https://claude.com",
  "https://chat.openai.com",
  "https://chatgpt.com",
  "http://localhost",
  "http://127.0.0.1",
];

function buildMcpServer(): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      "Futrumi serves Czech-language expert recommendations for restaurants, cafes, bars, and similar venues. Recommendations come from named food critics and other experts. When presenting results, keep expert quotes in the original Czech to preserve the expert's voice.",
  });
  registerSearchRecommendations(server);
  registerFindRecommendationsNear(server);
  registerGetRecommendation(server);
  registerGetBusiness(server);
  registerGetExpert(server);
  registerListExperts(server);
  return server;
}

const app = new Hono();

app.use(
  "/mcp",
  cors({
    origin: (incoming) => {
      if (!incoming) return "*";
      const ok = ALLOWED_ORIGINS.some((allowed) => incoming.startsWith(allowed));
      return ok ? incoming : null;
    },
    allowMethods: ["POST", "GET", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Mcp-Session-Id", "Authorization"],
    exposeHeaders: ["Mcp-Session-Id"],
  }),
);

app.get("/healthz", (c) =>
  c.json({ ok: true, endpoint: graphqlEndpoint, version: SERVER_INFO.version }),
);

app.all("/mcp", async (c) => {
  // Stateless mode — one Server + one Transport per HTTP request.
  // Cheap because tools are pure proxies over GraphQL; lets us scale horizontally.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const mcp = buildMcpServer();
  try {
    await mcp.connect(transport);
    return await transport.handleRequest(c.req.raw);
  } catch (err) {
    console.error("[/mcp] handler error", err);
    return c.json(
      {
        jsonrpc: "2.0",
        error: { code: -32603, message: err instanceof Error ? err.message : "Internal error" },
        id: null,
      },
      500,
    );
  } finally {
    // Fire-and-forget cleanup. The transport finishes the response itself.
    void mcp.close().catch(() => undefined);
  }
});

const port = Number.parseInt(process.env.PORT ?? "8080", 10);

serve({ fetch: app.fetch, port }, ({ port }) => {
  console.log(`futrumi-mcp listening on http://localhost:${port}/mcp`);
  console.log(`  GraphQL backend: ${graphqlEndpoint}`);
});
