import assert from "node:assert/strict";
import test from "node:test";

import { rankRecommendationsByQuery } from "../src/semantic-search.js";
import type { RecommendationListItem } from "../src/types.js";

// Guards the field rules in semantic-search: concepts must not score against a
// business address or an expert name, and short concept terms must not match
// free prose. Both produced real false positives on production data.
const rec = (o: Partial<{
  id: string;
  name: string;
  type: string;
  address: string;
  expert: string;
  quote: string;
  description: string;
  meals: string[];
  distance: number;
}>): RecommendationListItem => {
  const id = o.id ?? "c";
  return {
    id,
    description: o.description ?? "",
    strongQuote: o.quote ?? null,
    publishDate: null,
    distance: o.distance ?? 1000,
    expert: { id: "e", name: o.expert ?? "Jan Novák" },
    business: {
      id,
      name: o.name ?? "Podnik",
      address: o.address ?? "Ulice 1, Praha",
      primaryBusinessType: { id: "t", name: o.type ?? "Restaurace" },
      openingHours: "",
    },
    meals: (o.meals ?? []).map((m) => ({ id: m, name: m })),
    mentions: [],
  };
};

// An anchor that always scores keeps the ranker out of its "nothing matched,
// return everything by distance" fallback, which would make every assertion pass.
const ranksAbove = (query: string, anchor: RecommendationListItem, candidate: RecommendationListItem) => {
  const out = rankRecommendationsByQuery([anchor, candidate], query, 5);
  assert.ok(
    out.some((r) => r.business.id === anchor.business.id),
    "anchor must score, otherwise the test measures the fallback",
  );
  return out.some((r) => r.business.id === candidate.business.id);
};

const wineAnchor = rec({ id: "anchor", name: "Anchor", type: "Vinárna", quote: "Skvělé víno", distance: 10 });
const phoAnchor = rec({ id: "anchor", name: "Anchor", meals: ["Phở"], quote: "Vietnamská klasika", distance: 10 });

test("address never triggers a concept: a bakery on Vinohradská is not a wine bar", () => {
  const bakery = rec({ name: "Klásek", type: "Pekárna", address: "Vinohradská 62, Praha", quote: "Čerstvé pečivo" });
  assert.equal(ranksAbove("vinárna", wineAnchor, bakery), false);
});

test("expert name never triggers a concept", () => {
  const venue = rec({ name: "Podnik", expert: "Jan Vinohradský", quote: "Dobré jídlo" });
  assert.equal(ranksAbove("vinárna", wineAnchor, venue), false);
});

test("short concept terms do not match prose: 'o něm' is not a spring roll", () => {
  const french = rec({
    name: "Le Terroir",
    description: "Skvěle zvládnutá Francie. Vůbec se o něm nemluví a nikdo ho nikam nezařazuje.",
  });
  assert.equal(ranksAbove("vietnamská pho", phoAnchor, french), false);
});

test("dish names still match: Phở in meals answers a pho query", () => {
  const viet = rec({ name: "Tràng An", meals: ["Phở"] });
  assert.equal(ranksAbove("pho", phoAnchor, viet), true);
});

test("business type still matches: Vinárna answers a vinárna query", () => {
  const wine = rec({ name: "U Sudu", type: "Vinárna" });
  assert.equal(ranksAbove("vinárna", wineAnchor, wine), true);
});

test("longer concept terms still match Czech inflections in prose", () => {
  const bistro = rec({ name: "Bistro X", description: "Teď se snaží rozjíždět i obědy." });
  const lunchAnchor = rec({ id: "anchor", name: "Anchor", type: "Bistro", quote: "Denní menu a obědy", distance: 10 });
  assert.equal(ranksAbove("obed", lunchAnchor, bistro), true);
});
