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
import type { ConciergeRequest } from "./decision-engine.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5";
const DEFAULT_MAX_TOOL_ROUNDS = 4;

type JsonRecord = Record<string, unknown>;

interface FunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: JsonRecord;
  strict: false;
}

interface MessageOutput {
  type: "message";
  content?: Array<{ type?: string; text?: string }>;
}

interface FunctionCallOutput {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

type OpenAIOutputItem = MessageOutput | FunctionCallOutput | JsonRecord;

interface OpenAIResponse {
  id: string;
  output?: OpenAIOutputItem[];
  output_text?: string;
  error?: { message?: string };
}

type ResponseInputItem =
  | { role: "user"; content: string }
  | OpenAIOutputItem
  | { type: "function_call_output"; call_id: string; output: string };

const tools: FunctionTool[] = [
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

const truncate = (text: string | null | undefined, max: number): string | null => {
  if (!text) return null;
  const compact = text.trim().replace(/\s+/g, " ");
  return compact.length <= max ? compact : `${compact.slice(0, max - 1).trimEnd()}...`;
};

const clamp = (value: number | undefined, fallback: number, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
};

function parseArgs(raw: string): JsonRecord {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonRecord)
      : {};
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

function defaultLocationArgs(args: JsonRecord, request: ConciergeRequest): JsonRecord {
  if (args.locationQuery || args.latitude || args.longitude) return args;
  return {
    ...args,
    ...(request.locationQuery ? { locationQuery: request.locationQuery } : {}),
    ...(typeof request.latitude === "number" ? { latitude: request.latitude } : {}),
    ...(typeof request.longitude === "number" ? { longitude: request.longitude } : {}),
  };
}

async function runTool(name: string, rawArgs: string, request: ConciergeRequest): Promise<JsonRecord> {
  const parsedArgs = defaultLocationArgs(parseArgs(rawArgs), request);
  switch (name) {
    case "search_recommendations": {
      const result = await searchRecommendations({
        query: stringArg(parsedArgs, "query") ?? request.message,
        locationQuery: stringArg(parsedArgs, "locationQuery"),
        latitude: numberArg(parsedArgs, "latitude"),
        longitude: numberArg(parsedArgs, "longitude"),
        radiusMeters: numberArg(parsedArgs, "radiusMeters") ?? request.radiusMeters,
        expert_id: stringArg(parsedArgs, "expert_id"),
        limit: clamp(numberArg(parsedArgs, "limit"), 6, 1, 10),
      });
      return {
        header: result.header,
        resolvedFrom: result.resolvedFrom,
        total: result.total,
        recommendations: result.recommendations.map(compactRecommendation),
      };
    }
    case "find_recommendations_near": {
      const result = await findRecommendationsNear({
        locationQuery: stringArg(parsedArgs, "locationQuery"),
        latitude: numberArg(parsedArgs, "latitude"),
        longitude: numberArg(parsedArgs, "longitude"),
        radiusMeters: numberArg(parsedArgs, "radiusMeters") ?? request.radiusMeters,
        openNow: booleanArg(parsedArgs, "openNow"),
        limit: clamp(numberArg(parsedArgs, "limit"), 6, 1, 10),
      });
      return {
        header: result.header,
        resolvedFrom: result.resolvedFrom,
        total: result.total,
        businesses: result.businesses.map(compactBusiness),
      };
    }
    case "get_business": {
      const businessId = stringArg(parsedArgs, "business_id");
      if (!businessId) return { error: "Missing business_id." };
      const business = await getBusiness({
        business_id: businessId,
        latitude: numberArg(parsedArgs, "latitude"),
        longitude: numberArg(parsedArgs, "longitude"),
      });
      return { business: compactBusinessDetail(business) };
    }
    case "get_recommendation": {
      const recommendationId = stringArg(parsedArgs, "recommendation_id");
      if (!recommendationId) return { error: "Missing recommendation_id." };
      const recommendation = await getRecommendation({ recommendation_id: recommendationId });
      return { recommendation: compactRecommendationDetail(recommendation) };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function extractText(response: OpenAIResponse): string {
  if (response.output_text?.trim()) return response.output_text.trim();
  const parts: string[] = [];
  for (const item of response.output ?? []) {
    if (!isMessageOutput(item)) continue;
    for (const content of item.content ?? []) {
      if (content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function isMessageOutput(item: OpenAIOutputItem): item is MessageOutput {
  return item.type === "message";
}

function functionCalls(response: OpenAIResponse): FunctionCallOutput[] {
  return (response.output ?? []).filter(
    (item): item is FunctionCallOutput =>
      item.type === "function_call" &&
      typeof item.call_id === "string" &&
      typeof item.name === "string" &&
      typeof item.arguments === "string",
  );
}

async function createResponse(input: ResponseInputItem[]): Promise<OpenAIResponse> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
      instructions: SYSTEM_PROMPT,
      input,
      tools,
      tool_choice: "auto",
      parallel_tool_calls: false,
      max_output_tokens: 1400,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as OpenAIResponse;
  if (data.error?.message) throw new Error(data.error.message);
  return data;
}

const SYSTEM_PROMPT = `Jsi Futrumi premium concierge: rozhodný, vkusný a praktický průvodce českým gastrem.

Pravidla:
- Odpovídej česky, pokud uživatel nepíše jinak.
- Každá zpráva je samostatný, úplný dotaz. Nemáš paměť na předchozí konverzaci a nevidíš starší zprávy.
- Když uživatel navazuje na předchozí odpověď ("co jsi doporučil", "ten první", "a co druhý", "tu rezervaci"), krátce vysvětli, že si historii nepamatuješ, a požádej, ať pošle celý dotaz znovu v jedné zprávě.
- Nejsi katalog. Vyber 1 hlavní volbu a maximálně 2 zálohy.
- Používej Futrumi nástroje pro skutečná data. Nevymýšlej podniky, jídla, ceny, rezervace ani otevírací dobu.
- Nenabízej, že zařídíš rezervaci, zavoláš podniku nebo ověříš aktuální otevírací dobu — to neumíš. Jako další krok nabídni jen to, na co máš data: deeplink nebo mapový odkaz.
- Neslibuj akce do dalšího kroku, na které nemáš nástroj. Odpověď je sama o sobě kompletní.
- U každé volby vysvětli fit na kontext uživatele.
- Uveď provenance: expert, citace nebo konkrétní doporučené jídlo/drink.
- Když chybí lokalita nebo zásadní kontext, nepokračuj dialogem — požádej uživatele, ať pošle celý dotaz v jedné zprávě i s lokalitou, a krátce řekni, co doplnit.
- Pokud data nestačí, řekni to a navrhni širší radius nebo kompromis.

Formát:
Šel bych do: [podnik]
Proč: [stručně a konkrétně]
Opírám se o: [expert] - "[krátká citace]" / [doporučené jídlo]
Další krok: [deeplink/mapový link pokud je v datech]

Zálohy:
- [podnik] - [kdy dává smysl]
- [podnik] - [kdy dává smysl]`;

function userInput(request: ConciergeRequest): string {
  return [
    `Dotaz: ${request.message}`,
    request.locationQuery ? `Výchozí lokalita: ${request.locationQuery}` : "",
    typeof request.radiusMeters === "number" ? `Preferovaný radius: ${request.radiusMeters} m` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function canUseOpenAI(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim()) && process.env.CONCIERGE_USE_LLM !== "false";
}

export async function answerWithOpenAI(request: ConciergeRequest): Promise<string> {
  const maxToolRounds = clamp(
    Number.parseInt(process.env.CONCIERGE_MAX_TOOL_ROUNDS ?? "", 10),
    DEFAULT_MAX_TOOL_ROUNDS,
    1,
    8,
  );
  const input: ResponseInputItem[] = [{ role: "user", content: userInput(request) }];

  for (let round = 0; round < maxToolRounds; round += 1) {
    const response = await createResponse(input);
    const calls = functionCalls(response);
    if (calls.length === 0) {
      const text = extractText(response);
      return text || "Nemám dost jistoty na doporučení. Doplníš prosím lokalitu a situaci?";
    }

    input.push(...(response.output ?? []));
    for (const call of calls) {
      const output = await runTool(call.name, call.arguments, request);
      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(output),
      });
    }
  }

  return "Potřebuju ještě jednu věc upřesnit, abych nevařil z vody: pro jakou lokalitu a situaci to vybíráme?";
}
