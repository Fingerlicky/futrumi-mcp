import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import { geocode } from "../src/geocode.js";

// Nominatim bans clients that ignore its policy (1 req/s, cache results), and a
// ban would take down every location search this server does. The guards live in
// geocode.ts; these tests keep them there.

let calls: { url: string; at: number }[] = [];
let realFetch: typeof globalThis.fetch;

before(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push({ url: String(url), at: Date.now() });
    return new Response(
      JSON.stringify([{ lat: "50.1041", lon: "14.4381", addresstype: "suburb", type: "suburb" }]),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof globalThis.fetch;
});

after(() => {
  globalThis.fetch = realFetch;
});

test("a repeated place is served from cache instead of hitting Nominatim", async () => {
  calls = [];
  const first = await geocode("Testov nad Cache");
  const second = await geocode("Testov nad Cache");
  assert.equal(calls.length, 1, "second lookup must not reach the network");
  assert.deepEqual(first?.location, second?.location);
});

test("the cache key ignores case and surrounding whitespace", async () => {
  calls = [];
  await geocode("Testov Normalizacni");
  await geocode("   testov normalizacni  ");
  assert.equal(calls.length, 1);
});

test("concurrent lookups of the same place share a single request", async () => {
  calls = [];
  const results = await Promise.all(
    Array.from({ length: 5 }, () => geocode("Testov Soubezny")),
  );
  assert.equal(calls.length, 1, "single-flight must collapse the burst");
  assert.equal(new Set(results.map((r) => JSON.stringify(r?.location))).size, 1);
});

test("distinct new places are spaced at least a second apart", async () => {
  calls = [];
  await Promise.all([geocode("Testov Prvni"), geocode("Testov Druhy")]);
  assert.equal(calls.length, 2);
  const gap = calls[1]!.at - calls[0]!.at;
  assert.ok(gap >= 1000, `expected >=1000 ms between calls, got ${gap} ms`);
});
