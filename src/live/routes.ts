import { Hono } from "hono";
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
});

const liveEnabled = (): boolean => process.env.LIVE_ENABLED !== "false";

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

liveRoutes.get("/live/session/:id/choices", (c) => {
  const session = getLiveSession(c.req.param("id"));
  if (!session) return c.json({ error: "Unknown session." }, 404);
  const choices = session.choices;
  if (!choices) return c.json({ ok: false, pending: true }, 200);
  return c.json(choices, 200);
});
