import { Hono, type MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import OpenAI from "openai";
import { z } from "zod";

import { DEMO_PAGE } from "./demo-page.js";
import {
  getLiveSession,
  LiveConciergeSession,
  LiveSessionLimitError,
  liveSessionCount,
} from "./live-session.js";
import { BUILT_IN_VOICES } from "./session-config.js";

const SCREEN_MAX_CHARS = 600;

const sessionRequestSchema = z.object({
  sdp: z.string().min(1),
  voice: z.string().optional(),
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracy: z.number().nonnegative().optional(),
    })
    .optional(),
  locale: z.string().max(35).optional(),
  client: z.enum(["ios", "web"]).optional(),
  screen: z.string().max(SCREEN_MAX_CHARS).optional(),
});

const contextRequestSchema = z.object({
  screen: z.string().min(1).max(SCREEN_MAX_CHARS),
});

const liveEnabled = (): boolean => process.env.LIVE_ENABLED !== "false";

function accessCodes(): string[] {
  return (process.env.LIVE_ACCESS_CODES ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
}

/** Empty LIVE_ACCESS_CODES means local development: no gate. */
const requireAccessCode: MiddlewareHandler = async (c, next) => {
  const codes = accessCodes();
  if (codes.length > 0) {
    const provided = c.req.header("x-live-access-code")?.trim();
    if (!provided || !codes.includes(provided)) {
      return c.json({ error: "invalid_access_code" }, 401);
    }
  }
  await next();
};

function upstreamStatus(status: number | undefined): ContentfulStatusCode {
  if (typeof status === "number" && status >= 400 && status <= 599) {
    return status as ContentfulStatusCode;
  }
  return 502;
}

export const liveRoutes = new Hono();

liveRoutes.use("/live/*", async (c, next) => {
  if (!liveEnabled()) return c.notFound();
  await next();
});

liveRoutes.use("/live/session", requireAccessCode);
liveRoutes.use("/live/session/*", requireAccessCode);

liveRoutes.get("/live/demo", (c) => c.html(DEMO_PAGE));

liveRoutes.get("/live/voices", (c) =>
  c.json({ voices: BUILT_IN_VOICES, sessions: liveSessionCount() }),
);

liveRoutes.post("/live/session", async (c) => {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return c.json({ error: "OPENAI_API_KEY is not set on the server." }, 503);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = sessionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request body.", detail: z.prettifyError(parsed.error) }, 400);
  }

  try {
    const { result } = await LiveConciergeSession.create(parsed.data.sdp, {
      voice: parsed.data.voice,
      location: parsed.data.location,
      locale: parsed.data.locale,
      client: parsed.data.client,
      screen: parsed.data.screen,
    });
    return c.json(result, 201);
  } catch (error) {
    if (error instanceof LiveSessionLimitError) {
      console.warn(`[live] rejected: ${error.message}`);
      return c.json({ error: "Too many concurrent sessions.", detail: error.message }, 429);
    }
    if (error instanceof OpenAI.APIError) {
      console.error(`[live] session create failed ${error.status ?? "?"}: ${error.message}`);
      return c.json(
        { error: "Live session creation failed.", detail: error.message },
        upstreamStatus(error.status),
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[live] session create failed", error);
    return c.json({ error: "Live session creation failed.", detail }, 502);
  }
});

liveRoutes.post("/live/session/:id/context", async (c) => {
  const session = getLiveSession(c.req.param("id"));
  if (!session) return c.json({ error: "Unknown session." }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = contextRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request body.", detail: z.prettifyError(parsed.error) }, 400);
  }

  await session.setScreen(parsed.data.screen);
  return c.body(null, 204);
});

liveRoutes.get("/live/session/:id/choices", (c) => {
  const session = getLiveSession(c.req.param("id"));
  if (!session) return c.json({ error: "Unknown session." }, 404);
  const choices = session.choices;
  if (!choices) return c.json({ error: "No choices presented yet." }, 404);
  return c.json(choices, 200);
});
