import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { searchRecommendations } from "../src/services/search-recommendations.js";

// The backend orders recommendations by distance, so ranking only the first page
// silently degrades wide searches. A refactor re-introduced exactly that in
// September 2026 and nothing caught it; these tests stub the network so the
// paging contract is checked without touching production.

interface StubCall {
  pageNumber: number;
  pageSize: number;
}

let calls: StubCall[] = [];
let realFetch: typeof globalThis.fetch;

const stubBackend = (total: number) => {
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const { pageNumber, pageSize } = body.variables.pagination;
    calls.push({ pageNumber, pageSize });
    const start = pageNumber * pageSize;
    const count = Math.max(0, Math.min(pageSize, total - start));
    const edges = Array.from({ length: count }, (_, i) => ({
      id: `rec-${start + i}`,
      description: start + i === total - 1 ? "vietnamská pho klasika" : "něco k jídlu",
      strongQuote: null,
      publishDate: null,
      distance: (start + i) * 10,
      expert: { id: "e", name: "Expert" },
      business: {
        id: `biz-${start + i}`,
        name: start + i === total - 1 ? "PHO 100" : `Podnik ${start + i}`,
        address: "Ulice 1, Praha",
        primaryBusinessType: { id: "t", name: "Restaurace" },
        openingHours: "",
      },
      meals: [],
      mentions: [],
    }));
    return new Response(JSON.stringify({ data: { recommendations: { total, edges } } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
};

beforeEach(() => {
  calls = [];
  realFetch = globalThis.fetch;
  delete process.env.SEMANTIC_CANDIDATE_LIMIT;
  delete process.env.SEMANTIC_CANDIDATE_CEILING;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.SEMANTIC_CANDIDATE_LIMIT;
  delete process.env.SEMANTIC_CANDIDATE_CEILING;
});

test("a semantic query pages through the whole radius, not just the first page", async () => {
  stubBackend(566);
  const result = await searchRecommendations({
    query: "pho",
    latitude: 50.08,
    longitude: 14.44,
    radiusMeters: 15000,
    limit: 10,
  });
  assert.equal(result.candidateCount, 566, "every candidate in the radius must be ranked");
  assert.ok(calls.length > 1, `expected several pages, got ${calls.length}`);
  assert.deepEqual(
    calls.map((c) => c.pageNumber).sort((a, b) => a - b),
    [0, 1, 2],
  );
});

test("the best match wins even when it sits far beyond the first page", async () => {
  stubBackend(566);
  const result = await searchRecommendations({
    query: "pho",
    latitude: 50.08,
    longitude: 14.44,
    radiusMeters: 15000,
    limit: 5,
  });
  assert.equal(
    result.recommendations[0]?.business.name,
    "PHO 100",
    "the only real pho match is the last candidate by distance",
  );
});

test("the legacy SEMANTIC_CANDIDATE_LIMIT sets page size, it must not cap the pool", async () => {
  process.env.SEMANTIC_CANDIDATE_LIMIT = "120";
  stubBackend(566);
  const result = await searchRecommendations({
    query: "pho",
    latitude: 50.08,
    longitude: 14.44,
    radiusMeters: 15000,
    limit: 10,
  });
  assert.equal(result.candidateCount, 566, "a deployment's old value must not shrink the pool");
  assert.ok(
    calls.every((c) => c.pageSize === 120),
    "it should still control how big one fetch is",
  );
});

test("the ceiling is respected and has its own variable", async () => {
  process.env.SEMANTIC_CANDIDATE_CEILING = "200";
  stubBackend(566);
  const result = await searchRecommendations({
    query: "pho",
    latitude: 50.08,
    longitude: 14.44,
    radiusMeters: 15000,
    limit: 10,
  });
  assert.equal(result.candidateCount, 200);
});

test("a query-less lookup fetches only what it returns", async () => {
  stubBackend(566);
  const result = await searchRecommendations({
    latitude: 50.08,
    longitude: 14.44,
    radiusMeters: 15000,
    limit: 8,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.pageSize, 8);
  assert.equal(result.recommendations.length, 8);
});
