import type { RecommendationListItem } from "./types.js";

interface WeightedText {
  text: string | null | undefined;
  weight: number;
}

interface Concept {
  id: string;
  triggers: string[];
  terms: string[];
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "do",
  "for",
  "good",
  "in",
  "mi",
  "na",
  "near",
  "nejaky",
  "nejake",
  "nejakou",
  "nejlepsi",
  "neco",
  "of",
  "okolo",
  "pro",
  "the",
  "to",
  "u",
  "v",
  "ve",
  "with",
  "z",
]);

const CONCEPTS: Concept[] = [
  {
    id: "ramen",
    triggers: ["ramen"],
    terms: ["ramen", "noodle", "nudle", "shoyu", "tonkotsu", "tantanmen"],
  },
  {
    id: "vietnamese",
    triggers: ["vietnam", "vietnams", "pho", "bun bo", "banh mi"],
    terms: ["vietnam", "vietnams", "pho", "bun bo", "banh mi", "bun cha", "nem", "viet"],
  },
  {
    id: "italian",
    triggers: ["ital", "italsk", "pizza", "pasta", "testoviny"],
    terms: ["ital", "italsk", "pizza", "pasta", "testoviny", "risotto", "gnocchi", "focaccia"],
  },
  {
    id: "japanese",
    triggers: ["japan", "japonsk", "sushi", "izakaya"],
    terms: ["japan", "japonsk", "sushi", "izakaya", "ramen", "udon", "sashimi", "bao"],
  },
  {
    id: "coffee",
    triggers: ["kava", "kafe", "coffee", "espresso", "kavarna"],
    terms: ["kava", "kafe", "coffee", "espresso", "cappuccino", "filtr", "kavarna", "prazirn"],
  },
  {
    id: "breakfast-brunch",
    triggers: ["snidane", "breakfast", "brunch"],
    terms: ["snidane", "breakfast", "brunch", "vejce", "livance", "palacink", "benedict"],
  },
  {
    id: "bakery",
    triggers: ["pekarn", "pecivo", "croissant", "chleba", "chleb"],
    terms: ["pekarn", "pecivo", "croissant", "chleba", "chleb", "loupak", "kolac", "buchta"],
  },
  {
    id: "dessert",
    triggers: ["dezert", "sladk", "zmrzlina", "cukrarna", "dort"],
    terms: ["dezert", "sladk", "zmrzlina", "gelato", "cukrarna", "dort", "kolac"],
  },
  {
    id: "wine-date",
    triggers: ["rande", "date", "romant", "vino", "vinarn"],
    terms: ["vino", "vinarn", "wine", "bar", "koktejl", "cocktail", "tapas", "degust", "servis"],
  },
  {
    id: "beer-pub",
    triggers: ["pivo", "hospoda", "pub", "plzen"],
    terms: ["pivo", "hospoda", "pub", "plzen", "tank", "vycep", "lager"],
  },
  {
    id: "lunch",
    triggers: ["obed", "lunch", "menicko", "rychly"],
    terms: ["obed", "lunch", "menicko", "bistro", "kantyna", "jideln", "rychl"],
  },
  {
    id: "cheap",
    triggers: ["levn", "cheap", "budget", "dostupn"],
    terms: ["levn", "cheap", "budget", "jideln", "bistro", "kantyna", "street", "foodtruck"],
  },
  {
    id: "business-meeting",
    triggers: ["klient", "business", "schuzka", "meeting"],
    terms: ["restaurace", "vino", "servis", "degust", "fine", "elegant", "hotel"],
  },
  {
    id: "kids",
    triggers: ["deti", "dite", "kids", "family", "rodin"],
    terms: ["zahrada", "park", "cukrarna", "zmrzlina", "palacink", "rodin"],
  },
  {
    id: "outdoor-trip",
    triggers: ["vylet", "outdoor", "terasa", "venku", "zahradka"],
    terms: ["vylet", "terasa", "zahrada", "farma", "foodtruck", "bistro", "kava"],
  },
];

export function normalizeSearchText(text: string): string {
  return text
    .toLocaleLowerCase("cs-CZ")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenize(text: string): string[] {
  if (!text) return [];
  return normalizeSearchText(text)
    .split(" ")
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function containsTerm(normalizedText: string, tokenSet: Set<string>, term: string): boolean {
  const normalizedTerm = normalizeSearchText(term);
  if (!normalizedTerm) return false;
  if (normalizedTerm.includes(" ")) return normalizedText.includes(normalizedTerm);
  if (tokenSet.has(normalizedTerm)) return true;
  if (normalizedTerm.length < 4) return false;
  return [...tokenSet].some((token) => token.startsWith(normalizedTerm));
}

function conceptMatchesQuery(concept: Concept, queryText: string, queryTokens: Set<string>): boolean {
  return concept.triggers.some((trigger) => containsTerm(queryText, queryTokens, trigger));
}

function scoreField(
  field: WeightedText,
  queryTokens: string[],
  activeConcepts: Concept[],
  fullQuery: string,
): number {
  if (!field.text) return 0;

  const text = normalizeSearchText(field.text);
  if (!text) return 0;

  const tokens = new Set(tokenize(text));
  let score = 0;

  if (fullQuery.length >= 4 && text.includes(fullQuery)) {
    score += 8 * field.weight;
  }

  for (const queryToken of queryTokens) {
    if (tokens.has(queryToken)) {
      score += 3 * field.weight;
    } else if (queryToken.length >= 4 && text.includes(queryToken)) {
      score += 1.2 * field.weight;
    }
  }

  for (const concept of activeConcepts) {
    let conceptHits = 0;
    for (const term of concept.terms) {
      if (containsTerm(text, tokens, term)) conceptHits += 1;
    }
    if (conceptHits > 0) {
      score += Math.min(conceptHits, 3) * 1.8 * field.weight;
    }
  }

  return score;
}

function recommendationFields(rec: RecommendationListItem): WeightedText[] {
  return [
    { text: rec.business.name, weight: 7 },
    { text: rec.meals.map((meal) => meal.name).join(" "), weight: 8 },
    { text: rec.business.primaryBusinessType.name, weight: 5 },
    { text: rec.strongQuote, weight: 4 },
    { text: rec.description, weight: 3 },
    { text: rec.business.address, weight: 1 },
    { text: rec.expert.name, weight: 1 },
  ];
}

function scoreRecommendation(
  rec: RecommendationListItem,
  queryTokens: string[],
  activeConcepts: Concept[],
  fullQuery: string,
): number {
  const fieldScore = recommendationFields(rec).reduce(
    (sum, field) => sum + scoreField(field, queryTokens, activeConcepts, fullQuery),
    0,
  );
  const expertSignal = fieldScore > 0 ? Math.min(rec.meals.length, 3) * 0.75 : 0;
  return fieldScore + expertSignal;
}

export function rankRecommendationsByQuery(
  recs: RecommendationListItem[],
  query: string | undefined,
  limit: number,
): RecommendationListItem[] {
  const fullQuery = normalizeSearchText(query ?? "");
  if (!fullQuery) return recs.slice(0, limit);

  const queryTokens = unique(tokenize(fullQuery));
  if (queryTokens.length === 0) return recs.slice(0, limit);

  const queryTokenSet = new Set(queryTokens);
  const activeConcepts = CONCEPTS.filter((concept) =>
    conceptMatchesQuery(concept, fullQuery, queryTokenSet),
  );

  const scored = recs.map((rec, index) => ({
    rec,
    index,
    score: scoreRecommendation(rec, queryTokens, activeConcepts, fullQuery),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.rec.distance !== b.rec.distance) return a.rec.distance - b.rec.distance;
    return a.index - b.index;
  });

  const positive = scored.filter((item) => item.score > 0);
  const ranked = positive.length > 0 ? positive : scored;
  const seenBusinessIds = new Set<string>();
  const deduped: RecommendationListItem[] = [];
  for (const item of ranked) {
    if (seenBusinessIds.has(item.rec.business.id)) continue;
    seenBusinessIds.add(item.rec.business.id);
    deduped.push(item.rec);
    if (deduped.length >= limit) break;
  }
  return deduped;
}
