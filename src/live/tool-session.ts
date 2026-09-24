import {
  CLIENT_TOOL_NAMES,
  DATA_TOOL_NAMES,
  knownFromRouteResult,
  openBusiness,
  openExpert,
  presentChoices,
  runTool,
  screenContextPayload,
  showOnMap,
  toChoicesSnapshot,
  type ChoicesSnapshot,
  type KnownBusiness,
  type KnownExpert,
  type ToolArgs,
  type ToolContext,
} from "./tools.js";

export type LiveProvider = "openai" | "gemini";

export const MAX_TOOL_OUTPUT_CHARS = 12000;

const DEFAULT_MAX_SESSION_SECONDS = 600;

// Apple Maps routing plus a handful of detour legs; past this the model gets an error to speak around.
const CLIENT_RESULT_TIMEOUT_MS = 30_000;

/** How the app answered a client tool: posted by call id (OpenAI) or inline with the relay (Gemini). */
export interface ClientToolAnswer {
  callId?: string;
  result?: unknown;
}

export class LiveSessionLimitError extends Error {
  constructor(readonly limit: number) {
    super(`Too many concurrent live sessions (limit ${limit}).`);
  }
}

function positiveIntEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function maxSessions(): number {
  return positiveIntEnv("LIVE_MAX_SESSIONS", 3);
}

export function maxSessionSeconds(): number {
  return positiveIntEnv("LIVE_MAX_SESSION_SECONDS", DEFAULT_MAX_SESSION_SECONDS);
}

const TOO_LARGE_PAYLOAD = {
  error: "Result too large to send. Ask for fewer items (limit 3).",
};

/**
 * One serialization for both providers: OpenAI needs the JSON string it puts on
 * the sideband, the Gemini relay needs the object it returns over HTTP.
 */
export function capToolPayload(value: unknown): { json: string; value: unknown } {
  const json = JSON.stringify(value) ?? "null";
  if (json.length <= MAX_TOOL_OUTPUT_CHARS) return { json, value };
  return { json: JSON.stringify(TOO_LARGE_PAYLOAD), value: TOO_LARGE_PAYLOAD };
}

/**
 * Everything a tool call needs that is not provider-specific: the ids the model
 * has already seen (so present_choices/open_business can only name real places),
 * the last screen the app reported, and the last set of cards.
 *
 * The OpenAI session drives this from its sideband socket; the Gemini session is
 * driven by the client relaying tool calls to POST /live/session/:id/tool.
 */
export class ToolSessionState {
  readonly knownBusinesses = new Map<string, KnownBusiness>();
  readonly knownExperts = new Map<string, KnownExpert>();
  private lastChoices: ChoicesSnapshot | null = null;
  private lastScreen: string | null;
  // The app sees the call on its data channel about when the sideband does, so a result may land first.
  private readonly earlyClientResults = new Map<string, unknown>();
  private readonly clientWaiters = new Map<string, (result: unknown) => void>();

  constructor(
    readonly context: ToolContext,
    screen: string | null = null,
  ) {
    this.lastScreen = screen;
  }

  get choices(): ChoicesSnapshot | null {
    return this.lastChoices;
  }

  get screen(): string | null {
    return this.lastScreen;
  }

  setScreen(screen: string): void {
    this.lastScreen = screen;
  }

  deliverClientResult(callId: string, result: unknown): void {
    const waiter = this.clientWaiters.get(callId);
    if (waiter) {
      this.clientWaiters.delete(callId);
      waiter(result);
      return;
    }
    this.earlyClientResults.set(callId, result);
  }

  async execute(name: string, args: ToolArgs, answer: ClientToolAnswer = {}): Promise<unknown> {
    if (CLIENT_TOOL_NAMES.has(name)) {
      const result = await this.clientResult(answer);
      for (const business of knownFromRouteResult(result)) {
        this.knownBusinesses.set(business.business_id, business);
      }
      return result;
    }
    if (DATA_TOOL_NAMES.has(name)) {
      const run = await runTool(name, args, this.context);
      for (const business of run.businesses) {
        this.knownBusinesses.set(business.business_id, business);
      }
      for (const expert of run.experts ?? []) this.knownExperts.set(expert.expert_id, expert);
      return run.payload;
    }
    if (name === "get_screen_context") {
      return screenContextPayload(this.lastScreen);
    }
    if (name === "present_choices") {
      const payload = await presentChoices(args, this.knownBusinesses);
      if (payload.ok) this.lastChoices = toChoicesSnapshot(payload.shown) ?? this.lastChoices;
      return payload;
    }
    if (name === "open_business") {
      return openBusiness(args, this.knownBusinesses);
    }
    if (name === "open_expert") {
      return openExpert(args, this.knownExperts);
    }
    if (name === "show_on_map") {
      return showOnMap(args, this.knownBusinesses);
    }
    return { error: `Unknown tool: ${name}` };
  }

  private clientResult({ callId, result }: ClientToolAnswer): Promise<unknown> {
    if (result !== undefined) return Promise.resolve(result);
    if (!callId) return Promise.resolve({ error: "Tenhle nástroj počítá aplikace a výsledek nepřišel." });
    if (this.earlyClientResults.has(callId)) {
      const early = this.earlyClientResults.get(callId);
      this.earlyClientResults.delete(callId);
      return Promise.resolve(early);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.clientWaiters.delete(callId);
        resolve({ error: "Aplikace trasu nespočítala včas. Zkus to znovu, nebo zjednoduš cíl." });
      }, CLIENT_RESULT_TIMEOUT_MS);
      timer.unref?.();
      this.clientWaiters.set(callId, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }
}

export interface LiveSessionRecord {
  readonly id: string;
  readonly provider: LiveProvider;
  readonly state: ToolSessionState;
  /** OpenAI pushes the screen to the running model; Gemini only stores it. */
  setScreen(screen: string): Promise<unknown>;
}

const registry = new Map<string, LiveSessionRecord>();

export function registerLiveSession(session: LiveSessionRecord): void {
  registry.set(session.id, session);
}

export function unregisterLiveSession(id: string): void {
  registry.delete(id);
}

export function getLiveSession(id: string): LiveSessionRecord | undefined {
  return registry.get(id);
}

export function liveSessionCount(): number {
  return registry.size;
}
