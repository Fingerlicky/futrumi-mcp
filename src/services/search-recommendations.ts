import { gqlRequest } from "../graphql-client.js";
import { RECOMMENDATIONS_QUERY } from "../queries.js";
import { resolveLocation } from "../geocode.js";
import { rankRecommendationsByQuery } from "../semantic-search.js";
import type { RecommendationListItem } from "../types.js";

const DEFAULT_SEMANTIC_CANDIDATE_LIMIT = 120;
const configuredSemanticCandidateLimit = Number.parseInt(
  process.env.SEMANTIC_CANDIDATE_LIMIT ?? `${DEFAULT_SEMANTIC_CANDIDATE_LIMIT}`,
  10,
);
const semanticCandidateLimit = Number.isFinite(configuredSemanticCandidateLimit)
  ? Math.min(200, Math.max(50, configuredSemanticCandidateLimit))
  : DEFAULT_SEMANTIC_CANDIDATE_LIMIT;

export interface SearchRecommendationsInput {
  query?: string;
  locationQuery?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  expert_id?: string;
  limit?: number;
}

export interface SearchRecommendationsResult {
  recommendations: RecommendationListItem[];
  total: number;
  candidateCount: number;
  radiusMeters: number;
  resolvedFrom: string;
  query?: string;
  header: string;
}

export async function searchRecommendations(
  input: SearchRecommendationsInput,
): Promise<SearchRecommendationsResult> {
  const limit = input.limit ?? 30;
  const { location, resolvedFrom, suggestedRadiusMeters } = await resolveLocation({
    latitude: input.latitude,
    longitude: input.longitude,
    locationQuery: input.locationQuery,
  });
  const radiusMeters = input.radiusMeters ?? Math.max(suggestedRadiusMeters ?? 0, 2000);
  const query = input.query?.trim() || undefined;
  const candidateLimit = query ? Math.max(limit, semanticCandidateLimit) : limit;

  const data = await gqlRequest<{
    recommendations: { total: number; edges: RecommendationListItem[] };
  }>(RECOMMENDATIONS_QUERY, {
    filter: {
      center: location,
      distance: radiusMeters,
      ...(input.expert_id ? { expertId: input.expert_id } : {}),
    },
    pagination: { pageNumber: 0, pageSize: candidateLimit },
  });

  const recommendations = rankRecommendationsByQuery(
    data.recommendations.edges,
    query,
    limit,
  );
  const radiusKm = (radiusMeters / 1000).toFixed(1).replace(".", ",");
  const header = query
    ? `Nejrelevantnější doporučení pro "${query}" do ${radiusKm} km od ${resolvedFrom} (${recommendations.length} z ${data.recommendations.edges.length} kandidátů, celkem ${data.recommendations.total})`
    : `Doporučení do ${radiusKm} km od ${resolvedFrom} (${data.recommendations.edges.length} z ${data.recommendations.total})`;

  return {
    recommendations,
    total: data.recommendations.total,
    candidateCount: data.recommendations.edges.length,
    radiusMeters,
    resolvedFrom,
    query,
    header,
  };
}
