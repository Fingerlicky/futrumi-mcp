import type { FunctionTool } from "openai/resources/live/live";

import { businessDeeplink } from "../formatters.js";
import { findRecommendationsNear } from "../services/find-recommendations-near.js";
import { getBusiness } from "../services/get-business.js";
import { getRecommendation } from "../services/get-recommendation.js";
import { searchRecommendations } from "../services/search-recommendations.js";
import type {
  BusinessDetail,
  BusinessListItem,
  NestedRecommendation,
  RecommendationDetail,
  RecommendationListItem,
} from "../types.js";

export type JsonRecord = Record<string, unknown>;

/** Structurally compatible with ConciergeRequest so the concierge can pass its request straight through. */
export interface ToolContext {
  message?: string;
  locationQuery?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
}

export interface KnownBusiness {
  business_id: string;
  name: string;
  expert: string | null;
  quote: string | null;
  deeplink: string;
}

export interface ToolRun {
  payload: JsonRecord;
  businesses: KnownBusiness[];
}

export interface PresentedChoice extends KnownBusiness {
  reason: string;
}

export interface PresentChoicesPayload {
  ok: true;
  shown: PresentedChoice[];
}

export interface UnknownIdsPayload {
  ok: false;
  unknown_ids: string[];
  hint: string;
}

export const DATA_TOOLS: FunctionTool[] = [
  {
    type: "function",
    name: "search_recommendations",
    description:
      "Search and rank Futrumi expert recommendations around a location for a cuisine, occasion, meal, vibe, or natural-language intent.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language search intent." },
        locationQuery: { type: "string", description: "Place name to search around." },
        latitude: { type: "number" },
        longitude: { type: "number" },
        radiusMeters: { type: "integer", minimum: 100, maximum: 50000 },
        expert_id: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "find_recommendations_near",
    description:
      "Find expert-recommended businesses near a point or place, sorted by distance. Use for geo-only 'what is good around here' requests.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        locationQuery: { type: "string", description: "Place name to search around." },
        latitude: { type: "number" },
        longitude: { type: "number" },
        radiusMeters: { type: "integer", minimum: 100, maximum: 50000 },
        openNow: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_business",
    description:
      "Get full Futrumi detail for one business, including links, featured quotes, and all expert recommendations.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        business_id: { type: "string" },
        latitude: { type: "number" },
        longitude: { type: "number" },
      },
      required: ["business_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_recommendation",
    description:
      "Get full text of one Futrumi expert recommendation, including long description and meal descriptions.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        recommendation_id: { type: "string" },
      },
      required: ["recommendation_id"],
      additionalProperties: false,
    },
  },
];

const choiceSchema: JsonRecord = {
  type: "object",
  properties: {
    business_id: { type: "string", description: "Futrumi business ID from a tool result." },
    reason: {
      type: "string",
      description: "Jedna krátká věta, proč se podnik hodí. Zobrazí se na kartě.",
    },
  },
  required: ["business_id", "reason"],
  additionalProperties: false,
};

export const APP_TOOLS: FunctionTool[] = [
  {
    type: "function",
    name: "present_choices",
    description:
      "Zavolej VŽDY těsně před tím, než uživateli řekneš doporučení, s ID podniků z výsledků nástrojů. Aplikace podle toho zobrazí karty.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        primary: choiceSchema,
        backups: { type: "array", items: choiceSchema, maxItems: 2 },
      },
      required: ["primary"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "open_business",
    description:
      "Zavolej, když uživatel řekne, že chce podnik otevřít/ukázat detail/přejít na něj.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        business_id: { type: "string", description: "Futrumi business ID from a tool result." },
      },
      required: ["business_id"],
      additionalProperties: false,
    },
  },
];

export const LIVE_TOOLS: FunctionTool[] = [...DATA_TOOLS, ...APP_TOOLS];

export const DATA_TOOL_NAMES = new Set(DATA_TOOLS.map((tool) => tool.name));
export const APP_TOOL_NAMES = new Set(APP_TOOLS.map((tool) => tool.name));

const truncate = (text: string | null | undefined, max: number): string | null => {
  if (!text) return null;
  const compact = text.trim().replace(/\s+/g, " ");
  return compact.length <= max ? compact : `${compact.slice(0, max - 1).trimEnd()}...`;
};

const clamp = (value: number | undefined, fallback: number, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
};

export function parseArgs(raw: string): JsonRecord {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JsonRecord) : {};
  } catch {
    return {};
  }
}

function stringArg(args: JsonRecord, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberArg(args: JsonRecord, key: string): number | undefined {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanArg(args: JsonRecord, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === "boolean" ? value : undefined;
}

function compactRecommendation(rec: RecommendationListItem): JsonRecord {
  return {
    recommendation_id: rec.id,
    business: {
      id: rec.business.id,
      name: rec.business.name,
      address: rec.business.address,
      type: rec.business.primaryBusinessType.name,
      openingHours: rec.business.openingHours,
      deeplink: businessDeeplink(rec.business.id),
    },
    expert: {
      id: rec.expert.id,
      name: rec.expert.name,
    },
    quote: truncate(rec.strongQuote, 240),
    description: truncate(rec.description, 320),
    meals: rec.meals.map((meal) => meal.name),
    distanceMeters: rec.distance,
  };
}

function compactBusiness(business: BusinessListItem): JsonRecord {
  return {
    business_id: business.id,
    name: business.name,
    address: business.address,
    type: business.primaryBusinessType.name,
    bio: truncate(business.bio, 260),
    openingHours: business.openingHours,
    expertsWithRecommendationCount: business.expertsWithRecommendationCount,
    distanceMeters: business.distance,
    deeplink: businessDeeplink(business.id),
  };
}

function compactNestedRecommendation(rec: NestedRecommendation): JsonRecord {
  return {
    recommendation_id: rec.id,
    expert: {
      id: rec.expert.id,
      name: rec.expert.name,
    },
    quote: truncate(rec.strongQuote, 220),
    description: truncate(rec.description, 300),
    meals: rec.meals.map((meal) => ({
      name: meal.name,
      description: truncate(meal.description, 180),
    })),
  };
}

function compactBusinessDetail(business: BusinessDetail): JsonRecord {
  return {
    business_id: business.id,
    name: business.name,
    address: business.address,
    type: business.primaryBusinessType.name,
    secondaryTypes: business.secondaryBusinessTypes.map((type) => type.name),
    bio: truncate(business.bio, 360),
    openingHours: business.openingHours,
    expertsWithRecommendationCount: business.expertsWithRecommendationCount,
    links: {
      webUrl: business.webUrl,
      menuUrl: business.menuUrl,
      googleMapsUrl: business.googleMapsUrl,
      instagramUrl: business.instagramUrl,
      facebookUrl: business.facebookUrl,
      phoneNumber: business.phoneNumber,
      deeplink: businessDeeplink(business.id),
    },
    featuredQuotes: business.featuredQuotes.map((quote) => truncate(quote.text, 220)),
    recommendations: business.recommendations.slice(0, 8).map(compactNestedRecommendation),
  };
}

function compactRecommendationDetail(rec: RecommendationDetail): JsonRecord {
  return {
    recommendation_id: rec.id,
    business: {
      id: rec.business.id,
      name: rec.business.name,
      address: rec.business.address,
      type: rec.business.primaryBusinessType.name,
      openingHours: rec.business.openingHours,
      deeplink: businessDeeplink(rec.business.id),
    },
    expert: {
      id: rec.expert.id,
      name: rec.expert.name,
    },
    quote: truncate(rec.strongQuote, 260),
    description: truncate(rec.description, 700),
    meals: rec.meals.map((meal) => ({
      name: meal.name,
      description: truncate(meal.description, 220),
    })),
  };
}

function knownFromRecommendation(rec: RecommendationListItem): KnownBusiness {
  return {
    business_id: rec.business.id,
    name: rec.business.name,
    expert: rec.expert.name,
    quote: truncate(rec.strongQuote, 200) ?? truncate(rec.description, 200),
    deeplink: businessDeeplink(rec.business.id),
  };
}

function knownFromBusinessListItem(business: BusinessListItem): KnownBusiness {
  return {
    business_id: business.id,
    name: business.name,
    expert: null,
    quote: truncate(business.bio, 200),
    deeplink: businessDeeplink(business.id),
  };
}

function knownFromBusinessDetail(business: BusinessDetail): KnownBusiness {
  const first = business.recommendations[0];
  const quote =
    truncate(first?.strongQuote, 200) ??
    truncate(business.featuredQuotes[0]?.text, 200) ??
    truncate(first?.description, 200);
  return {
    business_id: business.id,
    name: business.name,
    expert: first?.expert.name ?? null,
    quote,
    deeplink: businessDeeplink(business.id),
  };
}

function knownFromRecommendationDetail(rec: RecommendationDetail): KnownBusiness {
  return {
    business_id: rec.business.id,
    name: rec.business.name,
    expert: rec.expert.name,
    quote: truncate(rec.strongQuote, 200) ?? truncate(rec.description, 200),
    deeplink: businessDeeplink(rec.business.id),
  };
}

function defaultLocationArgs(args: JsonRecord, context: ToolContext): JsonRecord {
  if (args.locationQuery || args.latitude || args.longitude) return args;
  return {
    ...args,
    ...(context.locationQuery ? { locationQuery: context.locationQuery } : {}),
    ...(typeof context.latitude === "number" ? { latitude: context.latitude } : {}),
    ...(typeof context.longitude === "number" ? { longitude: context.longitude } : {}),
  };
}

export async function runTool(name: string, rawArgs: string, context: ToolContext): Promise<ToolRun> {
  const parsedArgs = defaultLocationArgs(parseArgs(rawArgs), context);
  switch (name) {
    case "search_recommendations": {
      const result = await searchRecommendations({
        query: stringArg(parsedArgs, "query") ?? context.message,
        locationQuery: stringArg(parsedArgs, "locationQuery"),
        latitude: numberArg(parsedArgs, "latitude"),
        longitude: numberArg(parsedArgs, "longitude"),
        radiusMeters: numberArg(parsedArgs, "radiusMeters") ?? context.radiusMeters,
        expert_id: stringArg(parsedArgs, "expert_id"),
        limit: clamp(numberArg(parsedArgs, "limit"), 6, 1, 10),
      });
      return {
        payload: {
          header: result.header,
          resolvedFrom: result.resolvedFrom,
          total: result.total,
          recommendations: result.recommendations.map(compactRecommendation),
        },
        businesses: result.recommendations.map(knownFromRecommendation),
      };
    }
    case "find_recommendations_near": {
      const result = await findRecommendationsNear({
        locationQuery: stringArg(parsedArgs, "locationQuery"),
        latitude: numberArg(parsedArgs, "latitude"),
        longitude: numberArg(parsedArgs, "longitude"),
        radiusMeters: numberArg(parsedArgs, "radiusMeters") ?? context.radiusMeters,
        openNow: booleanArg(parsedArgs, "openNow"),
        limit: clamp(numberArg(parsedArgs, "limit"), 6, 1, 10),
      });
      return {
        payload: {
          header: result.header,
          resolvedFrom: result.resolvedFrom,
          total: result.total,
          businesses: result.businesses.map(compactBusiness),
        },
        businesses: result.businesses.map(knownFromBusinessListItem),
      };
    }
    case "get_business": {
      const businessId = stringArg(parsedArgs, "business_id");
      if (!businessId) return { payload: { error: "Missing business_id." }, businesses: [] };
      const business = await getBusiness({
        business_id: businessId,
        latitude: numberArg(parsedArgs, "latitude"),
        longitude: numberArg(parsedArgs, "longitude"),
      });
      return {
        payload: { business: compactBusinessDetail(business) },
        businesses: [knownFromBusinessDetail(business)],
      };
    }
    case "get_recommendation": {
      const recommendationId = stringArg(parsedArgs, "recommendation_id");
      if (!recommendationId) return { payload: { error: "Missing recommendation_id." }, businesses: [] };
      const recommendation = await getRecommendation({ recommendation_id: recommendationId });
      return {
        payload: { recommendation: compactRecommendationDetail(recommendation) },
        businesses: [knownFromRecommendationDetail(recommendation)],
      };
    }
    default:
      return { payload: { error: `Unknown tool: ${name}` }, businesses: [] };
  }
}

interface RawChoice {
  business_id: string;
  reason: string;
}

function readChoice(value: unknown): RawChoice | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as JsonRecord;
  const id = typeof record.business_id === "string" ? record.business_id.trim() : "";
  if (!id) return null;
  const reason = typeof record.reason === "string" ? record.reason.trim() : "";
  return { business_id: id, reason };
}

export function presentChoices(
  rawArgs: string,
  known: Map<string, KnownBusiness>,
): PresentChoicesPayload | UnknownIdsPayload {
  const args = parseArgs(rawArgs);
  const backups = Array.isArray(args.backups) ? args.backups : [];
  const requested = [readChoice(args.primary), ...backups.map(readChoice)].filter(
    (choice): choice is RawChoice => choice !== null,
  );

  const unknown = requested.filter((choice) => !known.has(choice.business_id));
  if (requested.length === 0 || unknown.length > 0) {
    return {
      ok: false,
      unknown_ids: unknown.map((choice) => choice.business_id),
      hint: "Použij jen business_id, která přišla ve výsledcích nástrojů. Zavolej nejdřív search_recommendations nebo find_recommendations_near.",
    };
  }

  return {
    ok: true,
    shown: requested.map((choice) => ({
      ...(known.get(choice.business_id) as KnownBusiness),
      reason: choice.reason,
    })),
  };
}

export function openBusiness(
  rawArgs: string,
  known: Map<string, KnownBusiness>,
): { ok: true; business_id: string; name: string } | UnknownIdsPayload {
  const args = parseArgs(rawArgs);
  const id = typeof args.business_id === "string" ? args.business_id.trim() : "";
  const match = id ? known.get(id) : undefined;
  if (!match) {
    return {
      ok: false,
      unknown_ids: id ? [id] : [],
      hint: "Neznámé business_id. Otevřít jde jen podnik, který už byl ve výsledcích nástrojů.",
    };
  }
  return { ok: true, business_id: match.business_id, name: match.name };
}
