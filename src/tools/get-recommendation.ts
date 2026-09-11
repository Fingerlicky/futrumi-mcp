import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatRecommendationDetail } from "../formatters.js";
import { getRecommendation } from "../services/get-recommendation.js";

const inputSchema = {
  recommendation_id: z
    .string()
    .min(1)
    .describe("Recommendation id (the `rec` value returned by search_recommendations)."),
};

export function registerGetRecommendation(server: McpServer) {
  server.registerTool(
    "get_recommendation",
    {
      title: "Get full recommendation detail",
      description:
        "Return the full text of a single expert recommendation including the strong quote, the long description, meals with their descriptions and photos, any other photos, publish date, and business basics. Use after search_recommendations when the user wants more depth on one specific tip.",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const recommendation = await getRecommendation(args);
      return {
        content: [{ type: "text", text: formatRecommendationDetail(recommendation) }],
      };
    },
  );
}
