import type { FunctionTool } from "openai/resources/live/live";

import { businessDeeplink, expertDeeplink } from "../formatters.js";
import { findRecommendationsNear } from "../services/find-recommendations-near.js";
import { getBusiness } from "../services/get-business.js";
import { getExpert } from "../services/get-expert.js";
import { getRecommendation } from "../services/get-recommendation.js";
import { listExperts } from "../services/list-experts.js";
import { searchRecommendations } from "../services/search-recommendations.js";
import { topBusinesses } from "../services/top-businesses.js";
import { dailyMenu, loadMenuData, menuSummary, searchMenu } from "../services/menu-data.js";
import { resolveLocation } from "../geocode.js";
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
    name: "top_businesses",
    description:
      "Žebříček podniků v okolí podle počtu expertů, kteří je doporučují. Použij na dotazy typu „nej podniky v Brně“, „kam chodí nejvíc expertů“, „nejdoporučovanější kavárny v okolí“. Rádius je kruh kolem středu, tedy okolí, ne přesná hranice města. Na počet doporučení jednoho experta použij list_experts.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        locationQuery: {
          type: "string",
          description: 'Město, čtvrť nebo kraj, např. "Brno" nebo "Jihomoravský kraj". Vynech pro žebříček přes celou republiku.',
        },
        latitude: { type: "number" },
        longitude: { type: "number" },
        radiusMeters: { type: "integer", minimum: 100, maximum: 50000 },
        businessType: {
          type: "string",
          description: 'Filtr na typ podniku, např. "kavárna", "restaurace", "bar".',
        },
        limit: { type: "integer", minimum: 1, maximum: 25 },
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
  {
    type: "function",
    name: "search_menu_items",
    description:
      "Najde konkrétní jídlo nebo pití v jídelních lístcích a aktuálních nabídkách podniků (zatím jen Brno): kde se dá dát svíčková, kolik stojí, kdo má dnes polévku. Vrací podnik, přesný název z lístku, cenu, odkud to je a vzdálenost. Na doporučení expertů použij search_recommendations.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Jídlo nebo pití, jak ho uživatel řekl, např. „svíčková“, „smažený sýr“, „flat white“." },
        locationQuery: { type: "string", description: "Místo, kolem kterého hledat." },
        latitude: { type: "number" },
        longitude: { type: "number" },
        radiusMeters: { type: "integer", minimum: 100, maximum: 50000 },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_daily_menu",
    description:
      "Denní a týdenní menu a aktuální nabídky jednoho podniku (zatím jen Brno): co mají dnes k obědu. Vrací i odkud nabídka je a kdy byla zveřejněná.",
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
  {
    type: "function",
    name: "select_route_stop",
    description:
      "Zvýrazní zastávku z find_food_along_route na mapě i v seznamu aplikace. Volej pokaždé, když o konkrétní zastávce mluvíš nebo si ji uživatel vybere.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        business_id: { type: "string", description: "business_id ze stops posledního find_food_along_route." },
      },
      required: ["business_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "navigate_to_stop",
    description:
      "Otevře navigační aplikaci do vybrané zastávky. Volej, až uživatel výslovně řekne, že chce vyrazit. Google Maps povede přes zastávku až do cíle, ostatní jen k zastávce.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        business_id: { type: "string", description: "business_id ze stops posledního find_food_along_route." },
        app: {
          type: "string",
          enum: ["google_maps", "waze", "apple_maps", "mapy_cz"],
          description: "Vynech, když výsledek find_food_along_route vrátil navigation_app a uživatel nechce jinou.",
        },
      },
      required: ["business_id"],
      additionalProperties: false,
    },
  },
];

/** Computed by the app (Apple Maps routing is free there and unavailable here); the server only waits for the result. */
export const CLIENT_TOOLS: FunctionTool[] = [
  {
    type: "function",
    name: "find_food_along_route",
    description:
      "Najde doporučené podniky po cestě autem nebo pěšky a spočítá, o kolik minut zajížďka prodlouží cestu a kde na trase podnik leží. Použij na „jedu do X, je po cestě něco dobrého?“, „kde se cestou najíst“, „jdu pěšky na nádraží, kde si cestou dám kafe“. Trasu počítá aplikace přes Apple Mapy a sama otevře obrazovku Po cestě s trasou a zastávkami na mapě. Volej znovu při každé změně (jiná trasa, jiný typ, známka).",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        destination: {
          type: "string",
          description: 'Cíl cesty, např. "Vimperk" nebo "Šumava, Kvilda". "current_location", když jede sem, kde je teď (třeba domů).',
        },
        origin: { type: "string", description: 'Start cesty. Vynech nebo "current_location", když vyjíždí odsud.' },
        via: { type: "string", description: 'Místo, přes které uživatel jede, když ho zmíní, např. "Tábor".' },
        travel_mode: {
          type: "string",
          enum: ["car", "walk"],
          description: "walk, když jde pěšky („jdu“, „procházka“, „pěšky“); jinak car (výchozí). Pěšky je koridor jen pár set metrů a zajížďky v minutách chůze.",
        },
        avoid_tolls: {
          type: "boolean",
          description: "Jen autem: true, když uživatel nemá dálniční známku. Vynech, když to neřekl — aplikace použije uloženou odpověď.",
        },
        departure_time: {
          type: "string",
          description: "Čas odjezdu v ISO 8601 s časovou zónou, např. 2026-09-25T08:00:00+02:00. Vynech pro odjezd hned.",
        },
        stop_position: {
          type: "string",
          enum: ["middle", "early", "late", "anywhere"],
          description: "Kde na trase chce zastavit. Výchozí middle (zhruba 25–80 % cesty), i když jen řekne, že nechce hned na začátku. late jen na výslovné „až ke konci“.",
        },
        kind: {
          type: "string",
          enum: ["food", "coffee", "shopping", "any"],
          description: "food = najíst se (výchozí), coffee = kavárny a cukrárny, shopping = nakoupit na farmě, v obchodě nebo pekárně, any = cokoli.",
        },
        max_detour_minutes: { type: "integer", minimum: 5, maximum: 90, description: "Výchozí 30 autem, 20 pěšky." },
        route_index: {
          type: "integer",
          minimum: 0,
          maximum: 2,
          description: "Která z alternativních tras z předchozího výsledku (alternatives). Vynech pro doporučenou trasu.",
        },
      },
      required: ["destination"],
      additionalProperties: false,
    },
  },
];

export const LIVE_TOOLS: FunctionTool[] = [...DATA_TOOLS, ...SESSION_TOOLS, ...APP_TOOLS, ...CLIENT_TOOLS];

export const LIVE_TOOL_NAMES = new Set(LIVE_TOOLS.map((tool) => tool.name));
export const DATA_TOOL_NAMES = new Set(DATA_TOOLS.map((tool) => tool.name));
export const SESSION_TOOL_NAMES = new Set(SESSION_TOOLS.map((tool) => tool.name));
export const APP_TOOL_NAMES = new Set(APP_TOOLS.map((tool) => tool.name));
export const CLIENT_TOOL_NAMES = new Set(CLIENT_TOOLS.map((tool) => tool.name));

const truncate = (text: string | null | undefined, max: number): string | null => {
  if (!text) return null;
  const compact = text.trim().replace(/\s+/g, " ");
  return compact.length <= max ? compact : `${compact.slice(0, max - 1).trimEnd()}...`;
};

// Den podle Prahy, ne podle UTC: denní menu po půlnoci UTC (1–2 h ráno) by jinak
// patřilo včerejšku.
function pragueToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(new Date());
}

function dedupeKnown(list: KnownBusiness[]): KnownBusiness[] {
  return [...new Map(list.map((b) => [b.business_id, b])).values()];
}

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

/**
 * OpenAI delivers tool arguments as a JSON string, Gemini as an already-parsed
 * object. Every tool entry point takes either so both providers share one dispatcher.
 */
export type ToolArgs = string | JsonRecord;

const asJsonRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};

export function parseArgs(raw: ToolArgs): JsonRecord {
  if (typeof raw !== "string") return asJsonRecord(raw);
  try {
    return asJsonRecord(JSON.parse(raw) as unknown);
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

/** Leaderboard rows are read aloud, so they carry only what the sentence needs. */
function compactTopBusiness(business: BusinessListItem, index: number): JsonRecord {
  return {
    rank: index + 1,
    business_id: business.id,
    name: business.name,
    expertsWithRecommendationCount: business.expertsWithRecommendationCount,
    type: business.primaryBusinessType.name,
    address: business.address,
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

export async function runTool(name: string, rawArgs: ToolArgs, context: ToolContext): Promise<ToolRun> {
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
    case "top_businesses": {
      const result = await topBusinesses({
        locationQuery: stringArg(parsedArgs, "locationQuery"),
        latitude: numberArg(parsedArgs, "latitude"),
        longitude: numberArg(parsedArgs, "longitude"),
        radiusMeters: numberArg(parsedArgs, "radiusMeters") ?? context.radiusMeters,
        businessType: stringArg(parsedArgs, "businessType"),
        limit: clamp(numberArg(parsedArgs, "limit"), 10, 1, 25),
      });
      return {
        payload: {
          header: result.header,
          resolvedFrom: result.resolvedFrom,
          radiusMeters: result.radiusMeters,
          total: result.matchedCount,
          businesses: result.businesses.map(compactTopBusiness),
        },
        businesses: result.businesses.map(knownFromBusinessListItem),
      };
    }
    case "search_menu_items": {
      const query = stringArg(parsedArgs, "query") ?? context.message ?? "";
      const data = await loadMenuData();
      if (!data) return { payload: { error: "Data lístků teď nejsou k dispozici." }, businesses: [] };
      let location;
      let resolvedFrom: string | undefined;
      try {
        const resolved = await resolveLocation({
          latitude: numberArg(parsedArgs, "latitude"),
          longitude: numberArg(parsedArgs, "longitude"),
          locationQuery: stringArg(parsedArgs, "locationQuery"),
        });
        location = resolved.location;
        resolvedFrom = resolved.resolvedFrom;
      } catch {
        location = undefined;
      }
      const result = searchMenu(data, {
        query,
        location,
        radiusMeters: numberArg(parsedArgs, "radiusMeters"),
        today: pragueToday(),
        limit: clamp(numberArg(parsedArgs, "limit"), 6, 1, 10),
      });
      return {
        payload: {
          coverage: `lístky a nabídky: ${data.city}, data z ${data.generatedOn}`,
          resolvedFrom,
          total: result.total,
          hits: result.hits,
          hint: result.total
            ? "Řekni podnik, cenu a odkud to je; u nabídky s „nejisté“ dodej, že je dobré to ověřit."
            : "Nic nenalezeno. Zkus obecnější slovo, nebo řekni, že lístek toho podniku nemáme.",
        },
        businesses: dedupeKnown(result.hits.map((hit) => ({
          business_id: hit.business_id, name: hit.business, expert: null, quote: null,
          deeplink: businessDeeplink(hit.business_id),
        }))),
      };
    }
    case "get_daily_menu": {
      const businessId = stringArg(parsedArgs, "business_id");
      if (!businessId) return { payload: { error: "Missing business_id." }, businesses: [] };
      const data = await loadMenuData();
      const menu = data ? dailyMenu(data, businessId, pragueToday()) : null;
      if (!menu) {
        return { payload: { business_id: businessId, error: "Pro tento podnik lístek ani nabídky nemáme." }, businesses: [] };
      }
      return {
        payload: { ...menu, hint: menu.offers.length ? undefined : "Dnešní nabídku nemáme; řekni to a nevymýšlej." },
        businesses: [{ business_id: menu.business_id, name: menu.business, expert: null, quote: null,
          deeplink: businessDeeplink(menu.business_id) }],
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
      const data = await loadMenuData();
      const menu = data ? menuSummary(data, business.id) : null;
      return {
        payload: { business: compactBusinessDetail(business), ...(menu ? { menu } : {}) },
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
  rawArgs: ToolArgs,
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

export function screenContextPayload(
  screen: string | null,
): { ok: true; screen: string } | { ok: false; screen: null; hint: string } {
  if (!screen) {
    return {
      ok: false,
      screen: null,
      hint: "Aplikace neposlala kontext obrazovky. Zeptej se, o který podnik jde.",
    };
  }
  return { ok: true, screen };
}

export function toChoicesSnapshot(shown: PresentedChoice[]): ChoicesSnapshot | null {
  const [primary, ...backups] = shown;
  if (!primary) return null;
  return { primary, backups, presented_at: new Date().toISOString() };
}

export function openBusiness(
  rawArgs: ToolArgs,
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
  rawArgs: ToolArgs,
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
  rawArgs: ToolArgs,
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

/** The app reports stops it found; registering them lets present_choices and open_business name them. */
export function knownFromRouteResult(result: unknown): KnownBusiness[] {
  const stops = asJsonRecord(result).stops;
  if (!Array.isArray(stops)) return [];
  return stops.flatMap((raw) => {
    const stop = asJsonRecord(raw);
    const id = stringArg(stop, "business_id");
    const name = stringArg(stop, "name");
    if (!id || !name) return [];
    const latitude = numberArg(stop, "latitude");
    const longitude = numberArg(stop, "longitude");
    return [
      {
        business_id: id,
        name,
        expert: null,
        quote: null,
        deeplink: businessDeeplink(id),
        ...(latitude !== undefined && longitude !== undefined ? { latitude, longitude } : {}),
      },
    ];
  });
}

/** Route stop tools act in the app; the ID must come from the trip the app reported. */
export function routeStopAction(
  rawArgs: ToolArgs,
  known: Map<string, KnownBusiness>,
): { ok: true; handled_by: "app"; business_id: string; name: string } | UnknownIdsPayload {
  const result = openBusiness(rawArgs, known);
  if (result.ok) return result;
  return { ...result, hint: "Použij business_id ze stops posledního find_food_along_route." };
}
