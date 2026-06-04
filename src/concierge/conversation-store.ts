import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

interface ConversationRecord {
  updatedAt: string;
  turns: ConversationTurn[];
}

// Keep the window small on purpose: enough to follow up on the last decision
// ("ten druhý?", "něco blíž"), not so big that we replay an endless thread and
// burn tokens. Both knobs are env-overridable.
const DEFAULT_MAX_MESSAGES = 6;
const DEFAULT_IDLE_MINUTES = 30;
// Hard cap per stored message so one giant paste can't bloat the window.
const MAX_STORED_CHARS = 4000;

function intEnv(key: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[key] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const maxMessages = (): number => intEnv("CONCIERGE_HISTORY_MAX_MESSAGES", DEFAULT_MAX_MESSAGES, 2, 40);
const idleMinutes = (): number => intEnv("CONCIERGE_HISTORY_IDLE_MINUTES", DEFAULT_IDLE_MINUTES, 1, 1440);

function conversationsDir(): string {
  const base = resolve(process.env.CONCIERGE_DATA_DIR?.trim() || ".concierge-data");
  const dir = resolve(base, "conversations");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function conversationPath(chatId: number): string {
  return resolve(conversationsDir(), `${chatId}.json`);
}

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= MAX_STORED_CHARS ? trimmed : `${trimmed.slice(0, MAX_STORED_CHARS - 1).trimEnd()}…`;
}

function readRecord(chatId: number): ConversationRecord | undefined {
  const path = conversationPath(chatId);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ConversationRecord;
    if (!Array.isArray(parsed.turns)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function isIdle(updatedAt: string): boolean {
  const last = Date.parse(updatedAt);
  if (!Number.isFinite(last)) return true;
  return Date.now() - last > idleMinutes() * 60_000;
}

// Recent turns for this chat, oldest-first. Empty if the thread went idle —
// a new question after a long pause starts a fresh context.
export function loadHistory(chatId: number): ConversationTurn[] {
  const record = readRecord(chatId);
  if (!record || isIdle(record.updatedAt)) return [];
  return record.turns.slice(-maxMessages());
}

export function appendTurns(chatId: number, userText: string, assistantText: string): void {
  const turns: ConversationTurn[] = [
    ...loadHistory(chatId),
    { role: "user" as const, content: clip(userText) },
    { role: "assistant" as const, content: clip(assistantText) },
  ].slice(-maxMessages());
  const record: ConversationRecord = { updatedAt: new Date().toISOString(), turns };
  writeFileSync(conversationPath(chatId), `${JSON.stringify(record, null, 2)}\n`);
}

export function clearConversation(chatId: number): void {
  rmSync(conversationPath(chatId), { force: true });
}
