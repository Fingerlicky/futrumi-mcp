import { businessDeeplink } from "../formatters.js";
import { searchRecommendations } from "../services/search-recommendations.js";
import type { RecommendationListItem } from "../types.js";
import { answerWithOpenAI, canUseOpenAI } from "./openai-decision-engine.js";

export interface ConciergeRequest {
  message: string;
  locationQuery?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  limit?: number;
  useLlm?: boolean;
}

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}...`;

function quoteFor(rec: RecommendationListItem): string {
  const raw = rec.strongQuote?.trim() || rec.description.trim();
  return truncate(raw.replace(/\s+/g, " "), 180);
}

function mealSummary(rec: RecommendationListItem): string {
  if (rec.meals.length === 0) return "";
  return `Doporučené: ${rec.meals.map((meal) => meal.name).join(", ")}.`;
}

function backupLine(rec: RecommendationListItem): string {
  const meal = mealSummary(rec);
  return `- **${rec.business.name}** (${rec.business.primaryBusinessType.name}) - ${rec.expert.name}${meal ? `; ${meal}` : ""} ${businessDeeplink(rec.business.id)}`;
}

function formatDecision(
  message: string,
  resolvedFrom: string,
  recs: RecommendationListItem[],
): string {
  const primary = recs[0];
  if (!primary) {
    return [
      "Tady bych si zatím nebyl dost jistý.",
      `Nenašel jsem použitelné Futrumi doporučení pro "${message}" kolem ${resolvedFrom}.`,
      "Zkus širší lokalitu, větší radius nebo konkrétnější situaci.",
    ].join("\n");
  }

  const backups = recs.slice(1, 3);
  const meal = mealSummary(primary);
  const lines = [
    `Šel bych do: **${primary.business.name}**`,
    "",
    `Proč: V datech Futrumi vyšlo nejrelevantněji pro "${message}". Je to ${primary.business.primaryBusinessType.name.toLocaleLowerCase("cs-CZ")} na adrese ${primary.business.address}. ${meal}`.trim(),
    `Opírám se o: ${primary.expert.name} - "${quoteFor(primary)}"`,
    `Další krok: ${businessDeeplink(primary.business.id)}`,
  ];

  if (backups.length > 0) {
    lines.push("", "Zálohy:", ...backups.map(backupLine));
  }

  lines.push("", `Hledal jsem kolem: ${resolvedFrom}.`);
  return lines.join("\n");
}

async function answerDeterministically(request: ConciergeRequest): Promise<string> {
  const message = request.message.trim();
  if (!message) {
    return "Napiš mi, co řešíš: situaci, lokaci a klidně náladu nebo omezení.";
  }

  const result = await searchRecommendations({
    query: message,
    locationQuery: request.locationQuery,
    latitude: request.latitude,
    longitude: request.longitude,
    radiusMeters: request.radiusMeters,
    limit: request.limit ?? 3,
  });

  return formatDecision(message, result.resolvedFrom, result.recommendations);
}

export async function answerConciergeRequest(request: ConciergeRequest): Promise<string> {
  const message = request.message.trim();
  if (!message) {
    return "Napiš mi, co řešíš: situaci, lokaci a klidně náladu nebo omezení.";
  }

  if (request.useLlm !== false && canUseOpenAI()) {
    try {
      return await answerWithOpenAI({ ...request, message });
    } catch (error) {
      if (process.env.CONCIERGE_FALLBACK_ON_LLM_ERROR === "false") {
        throw error;
      }
      const detail = error instanceof Error ? error.message : String(error);
      const fallback = await answerDeterministically({ ...request, message });
      return [`LLM concierge teď spadl, dávám deterministický fallback.`, `Důvod: ${detail}`, "", fallback].join("\n");
    }
  }

  return answerDeterministically({ ...request, message });
}
