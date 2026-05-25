import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gqlRequest } from "../graphql-client.js";
import { RECOMMENDATIONS_QUERY } from "../queries.js";
import { formatRecommendationList } from "../formatters.js";
import { resolveLocation } from "../geocode.js";
import type { RecommendationListItem } from "../types.js";

const inputSchema = {
  locationQuery: z
    .string()
    .optional()
    .describe(
      'Place name to search around, e.g. "Praha 7", "Holešovice", "Brno-střed". Use this if you don\'t have explicit coordinates.',
    ),
  latitude: z.number().min(-90).max(90).optional().describe("Latitude in WGS84."),
  longitude: z.number().min(-180).max(180).optional().describe("Longitude in WGS84."),
  radiusMeters: z
    .number()
    .int()
    .min(100)
    .max(50000)
    .default(2000)
    .describe("Search radius in meters. Default 2000 m (good for one Prague district)."),
  expertId: z
    .string()
    .optional()
    .describe("Optional. Restrict to recommendations from a specific expert (by id)."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(30)
    .describe(
      "Maximum number of recommendations to return. Default 30. Increase only if you really need more candidates.",
    ),
};

export function registerSearchRecommendations(server: McpServer) {
  server.registerTool(
    "search_recommendations",
    {
      title: "Search expert recommendations",
      description:
        'Get a candidate set of expert-recommended restaurants/cafes/bars/etc around a location. Use this when the user asks for a specific kind of place ("good ramen in Vinohrady", "rooftop bars near Wenceslas Square") — the response is a list of cards with each expert\'s quote, and you should pick the best matches from it. The data is Czech-only and includes only PUBLISHED recommendations. Returns markdown.',
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const { location, resolvedFrom } = await resolveLocation({
        latitude: args.latitude,
        longitude: args.longitude,
        locationQuery: args.locationQuery,
      });

      const data = await gqlRequest<{
        recommendations: { total: number; edges: RecommendationListItem[] };
      }>(RECOMMENDATIONS_QUERY, {
        filter: {
          center: location,
          distance: args.radiusMeters,
          ...(args.expertId ? { expertId: args.expertId } : {}),
        },
        pagination: { pageNumber: 0, pageSize: args.limit },
      });

      const radiusKm = (args.radiusMeters / 1000).toFixed(1).replace(".", ",");
      const header = `Doporučení do ${radiusKm} km od ${resolvedFrom} (${data.recommendations.edges.length} z ${data.recommendations.total})`;

      return {
        content: [{ type: "text", text: formatRecommendationList(data.recommendations.edges, header) }],
      };
    },
  );
}
