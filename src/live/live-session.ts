import OpenAI from "openai";
import type { LiveCreateResponse } from "openai/resources/live/live";
import type { ConnectServerEvent } from "openai/resources/live/sideband/sideband";
import { SidebandWS } from "openai/resources/live/sideband/ws";

import {
  APP_TOOL_NAMES,
  DATA_TOOL_NAMES,
  openBusiness,
  presentChoices,
  runTool,
  type JsonRecord,
  type KnownBusiness,
  type PresentChoicesPayload,
  type ToolContext,
} from "./tools.js";
import { buildSessionConfig, type LiveClientContext } from "./session-config.js";

const TRANSCRIPT_FLUSH_MS = 1500;
const MAX_TOOL_OUTPUT_CHARS = 12000;

export class LiveSessionLimitError extends Error {
  constructor(readonly limit: number) {
    super(`Too many concurrent live sessions (limit ${limit}).`);
  }
}

interface PendingFunctionCall {
  callId: string;
  name: string;
  arguments: string;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function readFunctionCall(event: ConnectServerEvent): PendingFunctionCall | null {
  if (event.type !== "response.event") return null;
  const nested = asRecord(event.event);
  if (!nested || nested.type !== "response.output_item.done") return null;
  const item = asRecord(nested.item);
  if (!item || item.type !== "function_call") return null;
  const { call_id: callId, name, arguments: args } = item;
  if (typeof callId !== "string" || typeof name !== "string") return null;
  return { callId, name, arguments: typeof args === "string" ? args : "{}" };
}

function maxSessions(): number {
  const parsed = Number.parseInt(process.env.LIVE_MAX_SESSIONS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

const registry = new Map<string, LiveConciergeSession>();

let client: OpenAI | null = null;

function openaiClient(): OpenAI {
  client ??= new OpenAI({ maxRetries: 0 });
  return client;
}

export class LiveConciergeSession {
  readonly id: string;
  private readonly shortId: string;
  private readonly context: ToolContext;
  private readonly ws: SidebandWS;
  private readonly knownBusinesses = new Map<string, KnownBusiness>();
  private readonly handledCalls = new Set<string>();
  private toolQueue: Promise<void> = Promise.resolve();
  private lastChoices: PresentChoicesPayload | null = null;
  private transcriptSide: "user" | "assistant" | null = null;
  private transcriptBuffer = "";
  private transcriptTimer: NodeJS.Timeout | null = null;
  private closed = false;

  private constructor(id: string, context: ToolContext) {
    this.id = id;
    this.shortId = id.slice(-6);
    this.context = context;
    this.ws = new SidebandWS(openaiClient(), { session_id: id });
    this.ws.on("event", (event) => this.handleEvent(event));
    this.ws.on("error", (error) => {
      console.error(`[live ${this.shortId}] sideband error`, error, error.error ?? "");
    });
    this.ws.on("close", (code, reason) => {
      this.log(`sideband closed (${code} ${reason || "-"})`);
      this.dispose();
    });
  }

  static async create(
    sdp: string,
    clientContext: LiveClientContext,
  ): Promise<{ result: LiveCreateResponse; session: LiveConciergeSession }> {
    const limit = maxSessions();
    if (registry.size >= limit) throw new LiveSessionLimitError(limit);

    const sessionConfig = buildSessionConfig(clientContext);
    const result = await openaiClient().live.create({
      session: sessionConfig,
      transport: { type: "webrtc", sdp },
    });

    const context: ToolContext = clientContext.location
      ? {
          latitude: clientContext.location.latitude,
          longitude: clientContext.location.longitude,
        }
      : {};
    const session = new LiveConciergeSession(result.session.id, context);
    registry.set(session.id, session);
    session.log(
      `created voice=${String(sessionConfig.audio?.output?.voice)} location=${clientContext.location ? "yes" : "no"}`,
    );
    return { result, session };
  }

  get choices(): PresentChoicesPayload | null {
    return this.lastChoices;
  }

  private log(message: string): void {
    console.log(`[live ${this.shortId}] ${message}`);
  }

  private handleEvent(event: ConnectServerEvent): void {
    switch (event.type) {
      case "session.input_transcript.delta":
        this.appendTranscript("user", event.delta);
        return;
      case "session.output_transcript.delta":
        this.appendTranscript("assistant", event.delta);
        return;
      case "session.delegation.created":
        this.log(`delegation ${event.delegation.target} ${event.delegation.id}`);
        return;
      case "session.closed":
        this.flushTranscript();
        this.log(`closed reason=${event.reason} usage=${JSON.stringify(event.usage)}`);
        this.dispose();
        return;
      case "info":
        this.log(`info ${event.code}: ${event.message}`);
        return;
      default:
        break;
    }

    const call = readFunctionCall(event);
    if (!call || this.handledCalls.has(call.callId)) return;
    this.handledCalls.add(call.callId);
    // parallel_tool_calls is off, so one call runs at a time; the chain keeps the
    // result/continue pair for each call from interleaving with the next one.
    this.toolQueue = this.toolQueue.then(() => this.executeCall(call)).catch((error) => {
      console.error(`[live ${this.shortId}] tool chain error`, error);
    });
  }

  private async executeCall(call: PendingFunctionCall): Promise<void> {
    if (this.closed) return;
    this.flushTranscript();
    const started = Date.now();
    let output: string;
    try {
      output = JSON.stringify(await this.toolResult(call));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[live ${this.shortId}] tool ${call.name} failed`, error);
      output = JSON.stringify({ error: message });
    }
    if (output.length > MAX_TOOL_OUTPUT_CHARS) {
      output = JSON.stringify({
        error: "Result too large to send. Ask for fewer items (limit 3).",
      });
    }
    this.log(
      `tool ${call.name} args=${call.arguments} out=${output.length}B ${Date.now() - started}ms`,
    );
    if (this.closed) return;
    this.ws.send({ type: "response.item.create", item: { type: "function_call_output", call_id: call.callId, output } });
    // Appending a result never resumes the delegated response on its own.
    this.ws.send({ type: "response.create" });
  }

  private async toolResult(call: PendingFunctionCall): Promise<unknown> {
    if (DATA_TOOL_NAMES.has(call.name)) {
      const run = await runTool(call.name, call.arguments, this.context);
      for (const business of run.businesses) this.knownBusinesses.set(business.business_id, business);
      return run.payload;
    }
    if (call.name === "present_choices") {
      const payload = presentChoices(call.arguments, this.knownBusinesses);
      if (payload.ok) this.lastChoices = payload;
      return payload;
    }
    if (call.name === "open_business") {
      return openBusiness(call.arguments, this.knownBusinesses);
    }
    return { error: `Unknown tool: ${call.name}` };
  }

  private appendTranscript(side: "user" | "assistant", delta: string): void {
    if (this.transcriptSide && this.transcriptSide !== side) this.flushTranscript();
    this.transcriptSide = side;
    this.transcriptBuffer += delta;
    if (this.transcriptTimer) clearTimeout(this.transcriptTimer);
    this.transcriptTimer = setTimeout(() => this.flushTranscript(), TRANSCRIPT_FLUSH_MS);
    this.transcriptTimer.unref?.();
  }

  private flushTranscript(): void {
    if (this.transcriptTimer) {
      clearTimeout(this.transcriptTimer);
      this.transcriptTimer = null;
    }
    const text = this.transcriptBuffer.trim();
    this.transcriptBuffer = "";
    const side = this.transcriptSide;
    this.transcriptSide = null;
    if (!text || !side) return;
    this.log(`${side}: ${text}`);
  }

  private dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.flushTranscript();
    registry.delete(this.id);
    try {
      this.ws.close();
    } catch {
      // Socket may already be gone; nothing left to clean up.
    }
  }
}

export function getLiveSession(id: string): LiveConciergeSession | undefined {
  return registry.get(id);
}

export function liveSessionCount(): number {
  return registry.size;
}
