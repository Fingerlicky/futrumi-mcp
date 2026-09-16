import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatBusinessList } from "../formatters.js";
import { topBusinesses } from "../services/top-businesses.js";

const inputSchema = {
  locationQuery: z
    .string()
    .optional()
    .describe('Place, city or region to rank within, e.g. "Brno", "Jihomoravský kraj".'),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radiusMeters: z
    .number()
    .int()
    .min(100)
    .max(50000)
    .optional()
    .describe(
      "Search radius in meters. If omitted, the server uses 5000 m for points and a larger place-aware radius for cities and regions. The radius is a circle around the resolved centre, so results are the surrounding area, not an exact municipal boundary.",
    ),
  businessType: z
    .string()
    .optional()
    .describe('Keep only this primary business type, e.g. "kavárna", "restaurace", "bar".'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .default(10)
    .describe("How many businesses the leaderboard returns."),
};

export function registerTopBusinesses(server: McpServer) {
  server.registerTool(
    "top_businesses",
    {
      title: "Top recommended businesses in an area",
      description:
        'Leaderboard: the businesses in an area with the most Futrumi experts recommending them, ranked by that count. Use for "which places are most recommended in X", "best rated restaurants in X", "top cafes around X". For a cuisine, vibe or occasion use search_recommendations; for nearest places use find_recommendations_near; for how many recommendations an expert wrote use list_experts. Returns markdown.',
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const result = await topBusinesses(args);

      return {
        content: [{ type: "text", text: formatBusinessList(result.businesses, result.header) }],
      };
    },
  );
}
