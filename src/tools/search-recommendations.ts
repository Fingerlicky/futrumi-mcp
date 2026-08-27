import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gqlRequest } from "../graphql-client.js";
import { RECOMMENDATIONS_QUERY } from "../queries.js";
import { formatRecommendationList } from "../formatters.js";
import { resolveLocation } from "../geocode.js";
import { rankRecommendationsByQuery } from "../semantic-search.js";
import type { RecommendationListItem } from "../types.js";

// The backend returns recommendations ordered by distance, so ranking only the
// first page meant a wider radius produced *worse* results: the window filled up
// with nearer tips before relevance was ever scored, and a restaurant literally
// named "PHO 100" dropped out of a "pho" search when the radius grew from 3 to
// 8 km. So a semantic query pages through the whole radius up to this ceiling.
const DEFAULT_SEMANTIC_CANDIDATE_LIMIT = 600;
const CANDIDATE_PAGE_SIZE = 200;
const configuredSemanticCandidateLimit = Number.parseInt(
  process.env.SEMANTIC_CANDIDATE_LIMIT ?? `${DEFAULT_SEMANTIC_CANDIDATE_LIMIT}`,
  10,
);
const semanticCandidateLimit = Number.isFinite(configuredSemanticCandidateLimit)
  ? Math.min(2000, Math.max(50, configuredSemanticCandidateLimit))
  : DEFAULT_SEMANTIC_CANDIDATE_LIMIT;

const inputSchema = {
  query: z
    .string()
    .optional()
    .describe(
      'Natural-language intent to rank results by, e.g. "ramen", "vietnamská", "brunch", "na rande", "levný oběd", "vinný bar".',
    ),
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
    .optional()
    .describe(
      "Search radius in meters. If omitted, the server uses 2000 m for points/neighborhoods and a larger city-aware radius for city names like Praha or Brno.",
    ),
  expert_id: z
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
        'Search and rank expert-recommended restaurants/cafes/bars/etc around a location. Use this when the user asks for a specific cuisine, meal, occasion, vibe, or category ("good ramen in Vinohrady", "brunch in Brno", "vinný bar na rande"). Pass the user intent in `query`; the server ranks candidates by semantic-ish food/occasion relevance before returning markdown. The data is Czech-only and includes only PUBLISHED recommendations.',
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const { location, resolvedFrom, suggestedRadiusMeters } = await resolveLocation({
        latitude: args.latitude,
        longitude: args.longitude,
        locationQuery: args.locationQuery,
      });
      const radiusMeters = args.radiusMeters ?? Math.max(suggestedRadiusMeters ?? 0, 2000);
      const query = args.query?.trim();
      const filter = {
        center: location,
        distance: radiusMeters,
        ...(args.expert_id ? { expertId: args.expert_id } : {}),
      };
      const fetchPage = async (pageNumber: number, pageSize: number) => {
        const data = await gqlRequest<{
          recommendations: { total: number; edges: RecommendationListItem[] };
        }>(RECOMMENDATIONS_QUERY, { filter, pagination: { pageNumber, pageSize } });
        return data.recommendations;
      };

      const candidateCeiling = query ? Math.max(args.limit, semanticCandidateLimit) : args.limit;
      const firstPageSize = Math.min(candidateCeiling, query ? CANDIDATE_PAGE_SIZE : args.limit);
      const firstPage = await fetchPage(0, firstPageSize);

      const candidates = [...firstPage.edges];
      const wanted = Math.min(firstPage.total, candidateCeiling);
      if (query && candidates.length < wanted) {
        const pageCount = Math.ceil(wanted / CANDIDATE_PAGE_SIZE);
        const rest = await Promise.all(
          Array.from({ length: pageCount - 1 }, (_, i) => fetchPage(i + 1, CANDIDATE_PAGE_SIZE)),
        );
        for (const page of rest) candidates.push(...page.edges);
      }

      const ranked = rankRecommendationsByQuery(candidates, query, args.limit);
      const radiusKm = (radiusMeters / 1000).toFixed(1).replace(".", ",");
      const header = query
        ? `Nejrelevantnější doporučení pro "${query}" do ${radiusKm} km od ${resolvedFrom} (${ranked.length} z ${candidates.length} kandidátů, celkem ${firstPage.total})`
        : `Doporučení do ${radiusKm} km od ${resolvedFrom} (${candidates.length} z ${firstPage.total})`;

      return {
        content: [{ type: "text", text: formatRecommendationList(ranked, header) }],
      };
    },
  );
}
