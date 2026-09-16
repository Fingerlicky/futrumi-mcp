import { Hono, type MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import OpenAI from "openai";
import { z } from "zod";

import { DEMO_PAGE } from "./demo-page.js";
import {
  GeminiLiveSession,
  GeminiNotConfiguredError,
  geminiConfigured,
  geminiModel,
} from "./gemini-session.js";
import { LiveConciergeSession } from "./live-session.js";
import { BUILT_IN_VOICES, DEFAULT_GEMINI_VOICE, GEMINI_VOICES } from "./session-config.js";
import {
  capToolPayload,
  getLiveSession,
  LiveSessionLimitError,
  liveSessionCount,
} from "./tool-session.js";
import { LIVE_TOOL_NAMES } from "./tools.js";

const SCREEN_MAX_CHARS = 600;

const sessionRequestSchema = z
  .object({
    provider: z.enum(["openai", "gemini"]).default("openai"),
    sdp: z.string().min(1).optional(),
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
  })
  // Gemini has no WebRTC path: the client opens the websocket itself with the
  // ephemeral token, so there is no offer to exchange.
  .refine((body) => body.provider !== "openai" || Boolean(body.sdp), {
    message: 'sdp is required when provider is "openai".',
    path: ["sdp"],
  });

const contextRequestSchema = z.object({
  screen: z.string().min(1).max(SCREEN_MAX_CHARS),
});

const toolRequestSchema = z.object({
  name: z.string().min(1).max(64),
  args: z.union([z.record(z.string(), z.unknown()), z.string()]).optional(),
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

liveRoutes.get("/live/voices", (c) => {
  const provider = c.req.query("provider");
  const gemini = {
    available: geminiConfigured(),
    model: geminiModel(),
    voices: GEMINI_VOICES,
    default: DEFAULT_GEMINI_VOICE,
  };
  const openai = {
    available: Boolean(process.env.OPENAI_API_KEY?.trim()),
    voices: BUILT_IN_VOICES,
  };
  if (provider === "gemini") return c.json({ ...gemini, sessions: liveSessionCount() });
  return c.json({
    voices: BUILT_IN_VOICES,
    sessions: liveSessionCount(),
    providers: { openai, gemini },
  });
});

liveRoutes.post("/live/session", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = sessionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request body.", detail: z.prettifyError(parsed.error) }, 400);
  }

  const clientContext = {
    voice: parsed.data.voice,
    location: parsed.data.location,
    locale: parsed.data.locale,
    client: parsed.data.client,
    screen: parsed.data.screen,
  };

  if (parsed.data.provider === "gemini") {
    if (!geminiConfigured()) {
      return c.json(
        {
          error: "GEMINI_API_KEY is not set on the server.",
          detail: "Set GEMINI_API_KEY to enable the gemini provider.",
        },
        503,
      );
    }
    try {
      const created = await GeminiLiveSession.create(clientContext);
      return c.json(
        {
          session: { id: created.session.id, provider: "gemini" as const },
          gemini: {
            token: created.token,
            model: created.model,
            wsUrl: created.wsUrl,
            voice: created.voice,
            expiresAt: created.expiresAt,
            newSessionExpiresAt: created.newSessionExpiresAt,
          },
        },
        201,
      );
    } catch (error) {
      if (error instanceof GeminiNotConfiguredError) {
        return c.json({ error: error.message }, 503);
      }
      if (error instanceof LiveSessionLimitError) {
        console.warn(`[live] rejected: ${error.message}`);
        return c.json({ error: "Too many concurrent sessions.", detail: error.message }, 429);
      }
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[live] gemini session create failed", error);
      return c.json({ error: "Live session creation failed.", detail }, 502);
    }
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    return c.json({ error: "OPENAI_API_KEY is not set on the server." }, 503);
  }

  try {
    const { result } = await LiveConciergeSession.create(parsed.data.sdp as string, clientContext);
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

/**
 * Tool relay. Gemini talks to the client, not to us, so the client forwards each
 * toolCall here; the server keeps owning the data, the instructions and the ids
 * the model is allowed to name. OpenAI sessions can use it too — their tool calls
 * normally arrive on the sideband instead.
 */
liveRoutes.post("/live/session/:id/tool", async (c) => {
  const session = getLiveSession(c.req.param("id"));
  if (!session) return c.json({ error: "Unknown session." }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = toolRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request body.", detail: z.prettifyError(parsed.error) }, 400);
  }

  const { name, args } = parsed.data;
  if (!LIVE_TOOL_NAMES.has(name)) {
    return c.json({ error: `Unknown tool: ${name}` }, 400);
  }

  const started = Date.now();
  try {
    const result = await session.state.execute(name, args ?? {});
    const capped = capToolPayload(result);
    console.log(
      `[live ${session.provider} ${session.id.slice(-6)}] tool ${name} out=${capped.json.length}B ${Date.now() - started}ms`,
    );
    return c.json({ result: capped.value }, 200);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[live ${session.provider}] tool ${name} failed`, error);
    // The model still needs an answer it can speak around, so the failure is the
    // tool result rather than an HTTP error the client would have to invent one for.
    return c.json({ result: { error: detail } }, 200);
  }
});

liveRoutes.get("/live/session/:id/choices", (c) => {
  const session = getLiveSession(c.req.param("id"));
  if (!session) return c.json({ error: "Unknown session." }, 404);
  const choices = session.state.choices;
  if (!choices) return c.json({ error: "No choices presented yet." }, 404);
  return c.json(choices, 200);
});
