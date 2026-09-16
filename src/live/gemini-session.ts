import { randomUUID } from "node:crypto";

import { GoogleGenAI, Modality, type LiveConnectConfig } from "@google/genai";

import { toGeminiFunctionDeclarations } from "./gemini-tools.js";
import {
  LiveSessionLimitError,
  liveSessionCount,
  maxSessions,
  maxSessionSeconds,
  registerLiveSession,
  ToolSessionState,
  unregisterLiveSession,
  type LiveProvider,
  type LiveSessionRecord,
} from "./tool-session.js";
import {
  buildGeminiSystemInstruction,
  resolveGeminiVoice,
  type LiveClientContext,
} from "./session-config.js";
import type { ToolContext } from "./tools.js";

export const DEFAULT_GEMINI_LIVE_MODEL = "gemini-3.8-live";

/**
 * Ephemeral tokens are a v1alpha feature: `authTokens.create` is only served
 * there, and `live.connect` warns and still points at the given version, so both
 * the REST call and the client's websocket URL must use the same one.
 */
const DEFAULT_GEMINI_API_VERSION = "v1alpha";
const WEBSOCKET_BASE_URL = "wss://generativelanguage.googleapis.com";

/** How long the client has to open the socket after the POST returns. */
const NEW_SESSION_WINDOW_SECONDS = 60;

/**
 * The token expiring is what ends the call, but the server record has to outlive
 * it: a tool call already in flight, or the client fetching the final cards,
 * would otherwise hit a 404.
 */
const REGISTRY_GRACE_SECONDS = 120;

export class GeminiNotConfiguredError extends Error {
  constructor() {
    super("GEMINI_API_KEY is not set on the server.");
  }
}

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export function geminiModel(): string {
  return process.env.GEMINI_LIVE_MODEL?.trim() || DEFAULT_GEMINI_LIVE_MODEL;
}

function geminiApiVersion(): string {
  return process.env.GEMINI_API_VERSION?.trim() || DEFAULT_GEMINI_API_VERSION;
}

let client: GoogleGenAI | null = null;
let clientKey: string | null = null;

function geminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new GeminiNotConfiguredError();
  // Rebuild when the key changes so a restart-free env update is picked up.
  if (!client || clientKey !== apiKey) {
    client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: geminiApiVersion() } });
    clientKey = apiKey;
  }
  return client;
}

/**
 * The websocket URL the SDK builds for an ephemeral token: the constrained
 * method, and the token in `access_token` rather than `key`. Mirrored here so a
 * client that does not use the SDK (iOS) connects the same way.
 */
export function geminiWebsocketUrl(token: string): string {
  return `${WEBSOCKET_BASE_URL}/ws/google.ai.generativelanguage.${geminiApiVersion()}.GenerativeService.BidiGenerateContentConstrained?access_token=${token}`;
}

export interface GeminiSessionCreation {
  session: GeminiLiveSession;
  token: string;
  model: string;
  wsUrl: string;
  voice: string;
  expiresAt: string;
  newSessionExpiresAt: string;
}

export class GeminiLiveSession implements LiveSessionRecord {
  readonly id: string;
  readonly provider: LiveProvider = "gemini";
  readonly state: ToolSessionState;
  private readonly shortId: string;
  private expiryTimer: NodeJS.Timeout | null = null;

  private constructor(id: string, context: ToolContext, screen: string | null) {
    this.id = id;
    this.shortId = id.slice(-6);
    this.state = new ToolSessionState(context, screen);
  }

  static async create(clientContext: LiveClientContext): Promise<GeminiSessionCreation> {
    if (!geminiConfigured()) throw new GeminiNotConfiguredError();

    const limit = maxSessions();
    if (liveSessionCount() >= limit) throw new LiveSessionLimitError(limit);

    const model = geminiModel();
    const voice = resolveGeminiVoice(clientContext.voice);
    const seconds = maxSessionSeconds();
    const now = Date.now();
    const expiresAt = new Date(now + seconds * 1000).toISOString();
    const newSessionExpiresAt = new Date(now + NEW_SESSION_WINDOW_SECONDS * 1000).toISOString();

    const config: LiveConnectConfig = {
      responseModalities: [Modality.AUDIO],
      systemInstruction: buildGeminiSystemInstruction(clientContext),
      tools: [{ functionDeclarations: toGeminiFunctionDeclarations() }],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      // Transcripts are what the app renders as the conversation; without these
      // the client only gets audio.
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    };

    // No `lockAdditionalFields`: with the constraints set and that field omitted,
    // every LiveConnectConfig field is locked, so a client cannot swap the system
    // instruction or the tools — it never even sees them.
    const token = await geminiClient().authTokens.create({
      config: {
        uses: 1,
        expireTime: expiresAt,
        newSessionExpireTime: newSessionExpiresAt,
        liveConnectConstraints: { model, config },
      },
    });

    const name = token.name?.trim();
    if (!name) throw new Error("Gemini returned an auth token without a name.");

    const context: ToolContext = clientContext.location
      ? {
          latitude: clientContext.location.latitude,
          longitude: clientContext.location.longitude,
        }
      : {};
    const session = new GeminiLiveSession(
      randomUUID(),
      context,
      clientContext.screen?.trim() || null,
    );
    registerLiveSession(session);
    session.startExpiryTimer(seconds + REGISTRY_GRACE_SECONDS);
    session.log(
      `created model=${model} voice=${voice} client=${clientContext.client ?? "-"} location=${clientContext.location ? "yes" : "no"} screen=${session.state.screen ? "yes" : "no"}`,
    );

    return {
      session,
      token: name,
      model,
      wsUrl: geminiWebsocketUrl(name),
      voice,
      expiresAt,
      newSessionExpiresAt,
    };
  }

  /** Gemini owns the conversation, so a screen update only updates what the tool reads. */
  async setScreen(screen: string): Promise<void> {
    this.state.setScreen(screen);
    this.log(`screen: ${screen}`);
  }

  dispose(): void {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
    unregisterLiveSession(this.id);
  }

  private startExpiryTimer(seconds: number): void {
    this.expiryTimer = setTimeout(() => {
      this.log(`evicted after ${seconds}s`);
      this.dispose();
    }, seconds * 1000);
    this.expiryTimer.unref?.();
  }

  private log(message: string): void {
    console.log(`[live gemini ${this.shortId}] ${message}`);
  }
}
