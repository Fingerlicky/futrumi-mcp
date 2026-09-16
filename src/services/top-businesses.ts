import { gqlRequest } from "../graphql-client.js";
import { RECOMMENDED_BUSINESSES_QUERY } from "../queries.js";
import { resolveLocation } from "../geocode.js";
import type { BusinessListItem } from "../types.js";

// A leaderboard cannot be built from one page: the backend orders
// recommendedBusinesses by distance, so the most-recommended place in a region is
// almost never in the first window. Page through the whole radius up to a ceiling
// and rank locally, the same shape search_recommendations uses for its candidates.
const DEFAULT_CANDIDATE_CEILING = 600;
const DEFAULT_CANDIDATE_PAGE_SIZE = 200;

const readEnvInt = (name: string, fallback: number, min: number, max: number): number => {
  const parsed = Number.parseInt(process.env[name] ?? `${fallback}`, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

const candidateCeiling = () =>
  readEnvInt("TOP_BUSINESSES_CEILING", DEFAULT_CANDIDATE_CEILING, 50, 2000);
const candidatePageSize = () =>
  readEnvInt("TOP_BUSINESSES_PAGE_SIZE", DEFAULT_CANDIDATE_PAGE_SIZE, 50, 500);

const normalize = (value: string): string =>
  value
    .trim()
    .toLocaleLowerCase("cs-CZ")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ");

export interface TopBusinessesInput {
  locationQuery?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  businessType?: string;
  limit?: number;
}

export interface TopBusinessesResult {
  businesses: BusinessListItem[];
  total: number;
  candidateCount: number;
  matchedCount: number;
  radiusMeters: number;
  resolvedFrom: string;
  businessType?: string;
  header: string;
}

function matchesType(business: BusinessListItem, wanted: string): boolean {
  return normalize(business.primaryBusinessType.name).includes(wanted);
}

/** Most recommendations first; equal counts fall back to the nearer place. */
function byRecommendationCount(a: BusinessListItem, b: BusinessListItem): number {
  const delta = b.expertsWithRecommendationCount - a.expertsWithRecommendationCount;
  return delta !== 0 ? delta : a.distance - b.distance;
}

export async function topBusinesses(input: TopBusinessesInput): Promise<TopBusinessesResult> {
  const limit = input.limit ?? 10;
  const { location, resolvedFrom, suggestedRadiusMeters } = await resolveLocation({
    latitude: input.latitude,
    longitude: input.longitude,
    locationQuery: input.locationQuery,
  });
  // A ranking question is about an area, not a doorstep, so the floor is wider
  // than find_recommendations_near's 1500 m.
  const radiusMeters = input.radiusMeters ?? Math.max(suggestedRadiusMeters ?? 0, 5000);
  const businessType = input.businessType?.trim() || undefined;

  const filter = { center: location, distance: radiusMeters, open: false };
  const fetchPage = async (pageNumber: number, pageSize: number) => {
    const data = await gqlRequest<{
      recommendedBusinesses: { total: number; edges: BusinessListItem[] };
    }>(RECOMMENDED_BUSINESSES_QUERY, {
      filter,
      location,
      pagination: { pageNumber, pageSize },
    });
    return data.recommendedBusinesses;
  };

  const pageSize = candidatePageSize();
  const ceiling = Math.max(limit, candidateCeiling());
  const firstPage = await fetchPage(0, Math.min(ceiling, pageSize));

  const candidates = [...firstPage.edges];
  const wanted = Math.min(firstPage.total, ceiling);
  // Sequential on purpose: the backend serializes heavy queries, so parallel
  // pages only queue up behind each other and stretch the voice latency.
  const pageCount = Math.ceil(wanted / pageSize);
  for (let page = 1; page < pageCount && candidates.length < wanted; page += 1) {
    const next = await fetchPage(page, pageSize);
    candidates.push(...next.edges);
    if (next.edges.length === 0) break;
  }

  // Ties in the distance ordering can repeat a business across page boundaries,
  // which would otherwise show the same place twice in a top-10.
  const unique = new Map<string, BusinessListItem>();
  for (const business of candidates) {
    if (!unique.has(business.id)) unique.set(business.id, business);
  }

  const wantedType = businessType ? normalize(businessType) : undefined;
  const matched = [...unique.values()].filter(
    (business) => !wantedType || matchesType(business, wantedType),
  );
  const ranked = matched.sort(byRecommendationCount).slice(0, limit);

  const radiusKm = (radiusMeters / 1000).toFixed(1).replace(".", ",");
  const typePart = businessType ? ` (${businessType})` : "";
  const header = `Nejdoporučovanější podniky${typePart} do ${radiusKm} km od ${resolvedFrom} (${ranked.length} z ${matched.length} v okolí, prohledáno ${unique.size} z ${firstPage.total})`;

  return {
    businesses: ranked,
    total: firstPage.total,
    candidateCount: unique.size,
    matchedCount: matched.length,
    radiusMeters,
    resolvedFrom,
    businessType,
    header,
  };
}
