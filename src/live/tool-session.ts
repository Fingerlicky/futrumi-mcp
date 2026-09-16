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
  type KnownBusiness,
  type KnownExpert,
  type ToolArgs,
  type ToolContext,
} from "./tools.js";

export type LiveProvider = "openai" | "gemini";

export const MAX_TOOL_OUTPUT_CHARS = 12000;

const DEFAULT_MAX_SESSION_SECONDS = 600;

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

  async execute(name: string, args: ToolArgs): Promise<unknown> {
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
