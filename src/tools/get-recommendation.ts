import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gqlRequest } from "../graphql-client.js";
import { RECOMMENDATION_QUERY } from "../queries.js";
import { formatRecommendationDetail } from "../formatters.js";
import type { RecommendationDetail } from "../types.js";

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
        "Return the full text of a single expert recommendation including the strong quote, the long description, meals with their descriptions, publish date, and business basics. Use after search_recommendations when the user wants more depth on one specific tip.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const data = await gqlRequest<{ recommendation: RecommendationDetail }>(RECOMMENDATION_QUERY, {
        id: args.recommendation_id,
      });
      return {
        content: [{ type: "text", text: formatRecommendationDetail(data.recommendation) }],
      };
    },
  );
}
