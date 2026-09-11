import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatExpertDetail } from "../formatters.js";
import { getExpert } from "../services/get-expert.js";

const inputSchema = {
  expert_id: z.string().min(1).describe("Expert id (the `expert id` value returned by list_experts)."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(30)
    .describe("Maximum recommendations to fetch for this expert."),
};

export function registerGetExpert(server: McpServer) {
  server.registerTool(
    "get_expert",
    {
      title: "Get expert profile",
      description:
        "Return an expert's bio plus a list of their recommendations (business name, address, quote, meals). Use when the user asks about a specific expert.",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const result = await getExpert(args);
      return {
        content: [
          {
            type: "text",
            text: formatExpertDetail(result.expert, result.recommendations),
          },
        ],
      };
    },
  );
}
