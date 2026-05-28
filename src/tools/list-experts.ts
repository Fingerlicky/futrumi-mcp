import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatExpertList } from "../formatters.js";
import { listExperts } from "../services/list-experts.js";

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
      const result = await listExperts(args);
      return {
        content: [{ type: "text", text: formatExpertList(result.experts, result.total) }],
      };
    },
  );
}
