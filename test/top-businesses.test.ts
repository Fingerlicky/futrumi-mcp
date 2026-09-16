import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { topBusinesses } from "../src/services/top-businesses.js";

// The backend orders recommendedBusinesses by distance, so the most-recommended
// place in a region is almost never on the first page. These tests stub the
// network to pin the paging + ranking contract without touching production.

interface StubCall {
  pageNumber: number;
  pageSize: number;
}

interface StubBusiness {
  id: string;
  name: string;
  type: string;
  experts: number;
  distance: number;
}

let calls: StubCall[] = [];
let realFetch: typeof globalThis.fetch;

const edge = (business: StubBusiness) => ({
  id: business.id,
  name: business.name,
  address: "Ulice 1, Brno",
  bio: null,
  distance: business.distance,
  location: { latitude: 49.19, longitude: 16.6 },
  primaryBusinessType: { id: "t", name: business.type },
  openingHours: "",
  expertsWithRecommendationCount: business.experts,
  photoUrl: null,
});

const stubBackend = (all: StubBusiness[]) => {
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const { pageNumber, pageSize } = body.variables.pagination;
    calls.push({ pageNumber, pageSize });
    const start = pageNumber * pageSize;
    const edges = all.slice(start, start + pageSize).map(edge);
    return new Response(
      JSON.stringify({ data: { recommendedBusinesses: { total: all.length, edges } } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof globalThis.fetch;
};

/** Distance-ordered filler, so the interesting row can be placed deliberately. */
const filler = (count: number, experts = 1): StubBusiness[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `biz-${i}`,
    name: `Podnik ${i}`,
    type: i % 2 === 0 ? "Restaurace" : "Kavárna",
    experts,
    distance: i * 10,
  }));

beforeEach(() => {
  calls = [];
  realFetch = globalThis.fetch;
  delete process.env.TOP_BUSINESSES_CEILING;
  delete process.env.TOP_BUSINESSES_PAGE_SIZE;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.TOP_BUSINESSES_CEILING;
  delete process.env.TOP_BUSINESSES_PAGE_SIZE;
});

test("the most recommended place wins even when it is the farthest away", async () => {
  const all = [
    ...filler(450),
    { id: "winner", name: "Pavillon", type: "Restaurace", experts: 12, distance: 9000 },
  ];
  stubBackend(all);

  const result = await topBusinesses({ latitude: 49.19, longitude: 16.6, radiusMeters: 15000 });

  assert.equal(result.businesses[0]?.name, "Pavillon");
  assert.equal(result.businesses[0]?.expertsWithRecommendationCount, 12);
  assert.ok(calls.length > 1, `expected several pages, got ${calls.length}`);
});

test("results are ordered by expert count descending, ties by distance", async () => {
  stubBackend([
    { id: "a", name: "A", type: "Restaurace", experts: 3, distance: 500 },
    { id: "b", name: "B", type: "Restaurace", experts: 9, distance: 4000 },
    { id: "c", name: "C", type: "Restaurace", experts: 9, distance: 100 },
    { id: "d", name: "D", type: "Restaurace", experts: 1, distance: 50 },
  ]);

  const result = await topBusinesses({ latitude: 49.19, longitude: 16.6 });

  assert.deepEqual(
    result.businesses.map((business) => business.name),
    ["C", "B", "A", "D"],
    "equal counts must put the nearer place first",
  );
});

test("businessType filters on the primary type, ignoring case and diacritics", async () => {
  stubBackend([
    { id: "a", name: "Kavárna A", type: "Kavárna", experts: 2, distance: 100 },
    { id: "b", name: "Restaurace B", type: "Restaurace", experts: 9, distance: 200 },
    { id: "c", name: "Kavárna C", type: "Kavárna", experts: 5, distance: 300 },
  ]);

  const result = await topBusinesses({
    latitude: 49.19,
    longitude: 16.6,
    businessType: "kavarna",
  });

  assert.deepEqual(
    result.businesses.map((business) => business.name),
    ["Kavárna C", "Kavárna A"],
  );
  assert.equal(result.matchedCount, 2, "the header must count what survived the filter");
});

test("limit caps the leaderboard", async () => {
  stubBackend(filler(40).map((business, i) => ({ ...business, experts: 40 - i })));

  const result = await topBusinesses({ latitude: 49.19, longitude: 16.6, limit: 3 });

  assert.equal(result.businesses.length, 3);
  assert.deepEqual(
    result.businesses.map((business) => business.expertsWithRecommendationCount),
    [40, 39, 38],
  );
});

test("a business repeated across page boundaries is only ranked once", async () => {
  const duplicate = { id: "dup", name: "Dup", type: "Restaurace", experts: 7, distance: 10 };
  stubBackend([duplicate, ...filler(10), duplicate]);

  const result = await topBusinesses({ latitude: 49.19, longitude: 16.6 });

  assert.equal(
    result.businesses.filter((business) => business.id === "dup").length,
    1,
    "the same place must not appear twice in a top-10",
  );
});

test("the ceiling bounds how much of a wide radius is scanned", async () => {
  process.env.TOP_BUSINESSES_CEILING = "100";
  process.env.TOP_BUSINESSES_PAGE_SIZE = "50";
  stubBackend(filler(600));

  const result = await topBusinesses({ latitude: 49.19, longitude: 16.6, radiusMeters: 50000 });

  assert.equal(result.candidateCount, 100);
  assert.equal(result.total, 600, "the backend total is still reported honestly");
  assert.ok(calls.every((call) => call.pageSize === 50));
});

test("an empty area returns nothing instead of throwing", async () => {
  stubBackend([]);

  const result = await topBusinesses({ latitude: 49.19, longitude: 16.6 });

  assert.deepEqual(result.businesses, []);
  assert.equal(result.matchedCount, 0);
});
