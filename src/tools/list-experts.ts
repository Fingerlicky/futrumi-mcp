import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gqlRequest } from "../graphql-client.js";
import { EXPERTS_QUERY } from "../queries.js";
import { formatExpertList } from "../formatters.js";
import type { ExpertListItem } from "../types.js";

const inputSchema = {
  pageNumber: z.number().int().min(0).default(0).describe("0-based page number."),
  pageSize: z.number().int().min(1).max(50).default(20),
};

export function registerListExperts(server: McpServer) {
  server.registerTool(
    "list_experts",
    {
      title: "List Futrumi experts",
      description:
        "Paginated directory of all Futrumi experts with their bio and recommendation count. Use this when the user asks who's behind the recommendations, or wants to browse by expert.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const data = await gqlRequest<{
        experts: { total: number; edges: ExpertListItem[] };
      }>(EXPERTS_QUERY, {
        pagination: { pageNumber: args.pageNumber, pageSize: args.pageSize },
      });
      return {
        content: [{ type: "text", text: formatExpertList(data.experts.edges, data.experts.total) }],
      };
    },
  );
}
