import type { Location } from "./types.js";

// Nominatim (OpenStreetMap) free geocoding. Rate limit 1 req/s — fine for MCP traffic.
// https://operations.osmfoundation.org/policies/nominatim/
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const EARTH_RADIUS_METERS = 6_371_000;
const MAX_RADIUS_METERS = 50_000;

const CITY_RADIUS_BY_QUERY = new Map<string, number>([
  ["praha", 15_000],
  ["prague", 15_000],
  ["brno", 10_000],
  ["ostrava", 12_000],
  ["plzen", 9_000],
  ["pilsen", 9_000],
  ["olomouc", 7_000],
  ["liberec", 7_000],
  ["ceske budejovice", 7_000],
  ["hradec kralove", 7_000],
  ["pardubice", 7_000],
  ["usti nad labem", 7_000],
  ["zlin", 7_000],
  ["jihlava", 6_000],
  ["karlovy vary", 6_000],
]);

interface NominatimResult {
  lat?: string;
  lon?: string;
  display_name?: string;
  addresstype?: string;
  type?: string;
  boundingbox?: string[];
}

interface GeocodeResult {
  location: Location;
  suggestedRadiusMeters?: number;
}

const normalizePlaceQuery = (query: string): string =>
  query
    .trim()
    .toLocaleLowerCase("cs-CZ")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ");

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

function distanceMeters(a: Location, b: Location): number {
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
}

const clampRadius = (meters: number): number =>
  Math.min(MAX_RADIUS_METERS, Math.max(100, Math.ceil(meters / 500) * 500));

function radiusFromBoundingBox(result: NominatimResult, center: Location): number | undefined {
  const box = result.boundingbox;
  if (!box || box.length !== 4) return undefined;

  const south = Number(box[0]);
  const north = Number(box[1]);
  const west = Number(box[2]);
  const east = Number(box[3]);
  if (![south, north, west, east].every(Number.isFinite)) return undefined;

  const corners: Location[] = [
    { latitude: south, longitude: west },
    { latitude: south, longitude: east },
    { latitude: north, longitude: west },
    { latitude: north, longitude: east },
  ];
  const farthest = Math.max(...corners.map((corner) => distanceMeters(center, corner)));
  return clampRadius(farthest * 1.1);
}

function suggestedRadiusFor(query: string, result: NominatimResult, center: Location): number | undefined {
  const knownCityRadius = CITY_RADIUS_BY_QUERY.get(normalizePlaceQuery(query));
  if (knownCityRadius) return knownCityRadius;

  const bboxRadius = radiusFromBoundingBox(result, center);
  const placeType = result.addresstype ?? result.type;
  if (placeType === "city") return Math.max(bboxRadius ?? 0, 12_000);
  if (placeType === "town") return Math.max(bboxRadius ?? 0, 6_000);
  if (placeType === "village" || placeType === "municipality") {
    return Math.max(bboxRadius ?? 0, 3_000);
  }
  if (placeType === "administrative" && bboxRadius && bboxRadius >= 8_000) {
    return bboxRadius;
  }

  return undefined;
}

export async function geocode(query: string): Promise<GeocodeResult | null> {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: "1",
    "accept-language": "cs,en",
  });

  const res = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: {
      "user-agent": "futrumi-mcp/0.1 (+https://futrumi.cz)",
    },
  });

  if (!res.ok) return null;

  const data = (await res.json()) as NominatimResult[];
  const first = data[0];
  if (!first?.lat || !first?.lon) return null;

  const latitude = Number(first.lat);
  const longitude = Number(first.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const location = { latitude, longitude };
  return {
    location,
    suggestedRadiusMeters: suggestedRadiusFor(query, first, location),
  };
}

// Resolve either explicit coords or a place-name query into a Location.
// Throws if neither is usable.
export async function resolveLocation(input: {
  latitude?: number;
  longitude?: number;
  locationQuery?: string;
}): Promise<{ location: Location; resolvedFrom: string; suggestedRadiusMeters?: number }> {
  if (typeof input.latitude === "number" && typeof input.longitude === "number") {
    return {
      location: { latitude: input.latitude, longitude: input.longitude },
      resolvedFrom: `${input.latitude.toFixed(4)}, ${input.longitude.toFixed(4)}`,
    };
  }
  if (input.locationQuery && input.locationQuery.trim()) {
    const geocoded = await geocode(input.locationQuery);
    if (!geocoded) {
      throw new Error(
        `Geocoding failed for "${input.locationQuery}". Pass explicit latitude/longitude instead.`,
      );
    }
    return { ...geocoded, resolvedFrom: input.locationQuery };
  }
  throw new Error("Provide either latitude+longitude or locationQuery.");
}
