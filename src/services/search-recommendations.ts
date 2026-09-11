import { gqlRequest } from "../graphql-client.js";
import { RECOMMENDATIONS_QUERY } from "../queries.js";
import { resolveLocation } from "../geocode.js";
import { rankRecommendationsByQuery } from "../semantic-search.js";
import type { RecommendationListItem } from "../types.js";

// The backend returns recommendations ordered by distance, so ranking only the
// first page made a wider radius produce *worse* results: the window filled up
// with nearer tips before relevance was ever scored, and a restaurant literally
// named "PHO 100" dropped out of a "pho" search when the radius grew from 3 to
// 8 km. A semantic query therefore pages through the whole radius up to a ceiling.
//
// The ceiling has its own variable on purpose: SEMANTIC_CANDIDATE_LIMIT used to
// mean "the single page we fetch", and reusing that name for the ceiling would
// let an old deployment value silently cap the whole pool again.
const DEFAULT_CANDIDATE_CEILING = 600;
const DEFAULT_CANDIDATE_PAGE_SIZE = 200;

const readEnvInt = (name: string, fallback: number, min: number, max: number): number => {
  const parsed = Number.parseInt(process.env[name] ?? `${fallback}`, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

const candidateCeiling = readEnvInt(
  "SEMANTIC_CANDIDATE_CEILING",
  DEFAULT_CANDIDATE_CEILING,
  50,
  2000,
);
const candidatePageSize = readEnvInt(
  "SEMANTIC_CANDIDATE_LIMIT",
  DEFAULT_CANDIDATE_PAGE_SIZE,
  50,
  500,
);

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
  const filter = {
    center: location,
    distance: radiusMeters,
    ...(input.expert_id ? { expertId: input.expert_id } : {}),
  };
  const fetchPage = async (pageNumber: number, pageSize: number) => {
    const data = await gqlRequest<{
      recommendations: { total: number; edges: RecommendationListItem[] };
    }>(RECOMMENDATIONS_QUERY, { filter, pagination: { pageNumber, pageSize } });
    return data.recommendations;
  };

  const ceiling = query ? Math.max(limit, candidateCeiling) : limit;
  const firstPage = await fetchPage(0, Math.min(ceiling, query ? candidatePageSize : limit));

  const candidates = [...firstPage.edges];
  const wanted = Math.min(firstPage.total, ceiling);
  if (query && candidates.length < wanted) {
    const pageCount = Math.ceil(wanted / candidatePageSize);
    const rest = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_, i) => fetchPage(i + 1, candidatePageSize)),
    );
    for (const page of rest) candidates.push(...page.edges);
  }

  const recommendations = rankRecommendationsByQuery(candidates, query, limit);
  const radiusKm = (radiusMeters / 1000).toFixed(1).replace(".", ",");
  const header = query
    ? `Nejrelevantnější doporučení pro "${query}" do ${radiusKm} km od ${resolvedFrom} (${recommendations.length} z ${candidates.length} kandidátů, celkem ${firstPage.total})`
    : `Doporučení do ${radiusKm} km od ${resolvedFrom} (${candidates.length} z ${firstPage.total})`;

  return {
    recommendations,
    total: firstPage.total,
    candidateCount: candidates.length,
    radiusMeters,
    resolvedFrom,
    query,
    header,
  };
}
