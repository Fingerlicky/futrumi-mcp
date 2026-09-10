import OpenAI from "openai";
import type { LiveCreateResponse } from "openai/resources/live/live";
import type { ConnectClientEvent, ConnectServerEvent } from "openai/resources/live/sideband/sideband";
import { SidebandWS } from "openai/resources/live/sideband/ws";

import {
  DATA_TOOL_NAMES,
  openBusiness,
  openExpert,
  presentChoices,
  runTool,
  screenContextPayload,
  showOnMap,
  toChoicesSnapshot,
  type ChoicesSnapshot,
  type JsonRecord,
  type KnownBusiness,
  type KnownExpert,
  type ToolContext,
} from "./tools.js";
import {
  backendInstructionsWithScreen,
  buildSessionConfig,
  screenContextLine,
  type LiveClientContext,
} from "./session-config.js";

const TRANSCRIPT_FLUSH_MS = 1500;
const MAX_TOOL_OUTPUT_CHARS = 12000;
const ACK_TIMEOUT_MS = 4000;
const DEFAULT_MAX_SESSION_SECONDS = 600;

export type ScreenContextTransport = "session.update" | "session.thinking.append";

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

interface PendingAck {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
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

function positiveIntEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function maxSessions(): number {
  return positiveIntEnv("LIVE_MAX_SESSIONS", 3);
}

function maxSessionSeconds(): number {
  return positiveIntEnv("LIVE_MAX_SESSION_SECONDS", DEFAULT_MAX_SESSION_SECONDS);
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
  private readonly knownExperts = new Map<string, KnownExpert>();
  private readonly handledCalls = new Set<string>();
  private readonly pendingAcks = new Map<string, PendingAck>();
  private toolQueue: Promise<void> = Promise.resolve();
  private lastChoices: ChoicesSnapshot | null = null;
  private lastScreen: string | null = null;
  private transcriptSide: "user" | "assistant" | null = null;
  private transcriptBuffer = "";
  private transcriptTimer: NodeJS.Timeout | null = null;
  private lifetimeTimer: NodeJS.Timeout | null = null;
  private ackSeq = 0;
  private closed = false;

  private constructor(id: string, context: ToolContext, screen: string | null) {
    this.id = id;
    this.shortId = id.slice(-6);
    this.context = context;
    this.lastScreen = screen;
    this.ws = new SidebandWS(openaiClient(), { session_id: id });
    this.ws.on("event", (event) => this.handleEvent(event));
    this.ws.on("error", (error) => {
      console.error(`[live ${this.shortId}] sideband error`, error, error.error ?? "");
    });
    this.ws.on("close", (code, reason) => {
      this.log(`sideband closed (${code} ${reason || "-"})`);
      this.dispose();
    });
    this.startLifetimeTimer();
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
    const session = new LiveConciergeSession(
      result.session.id,
      context,
      clientContext.screen?.trim() || null,
    );
    registry.set(session.id, session);
    session.log(
      `created voice=${String(sessionConfig.audio?.output?.voice)} client=${clientContext.client ?? "-"} location=${clientContext.location ? "yes" : "no"} screen=${session.lastScreen ? "yes" : "no"}`,
    );
    return { result, session };
  }

  get choices(): ChoicesSnapshot | null {
    return this.lastChoices;
  }

  get screen(): string | null {
    return this.lastScreen;
  }

  /**
   * Docs prefer session.update for supported settings inside an existing delegation
   * mode; thinking.append is the fallback when the update is rejected.
   */
  async setScreen(screen: string): Promise<ScreenContextTransport> {
    this.lastScreen = screen;
    const eventId = `screen-${(this.ackSeq += 1)}`;
    try {
      await this.sendAndAwaitAck(
        {
          type: "session.update",
          event_id: eventId,
          session: {
            delegation: {
              type: "responses",
              responses: { instructions: backendInstructionsWithScreen(screen) },
            },
          },
        },
        eventId,
      );
      this.log(`screen via session.update: ${screen}`);
      return "session.update";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`session.update rejected (${message}) — falling back to session.thinking.append`);
      this.ws.send({
        type: "session.thinking.append",
        delegation_id: null,
        content: screenContextLine(screen),
      });
      this.log(`screen via session.thinking.append: ${screen}`);
      return "session.thinking.append";
    }
  }

  close(): void {
    if (this.closed) return;
    try {
      this.ws.send({ type: "session.close" });
    } catch (error) {
      console.error(`[live ${this.shortId}] session.close failed`, error);
    }
  }

  private startLifetimeTimer(): void {
    const seconds = maxSessionSeconds();
    this.lifetimeTimer = setTimeout(() => {
      this.log(`auto-closed after ${seconds}s (LIVE_MAX_SESSION_SECONDS)`);
      this.close();
    }, seconds * 1000);
    this.lifetimeTimer.unref?.();
  }

  private sendAndAwaitAck(event: ConnectClientEvent, eventId: string): Promise<void> {
    if (this.closed) return Promise.reject(new Error("Session already closed."));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(eventId);
        reject(new Error(`No acknowledgement within ${ACK_TIMEOUT_MS}ms.`));
      }, ACK_TIMEOUT_MS);
      timer.unref?.();
      this.pendingAcks.set(eventId, { resolve, reject, timer });
      try {
        this.ws.send(event);
      } catch (error) {
        this.settleAck(eventId, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private settleAck(eventId: string | undefined, error: Error | null): boolean {
    if (!eventId) return false;
    const pending = this.pendingAcks.get(eventId);
    if (!pending) return false;
    this.pendingAcks.delete(eventId);
    clearTimeout(pending.timer);
    if (error) pending.reject(error);
    else pending.resolve();
    return true;
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
      case "session.updated":
        this.settleAck(event.client_event_id, null);
        return;
      case "error": {
        const detail = `${event.error.type}/${event.error.code}: ${event.error.message}${event.error.param ? ` (param ${event.error.param})` : ""}`;
        const claimed = this.settleAck(
          event.client_event_id ?? event.error.client_event_id,
          new Error(detail),
        );
        if (!claimed) this.log(`error ${detail}`);
        return;
      }
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
      for (const expert of run.experts ?? []) this.knownExperts.set(expert.expert_id, expert);
      return run.payload;
    }
    if (call.name === "get_screen_context") {
      return screenContextPayload(this.lastScreen);
    }
    if (call.name === "present_choices") {
      const payload = await presentChoices(call.arguments, this.knownBusinesses);
      if (payload.ok) this.lastChoices = toChoicesSnapshot(payload.shown) ?? this.lastChoices;
      return payload;
    }
    if (call.name === "open_business") {
      return openBusiness(call.arguments, this.knownBusinesses);
    }
    if (call.name === "open_expert") {
      return openExpert(call.arguments, this.knownExperts);
    }
    if (call.name === "show_on_map") {
      return showOnMap(call.arguments, this.knownBusinesses);
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
    if (this.lifetimeTimer) {
      clearTimeout(this.lifetimeTimer);
      this.lifetimeTimer = null;
    }
    for (const eventId of [...this.pendingAcks.keys()]) {
      this.settleAck(eventId, new Error("Session closed before acknowledgement."));
    }
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
