import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gqlRequest } from "../graphql-client.js";
import { RECOMMENDED_BUSINESSES_QUERY } from "../queries.js";
import { formatBusinessList } from "../formatters.js";
import { resolveLocation } from "../geocode.js";
import type { BusinessListItem } from "../types.js";

const inputSchema = {
  locationQuery: z
    .string()
    .optional()
    .describe('Place name, e.g. "Náměstí Míru", "Brno-Královo Pole".'),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radiusMeters: z
    .number()
    .int()
    .min(100)
    .max(50000)
    .optional()
    .describe(
      "Search radius in meters. If omitted, the server uses 1500 m for points/neighborhoods and a larger city-aware radius for city names like Praha or Brno.",
    ),
  openNow: z
    .boolean()
    .default(false)
    .describe("If true, only return businesses currently open."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(25)
    .describe("Max businesses to return. Bump to 40-50 for dense areas like Holešovice or Brno center."),
};

export function registerFindRecommendationsNear(server: McpServer) {
  server.registerTool(
    "find_recommendations_near",
    {
      title: "Find recommended places near a location",
      description:
        'Geo-only lookup: return expert-recommended businesses near a point, sorted by distance. Use this when the user just wants to know "what good places are around X" without a specific cuisine/category. For category- or vibe-specific queries use search_recommendations instead. Returns markdown.',
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const { location, resolvedFrom, suggestedRadiusMeters } = await resolveLocation({
        latitude: args.latitude,
        longitude: args.longitude,
        locationQuery: args.locationQuery,
      });
      const radiusMeters = args.radiusMeters ?? Math.max(suggestedRadiusMeters ?? 0, 1500);

      const data = await gqlRequest<{
        recommendedBusinesses: { total: number; edges: BusinessListItem[] };
      }>(RECOMMENDED_BUSINESSES_QUERY, {
        filter: {
          center: location,
          distance: radiusMeters,
          open: args.openNow,
        },
        location,
        pagination: { pageNumber: 0, pageSize: args.limit },
      });

      const radiusKm = (radiusMeters / 1000).toFixed(1).replace(".", ",");
      const header = `Doporučené podniky do ${radiusKm} km od ${resolvedFrom}${args.openNow ? " (jen otevřené)" : ""} (${data.recommendedBusinesses.edges.length} z ${data.recommendedBusinesses.total})`;

      return {
        content: [
          { type: "text", text: formatBusinessList(data.recommendedBusinesses.edges, header) },
        ],
      };
    },
  );
}
