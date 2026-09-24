import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { liveRoutes } from "../src/live/routes.js";
import {
  capToolPayload,
  MAX_TOOL_OUTPUT_CHARS,
  registerLiveSession,
  ToolSessionState,
  unregisterLiveSession,
  type LiveSessionRecord,
} from "../src/live/tool-session.js";

// Gemini clients relay every tool call here, so this endpoint is the only thing
// standing between the model and the app state. It must never reach the network
// for session-local tools, never accept a tool that is not declared, and never
// let the model name a business it has not actually seen.

const SESSION_ID = "test-session";

let session: LiveSessionRecord;
let realFetch: typeof globalThis.fetch;

const forbidNetwork = () => {
  globalThis.fetch = (async () => {
    throw new Error("the relay must not hit the network in these tests");
  }) as typeof globalThis.fetch;
};

function makeSession(screen: string | null): LiveSessionRecord {
  const state = new ToolSessionState({}, screen);
  return {
    id: SESSION_ID,
    provider: "gemini",
    state,
    async setScreen(next: string) {
      state.setScreen(next);
    },
  };
}

const callTool = (name: string, args: unknown = {}, id = SESSION_ID) =>
  liveRoutes.request(`/live/session/${id}/tool`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, args }),
  });

beforeEach(() => {
  realFetch = globalThis.fetch;
  forbidNetwork();
  delete process.env.LIVE_ACCESS_CODES;
  session = makeSession("Detail podniku Eggo Bistro (business_id abc123).");
  registerLiveSession(session);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  unregisterLiveSession(SESSION_ID);
  delete process.env.LIVE_ACCESS_CODES;
});

test("an unknown session is a 404, not a crash", async () => {
  const response = await callTool("get_screen_context", {}, "nope");
  assert.equal(response.status, 404);
});

test("a tool that is not declared is rejected", async () => {
  const response = await callTool("drop_database");
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: string };
  assert.match(body.error, /Unknown tool/);
});

test("get_screen_context answers from session state", async () => {
  const response = await callTool("get_screen_context");
  assert.equal(response.status, 200);
  const body = (await response.json()) as { result: { ok: boolean; screen: string } };
  assert.equal(body.result.ok, true);
  assert.match(body.result.screen, /Eggo Bistro/);
});

test("the context endpoint updates what get_screen_context returns", async () => {
  const update = await liveRoutes.request(`/live/session/${SESSION_ID}/context`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ screen: "Seznam expertů." }),
  });
  assert.equal(update.status, 204);

  const response = await callTool("get_screen_context");
  const body = (await response.json()) as { result: { screen: string } };
  assert.equal(body.result.screen, "Seznam expertů.");
});

test("present_choices refuses an id the model never saw", async () => {
  const response = await callTool("present_choices", {
    primary: { business_id: "hallucinated", reason: "protože" },
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { result: { ok: boolean; unknown_ids: string[] } };
  assert.equal(body.result.ok, false);
  assert.deepEqual(body.result.unknown_ids, ["hallucinated"]);
});

test("present_choices accepts a known business and fills the choices endpoint", async () => {
  session.state.knownBusinesses.set("abc123", {
    business_id: "abc123",
    name: "Eggo Bistro",
    expert: "Marko Jelič",
    quote: "Nejlepší snídaně v Brně.",
    deeplink: "https://futrumi.cz/business/abc123",
    latitude: 49.2038,
    longitude: 16.6089,
  });

  const response = await callTool("present_choices", {
    primary: { business_id: "abc123", reason: "Snídaně do 11:00." },
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { result: { ok: boolean } };
  assert.equal(body.result.ok, true);

  const choices = await liveRoutes.request(`/live/session/${SESSION_ID}/choices`);
  assert.equal(choices.status, 200);
  const snapshot = (await choices.json()) as {
    primary: { business_id: string; reason: string };
    backups: unknown[];
  };
  assert.equal(snapshot.primary.business_id, "abc123");
  assert.equal(snapshot.primary.reason, "Snídaně do 11:00.");
  assert.deepEqual(snapshot.backups, []);
});

test("Gemini sends args as an object, not a JSON string", async () => {
  // OpenAI hands over `arguments` as a string; if the dispatcher only parsed
  // strings, every Gemini tool call would silently run with empty arguments.
  const response = await callTool("open_business", { business_id: "abc123" });
  const body = (await response.json()) as { result: { ok: boolean; unknown_ids?: string[] } };
  assert.equal(body.result.ok, false);
  assert.deepEqual(body.result.unknown_ids, ["abc123"], "the id must have been read from the object");
});

test("a bad body is a 400", async () => {
  const response = await liveRoutes.request(`/live/session/${SESSION_ID}/tool`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args: {} }),
  });
  assert.equal(response.status, 400);
});

test("the access code gate also covers the relay", async () => {
  process.env.LIVE_ACCESS_CODES = "secret";
  const response = await callTool("get_screen_context");
  assert.equal(response.status, 401);
});

test("an oversized tool result is replaced, not sent", () => {
  const small = capToolPayload({ ok: true });
  assert.deepEqual(small.value, { ok: true });

  const huge = capToolPayload({ blob: "x".repeat(MAX_TOOL_OUTPUT_CHARS + 100) });
  assert.ok(huge.json.length < MAX_TOOL_OUTPUT_CHARS);
  assert.match((huge.value as { error: string }).error, /too large/i);
});

// find_food_along_route is computed by the app. Its stops must become names the
// model may present or open, and an answer must reach the waiting call whether
// it lands before or after the sideband asks for it.

const routeResult = {
  destination: "Vimperk",
  stops: [
    { business_id: "triko", name: "Triko Tábor", detour_minutes: 6, latitude: 49.41, longitude: 14.66 },
    { name: "missing id" },
  ],
};

test("a client tool relayed with its result registers the stops", async () => {
  const response = await liveRoutes.request(`/live/session/${SESSION_ID}/tool`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "find_food_along_route", args: { destination: "Vimperk" }, result: routeResult }),
  });
  const body = (await response.json()) as { result: typeof routeResult };
  assert.equal(body.result.destination, "Vimperk");
  assert.deepEqual([...session.state.knownBusinesses.keys()], ["triko"]);

  const open = await callTool("open_business", { business_id: "triko" });
  const opened = (await open.json()) as { result: { ok: boolean } };
  assert.equal(opened.result.ok, true);
});

test("a client result posted before the call is picked up", async () => {
  const posted = await liveRoutes.request(`/live/session/${SESSION_ID}/client-result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ call_id: "call_early", result: routeResult }),
  });
  assert.equal(posted.status, 204);

  const result = await session.state.execute("find_food_along_route", "{}", { callId: "call_early" });
  assert.deepEqual(result, routeResult);
});

test("a waiting call resolves when the client result arrives", async () => {
  const pending = session.state.execute("find_food_along_route", "{}", { callId: "call_late" });
  session.state.deliverClientResult("call_late", routeResult);
  assert.deepEqual(await pending, routeResult);
  assert.ok(session.state.knownBusinesses.has("triko"));
});

test("a client result needs a call id", async () => {
  const response = await liveRoutes.request(`/live/session/${SESSION_ID}/client-result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ result: routeResult }),
  });
  assert.equal(response.status, 400);
});
