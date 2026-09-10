import type { FunctionTool } from "openai/resources/live/live";

import { businessDeeplink, expertDeeplink } from "../formatters.js";
import { findRecommendationsNear } from "../services/find-recommendations-near.js";
import { getBusiness } from "../services/get-business.js";
import { getExpert } from "../services/get-expert.js";
import { getRecommendation } from "../services/get-recommendation.js";
import { listExperts } from "../services/list-experts.js";
import { searchRecommendations } from "../services/search-recommendations.js";
import type {
  BusinessDetail,
  BusinessListItem,
  ExpertDetail,
  ExpertListItem,
  Location,
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
  latitude?: number;
  longitude?: number;
}

export interface KnownExpert {
  expert_id: string;
  name: string;
  deeplink: string;
}

export interface ToolRun {
  payload: JsonRecord;
  businesses: KnownBusiness[];
  experts?: KnownExpert[];
}

export interface PresentedChoice extends KnownBusiness {
  reason: string;
}

export interface PresentChoicesPayload {
  ok: true;
  shown: PresentedChoice[];
}

/** Shape served by GET /live/session/:id/choices — the iOS/web client contract. */
export interface ChoicesSnapshot {
  primary: PresentedChoice;
  backups: PresentedChoice[];
  presented_at: string;
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
      "Get full Futrumi detail for one business, including links, featured quotes, and all expert recommendations. Použij vždy, když se uživatel ptá, kdo podnik doporučuje, co si tam dát, kde to je nebo kdy mají otevřeno.",
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
  {
    type: "function",
    name: "get_expert",
    description:
      "Detail jednoho experta Futrumi (jméno, bio, počet doporučení) a jeho doporučené podniky. Použij, když se uživatel ptá na konkrétního experta nebo chce vědět, kam chodí. Znáš-li jen jméno, nejdřív zavolej list_experts a najdi jeho ID.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        expert_id: { type: "string", description: "Futrumi expert ID from a tool result." },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["expert_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "list_experts",
    description:
      "Seznam expertů Futrumi se jménem, bio a počtem doporučení. Použij na dotaz „kdo je <jméno>“ nebo „jaké máte experty“: najdi experta podle jména a pak zavolej get_expert s jeho ID. Nikdy jméno experta nehádej z paměti.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        pageNumber: { type: "integer", minimum: 0 },
        pageSize: { type: "integer", minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
  },
];

/** Answered from live-session state, not from the Futrumi API. */
export const SESSION_TOOLS: FunctionTool[] = [
  {
    type: "function",
    name: "get_screen_context",
    description:
      "Vrátí, co má uživatel právě na obrazovce aplikace (otevřený podnik nebo expert). Zavolej, když uživatel mluví o „tomhle podniku“, „tady“ nebo „co si tu dát“ a nevíš, k čemu to vztáhnout.",
    strict: false,
    parameters: {
      type: "object",
      properties: {},
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
  {
    type: "function",
    name: "open_expert",
    description: "Zavolej, když uživatel chce otevřít nebo zobrazit experta (jeho profil v aplikaci).",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        expert_id: { type: "string", description: "Futrumi expert ID from a tool result." },
      },
      required: ["expert_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "show_on_map",
    description:
      "Zavolej, když uživatel chce podnik vidět na mapě nebo se ptá, kde to je. Aplikace na mapu odscrolluje sama.",
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

export const LIVE_TOOLS: FunctionTool[] = [...DATA_TOOLS, ...SESSION_TOOLS, ...APP_TOOLS];

export const DATA_TOOL_NAMES = new Set(DATA_TOOLS.map((tool) => tool.name));
export const SESSION_TOOL_NAMES = new Set(SESSION_TOOLS.map((tool) => tool.name));
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

function coordsOf(location: Location | null | undefined): { latitude: number; longitude: number } | JsonRecord {
  if (!location) return {};
  const { latitude, longitude } = location;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return {};
  return { latitude, longitude };
}

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

function compactExpertDetail(expert: ExpertDetail): JsonRecord {
  return {
    expert_id: expert.id,
    name: expert.name,
    bio: truncate(expert.bio, 400),
    recommendationCount: expert.recommendationCount,
    deeplink: expertDeeplink(expert.id),
  };
}

function compactExpertListItem(expert: ExpertListItem): JsonRecord {
  return {
    expert_id: expert.id,
    name: expert.name,
    bio: truncate(expert.bio, 160),
    recommendationCount: expert.recommendationCount,
  };
}

function knownFromRecommendation(rec: RecommendationListItem): KnownBusiness {
  return {
    business_id: rec.business.id,
    name: rec.business.name,
    expert: rec.expert.name,
    quote: truncate(rec.strongQuote, 200) ?? truncate(rec.description, 200),
    deeplink: businessDeeplink(rec.business.id),
    ...coordsOf(rec.business.location),
  };
}

function knownFromBusinessListItem(business: BusinessListItem): KnownBusiness {
  return {
    business_id: business.id,
    name: business.name,
    expert: null,
    quote: truncate(business.bio, 200),
    deeplink: businessDeeplink(business.id),
    ...coordsOf(business.location),
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
    ...coordsOf(business.location),
  };
}

function knownFromRecommendationDetail(rec: RecommendationDetail): KnownBusiness {
  return {
    business_id: rec.business.id,
    name: rec.business.name,
    expert: rec.expert.name,
    quote: truncate(rec.strongQuote, 200) ?? truncate(rec.description, 200),
    deeplink: businessDeeplink(rec.business.id),
    ...coordsOf(rec.business.location),
  };
}

function knownExpertRef(expert: { id: string; name: string }): KnownExpert {
  return { expert_id: expert.id, name: expert.name, deeplink: expertDeeplink(expert.id) };
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
        experts: result.recommendations.map((rec) => knownExpertRef(rec.expert)),
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
        experts: business.recommendations.map((rec) => knownExpertRef(rec.expert)),
      };
    }
    case "get_recommendation": {
      const recommendationId = stringArg(parsedArgs, "recommendation_id");
      if (!recommendationId) return { payload: { error: "Missing recommendation_id." }, businesses: [] };
      const recommendation = await getRecommendation({ recommendation_id: recommendationId });
      return {
        payload: { recommendation: compactRecommendationDetail(recommendation) },
        businesses: [knownFromRecommendationDetail(recommendation)],
        experts: [knownExpertRef(recommendation.expert)],
      };
    }
    case "get_expert": {
      const expertId = stringArg(parsedArgs, "expert_id");
      if (!expertId) return { payload: { error: "Missing expert_id." }, businesses: [] };
      const result = await getExpert({
        expert_id: expertId,
        limit: clamp(numberArg(parsedArgs, "limit"), 8, 1, 20),
      });
      return {
        payload: {
          expert: compactExpertDetail(result.expert),
          recommendations: result.recommendations.map(compactRecommendation),
        },
        businesses: result.recommendations.map(knownFromRecommendation),
        experts: [knownExpertRef(result.expert)],
      };
    }
    case "list_experts": {
      const result = await listExperts({
        pageNumber: clamp(numberArg(parsedArgs, "pageNumber"), 0, 0, 200),
        pageSize: clamp(numberArg(parsedArgs, "pageSize"), 20, 1, 50),
      });
      return {
        payload: {
          total: result.total,
          experts: result.experts.map(compactExpertListItem),
        },
        businesses: [],
        experts: result.experts.map(knownExpertRef),
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

function needsEnrichment(business: KnownBusiness | undefined): boolean {
  if (!business) return false;
  return !business.expert || typeof business.latitude !== "number";
}

/**
 * Cards must name an expert even for backups, and the map needs coordinates, but
 * find_recommendations_near returns neither — fill the gaps from the detail query.
 */
async function enrichKnown(ids: string[], known: Map<string, KnownBusiness>): Promise<void> {
  const missing = ids.filter((id) => needsEnrichment(known.get(id)));
  if (missing.length === 0) return;
  await Promise.all(
    missing.map(async (id) => {
      try {
        const detail = await getBusiness({ business_id: id });
        const enriched = knownFromBusinessDetail(detail);
        const current = known.get(id);
        known.set(id, {
          ...(current ?? {}),
          ...enriched,
          expert: enriched.expert ?? current?.expert ?? null,
          quote: enriched.quote ?? current?.quote ?? null,
        });
      } catch {
        // Keep the thinner known entry; cards still render without the expert line.
      }
    }),
  );
}

export async function presentChoices(
  rawArgs: string,
  known: Map<string, KnownBusiness>,
): Promise<PresentChoicesPayload | UnknownIdsPayload> {
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

  await enrichKnown(
    requested.map((choice) => choice.business_id),
    known,
  );

  return {
    ok: true,
    shown: requested.map((choice) => ({
      ...(known.get(choice.business_id) as KnownBusiness),
      reason: choice.reason,
    })),
  };
}

export function toChoicesSnapshot(shown: PresentedChoice[]): ChoicesSnapshot | null {
  const [primary, ...backups] = shown;
  if (!primary) return null;
  return { primary, backups, presented_at: new Date().toISOString() };
}

export function openBusiness(
  rawArgs: string,
  known: Map<string, KnownBusiness>,
): { ok: true; handled_by: "app"; business_id: string; name: string } | UnknownIdsPayload {
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
  return { ok: true, handled_by: "app", business_id: match.business_id, name: match.name };
}

export function openExpert(
  rawArgs: string,
  known: Map<string, KnownExpert>,
):
  | { ok: true; handled_by: "app"; expert_id: string; name: string; deeplink: string }
  | UnknownIdsPayload {
  const args = parseArgs(rawArgs);
  const id = typeof args.expert_id === "string" ? args.expert_id.trim() : "";
  const match = id ? known.get(id) : undefined;
  if (!match) {
    return {
      ok: false,
      unknown_ids: id ? [id] : [],
      hint: "Neznámé expert_id. Zavolej nejdřív list_experts nebo get_expert a použij ID z výsledku.",
    };
  }
  return { ok: true, handled_by: "app", ...match };
}

export interface ShowOnMapPayload {
  ok: true;
  handled_by: "app";
  business: {
    id: string;
    name: string;
    latitude: number | null;
    longitude: number | null;
  };
}

export async function showOnMap(
  rawArgs: string,
  known: Map<string, KnownBusiness>,
): Promise<ShowOnMapPayload | UnknownIdsPayload> {
  const args = parseArgs(rawArgs);
  const id = typeof args.business_id === "string" ? args.business_id.trim() : "";
  if (!id) {
    return { ok: false, unknown_ids: [], hint: "Chybí business_id." };
  }
  let match = known.get(id);
  if (!match || typeof match.latitude !== "number") {
    try {
      const detail = await getBusiness({ business_id: id });
      match = { ...(match ?? {}), ...knownFromBusinessDetail(detail) };
      known.set(id, match);
    } catch {
      // Fall through: an unknown ID with no detail cannot be shown on the map.
    }
  }
  if (!match) {
    return {
      ok: false,
      unknown_ids: [id],
      hint: "Neznámé business_id. Na mapě jde ukázat jen podnik z výsledků nástrojů.",
    };
  }
  return {
    ok: true,
    handled_by: "app",
    business: {
      id: match.business_id,
      name: match.name,
      latitude: typeof match.latitude === "number" ? match.latitude : null,
      longitude: typeof match.longitude === "number" ? match.longitude : null,
    },
  };
}
