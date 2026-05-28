import { gqlRequest } from "../graphql-client.js";
import { RECOMMENDED_BUSINESSES_QUERY } from "../queries.js";
import { resolveLocation } from "../geocode.js";
import type { BusinessListItem } from "../types.js";

export interface FindRecommendationsNearInput {
  locationQuery?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  openNow?: boolean;
  limit?: number;
}

export interface FindRecommendationsNearResult {
  businesses: BusinessListItem[];
  total: number;
  radiusMeters: number;
  resolvedFrom: string;
  openNow: boolean;
  header: string;
}

export async function findRecommendationsNear(
  input: FindRecommendationsNearInput,
): Promise<FindRecommendationsNearResult> {
  const openNow = input.openNow ?? false;
  const limit = input.limit ?? 25;
  const { location, resolvedFrom, suggestedRadiusMeters } = await resolveLocation({
    latitude: input.latitude,
    longitude: input.longitude,
    locationQuery: input.locationQuery,
  });
  const radiusMeters = input.radiusMeters ?? Math.max(suggestedRadiusMeters ?? 0, 1500);

  const data = await gqlRequest<{
    recommendedBusinesses: { total: number; edges: BusinessListItem[] };
  }>(RECOMMENDED_BUSINESSES_QUERY, {
    filter: {
      center: location,
      distance: radiusMeters,
      open: openNow,
    },
    location,
    pagination: { pageNumber: 0, pageSize: limit },
  });

  const radiusKm = (radiusMeters / 1000).toFixed(1).replace(".", ",");
  const header = `Doporučené podniky do ${radiusKm} km od ${resolvedFrom}${openNow ? " (jen otevřené)" : ""} (${data.recommendedBusinesses.edges.length} z ${data.recommendedBusinesses.total})`;

  return {
    businesses: data.recommendedBusinesses.edges,
    total: data.recommendedBusinesses.total,
    radiusMeters,
    resolvedFrom,
    openNow,
    header,
  };
}
