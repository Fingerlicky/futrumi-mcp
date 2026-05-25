import type { Location } from "./types.js";

// Nominatim (OpenStreetMap) free geocoding. Rate limit 1 req/s — fine for MCP traffic.
// https://operations.osmfoundation.org/policies/nominatim/
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

export async function geocode(query: string): Promise<Location | null> {
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

  const data = (await res.json()) as { lat?: string; lon?: string }[];
  const first = data[0];
  if (!first?.lat || !first?.lon) return null;

  const latitude = Number(first.lat);
  const longitude = Number(first.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return { latitude, longitude };
}

// Resolve either explicit coords or a place-name query into a Location.
// Throws if neither is usable.
export async function resolveLocation(input: {
  latitude?: number;
  longitude?: number;
  locationQuery?: string;
}): Promise<{ location: Location; resolvedFrom: string }> {
  if (typeof input.latitude === "number" && typeof input.longitude === "number") {
    return {
      location: { latitude: input.latitude, longitude: input.longitude },
      resolvedFrom: `${input.latitude.toFixed(4)}, ${input.longitude.toFixed(4)}`,
    };
  }
  if (input.locationQuery && input.locationQuery.trim()) {
    const loc = await geocode(input.locationQuery);
    if (!loc) {
      throw new Error(
        `Geocoding failed for "${input.locationQuery}". Pass explicit latitude/longitude instead.`,
      );
    }
    return { location: loc, resolvedFrom: input.locationQuery };
  }
  throw new Error("Provide either latitude+longitude or locationQuery.");
}
