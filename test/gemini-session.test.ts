import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { GeminiLiveSession, geminiWebsocketUrl } from "../src/live/gemini-session.js";
import { getLiveSession, unregisterLiveSession } from "../src/live/tool-session.js";

// The ephemeral token is the whole security model: it is what the client gets
// instead of our API key, and what pins the model, the instructions and the tool
// list so a client cannot swap them. These tests stub the Gemini REST call and
// assert on the request we actually send.

const TOKEN_NAME = "auth_tokens/TEST-TOKEN";

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

let captured: CapturedRequest[] = [];
let realFetch: typeof globalThis.fetch;
let createdIds: string[] = [];

const stubTokenApi = () => {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ name: TOKEN_NAME }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
};

const setup = () =>
  captured[0]?.body.bidiGenerateContentSetup as Record<string, unknown> | undefined;

beforeEach(() => {
  captured = [];
  createdIds = [];
  realFetch = globalThis.fetch;
  stubTokenApi();
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.GEMINI_LIVE_MODEL;
  delete process.env.GEMINI_API_VERSION;
  delete process.env.LIVE_MAX_SESSION_SECONDS;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const id of createdIds) unregisterLiveSession(id);
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_LIVE_MODEL;
  delete process.env.GEMINI_API_VERSION;
  delete process.env.LIVE_MAX_SESSION_SECONDS;
});

async function create(context: Parameters<typeof GeminiLiveSession.create>[0] = {}) {
  const created = await GeminiLiveSession.create(context);
  createdIds.push(created.session.id);
  return created;
}

test("the token is minted on the v1alpha auth_tokens endpoint", async () => {
  await create();
  assert.equal(captured.length, 1);
  assert.match(captured[0]!.url, /\/v1alpha\/auth_tokens/);
});

test("the token locks model, modality, voice and tools", async () => {
  const created = await create({ voice: "Puck" });

  assert.equal(created.model, "gemini-3.8-live");
  assert.equal(created.voice, "Puck");
  assert.equal(created.token, TOKEN_NAME);

  const locked = setup();
  assert.ok(locked, "liveConnectConstraints must reach the wire as bidiGenerateContentSetup");
  assert.equal(locked.model, "models/gemini-3.8-live");

  // The SDK folds responseModalities and speechConfig into generationConfig on the
  // wire even though LiveConnectConfig declares them at the top level.
  const generationConfig = locked.generationConfig as {
    responseModalities: string[];
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } };
  };
  assert.deepEqual(generationConfig.responseModalities, ["AUDIO"]);
  assert.equal(generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Puck");

  const tools = locked.tools as Array<{ functionDeclarations: Array<{ name: string }> }>;
  const names = tools[0]!.functionDeclarations.map((declaration) => declaration.name);
  assert.ok(names.includes("top_businesses"));
  assert.ok(names.includes("present_choices"));
  assert.ok(names.includes("get_screen_context"));
});

test("no fieldMask is sent, which is what locks every config field", async () => {
  // lockAdditionalFields is deliberately omitted: with constraints set and no mask,
  // the whole LiveConnectConfig is locked, so a client cannot swap the instructions.
  await create();
  const body = captured[0]!.body as { fieldMask?: unknown; lockAdditionalFields?: unknown };
  assert.equal(body.fieldMask, undefined);
  assert.equal(body.lockAdditionalFields, undefined);
});

test("both transcriptions are on, or the app has nothing to render", async () => {
  await create();
  const locked = setup();
  assert.ok(locked?.inputAudioTranscription, "input transcript must be enabled");
  assert.ok(locked?.outputAudioTranscription, "output transcript must be enabled");
});

test("the system instruction is locked into the token and carries the user context", async () => {
  await create({
    location: { latitude: 49.1951, longitude: 16.6068 },
    locale: "cs-CZ",
    screen: "Detail podniku Eggo Bistro (business_id abc123).",
  });

  const instruction = JSON.stringify(setup()?.systemInstruction ?? "");
  assert.match(instruction, /nikdy z paměti/i, "the hard no-memory rule must survive the merge");
  assert.match(instruction, /present_choices/, "the card rule must survive the merge");
  assert.match(instruction, /top_businesses/, "the leaderboard tool must be explained");
  assert.match(instruction, /slovensky/i, "the language rule must survive the merge");
  assert.match(instruction, /49\.19510, 16\.60680/, "the user location must be baked in");
  assert.match(instruction, /Eggo Bistro/, "the current screen must be baked in");
});

test("an OpenAI voice name falls back to the Gemini default instead of failing the connect", async () => {
  const created = await create({ voice: "marin" });
  assert.equal(created.voice, "Kore");
});

test("session lifetime drives expireTime, and the client gets a 60s window to connect", async () => {
  process.env.LIVE_MAX_SESSION_SECONDS = "600";
  const before = Date.now();
  const created = await create();

  const expiresIn = (Date.parse(created.expiresAt) - before) / 1000;
  assert.ok(expiresIn > 590 && expiresIn <= 601, `expected ~600s, got ${expiresIn}`);

  const windowSeconds = (Date.parse(created.newSessionExpiresAt) - before) / 1000;
  assert.ok(windowSeconds > 50 && windowSeconds <= 61, `expected ~60s, got ${windowSeconds}`);

  const config = captured[0]!.body as { expireTime?: string; newSessionExpireTime?: string };
  assert.equal(config.expireTime, created.expiresAt);
  assert.equal(config.newSessionExpireTime, created.newSessionExpiresAt);
});

test("the session is registered so the relay and choices endpoints can find it", async () => {
  const created = await create({ screen: "Mapa." });
  const found = getLiveSession(created.session.id);
  assert.ok(found);
  assert.equal(found.provider, "gemini");
  assert.equal(found.state.screen, "Mapa.");
});

test("the websocket url uses the constrained method and the access_token parameter", async () => {
  const created = await create();
  assert.equal(created.wsUrl, geminiWebsocketUrl(TOKEN_NAME));
  assert.match(created.wsUrl, /^wss:\/\/generativelanguage\.googleapis\.com\//);
  assert.match(created.wsUrl, /v1alpha\.GenerativeService\.BidiGenerateContentConstrained/);
  assert.match(created.wsUrl, /\?access_token=auth_tokens\/TEST-TOKEN$/);
});

test("GEMINI_LIVE_MODEL overrides the model that gets locked in", async () => {
  process.env.GEMINI_LIVE_MODEL = "gemini-3.8-live-preview";
  const created = await create();
  assert.equal(created.model, "gemini-3.8-live-preview");
  assert.equal(setup()?.model, "models/gemini-3.8-live-preview");
});
