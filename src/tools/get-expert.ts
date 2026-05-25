import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gqlRequest } from "../graphql-client.js";
import { EXPERT_QUERY, RECOMMENDATIONS_QUERY } from "../queries.js";
import { formatExpertDetail } from "../formatters.js";
import type { ExpertDetail, RecommendationListItem } from "../types.js";

// Default geo window for fetching an expert's recommendations.
// Centered on Prague with ~350 km radius — covers all of CZ + SK border.
const CZ_CENTER = { latitude: 49.8, longitude: 15.5 };
const CZ_RADIUS_METERS = 350_000;

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
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const [expertData, recsData] = await Promise.all([
        gqlRequest<{ expert: ExpertDetail }>(EXPERT_QUERY, { id: args.expert_id }),
        gqlRequest<{ recommendations: { total: number; edges: RecommendationListItem[] } }>(
          RECOMMENDATIONS_QUERY,
          {
            filter: { center: CZ_CENTER, distance: CZ_RADIUS_METERS, expertId: args.expert_id },
            pagination: { pageNumber: 0, pageSize: args.limit },
          },
        ),
      ]);
      return {
        content: [
          {
            type: "text",
            text: formatExpertDetail(expertData.expert, recsData.recommendations.edges),
          },
        ],
      };
    },
  );
}
