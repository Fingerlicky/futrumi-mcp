import "../env.js";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { answerConciergeRequest } from "./decision-engine.js";

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramChat {
  id: number;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface TelegramState {
  offset?: number;
}

interface TelegramOptions {
  help: boolean;
  checkConfig: boolean;
}

const MAX_TELEGRAM_MESSAGE_LENGTH = 3900;
const DEFAULT_POLL_TIMEOUT_SECONDS = 45;

function parseArgs(argv: string[]): TelegramOptions {
  return {
    help: argv.includes("--help") || argv.includes("-h"),
    checkConfig: argv.includes("--check-config"),
  };
}

function printHelp(): void {
  console.log(`Futrumi concierge Telegram bot

Usage:
  npm run concierge:telegram
  npm run concierge:telegram -- --check-config

Required env:
  TELEGRAM_BOT_TOKEN
  TELEGRAM_ALLOWED_USER_IDS

Optional env:
  CONCIERGE_DATA_DIR
  TELEGRAM_POLL_TIMEOUT_SECONDS
  TELEGRAM_WHOAMI_OPEN=true|false
`);
}

function dataDir(): string {
  return resolve(process.env.CONCIERGE_DATA_DIR?.trim() || ".concierge-data");
}

function ensureDataDir(): string {
  const dir = dataDir();
  mkdirSync(resolve(dir, "logs"), { recursive: true });
  return dir;
}

function readState(): TelegramState {
  const path = resolve(ensureDataDir(), "telegram-state.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as TelegramState;
  } catch {
    return {};
  }
}

function writeState(state: TelegramState): void {
  writeFileSync(resolve(ensureDataDir(), "telegram-state.json"), `${JSON.stringify(state, null, 2)}\n`);
}

function appendLog(event: string, payload: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...payload,
  });
  appendFileSync(resolve(ensureDataDir(), "logs", "requests.jsonl"), `${line}\n`);
}

function allowedUserIds(): Set<number> {
  const raw = process.env.TELEGRAM_ALLOWED_USER_IDS?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((item) => Number.parseInt(item, 10))
      .filter(Number.isFinite),
  );
}

function pollTimeoutSeconds(): number {
  const configured = Number.parseInt(process.env.TELEGRAM_POLL_TIMEOUT_SECONDS ?? "", 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_POLL_TIMEOUT_SECONDS;
}

function token(): string {
  const value = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!value) throw new Error("TELEGRAM_BOT_TOKEN is not set.");
  return value;
}

function userLabel(user: TelegramUser | undefined): string {
  if (!user) return "unknown";
  return [user.first_name, user.last_name, user.username ? `@${user.username}` : ""]
    .filter(Boolean)
    .join(" ")
    .trim() || `${user.id}`;
}

function chunks(text: string): string[] {
  if (text.length <= MAX_TELEGRAM_MESSAGE_LENGTH) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > MAX_TELEGRAM_MESSAGE_LENGTH) {
    const splitAt = remaining.lastIndexOf("\n", MAX_TELEGRAM_MESSAGE_LENGTH);
    const index = splitAt > 1000 ? splitAt : MAX_TELEGRAM_MESSAGE_LENGTH;
    parts.push(remaining.slice(0, index).trimEnd());
    remaining = remaining.slice(index).trimStart();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

class TelegramClient {
  private readonly baseUrl: string;

  constructor(botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  async getUpdates(offset: number | undefined): Promise<TelegramUpdate[]> {
    const body = {
      timeout: pollTimeoutSeconds(),
      allowed_updates: ["message"],
      ...(typeof offset === "number" ? { offset } : {}),
    };
    const data = await this.request<TelegramUpdate[]>("getUpdates", body);
    return data ?? [];
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    for (const part of chunks(text)) {
      await this.request("sendMessage", {
        chat_id: chatId,
        text: part,
        disable_web_page_preview: true,
      });
    }
  }

  async sendTyping(chatId: number): Promise<void> {
    await this.request("sendChatAction", {
      chat_id: chatId,
      action: "typing",
    });
  }

  private async request<T>(method: string, body: Record<string, unknown>): Promise<T | undefined> {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as TelegramResponse<T>;
    if (!response.ok || !data.ok) {
      throw new Error(`Telegram ${method} failed: ${data.description ?? response.statusText}`);
    }
    return data.result;
  }
}

function whoamiText(user: TelegramUser | undefined): string {
  if (!user) return "Telegram user id se nepodařilo zjistit.";
  return `Tvoje Telegram user id: \`${user.id}\`\nPřidej ho do \`TELEGRAM_ALLOWED_USER_IDS\`.`;
}

function helpText(): string {
  return [
    "Futrumi concierge",
    "",
    "Pošli mi dotaz typu:",
    "`rande vino Praha 7`",
    "`rychlá večeře u Národní, nechci turistickou past`",
    "",
    "Příkazy:",
    "`/help` - nápověda",
    "`/whoami` - zobrazí tvoje Telegram user id",
    "`/reset` - reset lokálního chat stavu",
  ].join("\n");
}

async function handleCommand(
  client: TelegramClient,
  message: TelegramMessage,
  text: string,
): Promise<boolean> {
  const command = text.split(/\s+/, 1)[0]?.toLocaleLowerCase("cs-CZ");
  if (command === "/help" || command === "/start") {
    await client.sendMessage(message.chat.id, helpText());
    return true;
  }
  if (command === "/whoami") {
    await client.sendMessage(message.chat.id, whoamiText(message.from));
    return true;
  }
  if (command === "/reset") {
    await client.sendMessage(
      message.chat.id,
      "Reset hotový. Zatím nemám dlouhodobou konverzační paměť, takže není co mazat.",
    );
    return true;
  }
  return false;
}

function canReplyToWhoami(userId: number | undefined, allowed: Set<number>): boolean {
  if (userId === undefined) return false;
  if (allowed.has(userId)) return true;
  return process.env.TELEGRAM_WHOAMI_OPEN !== "false";
}

async function handleMessage(
  client: TelegramClient,
  message: TelegramMessage,
  allowed: Set<number>,
): Promise<void> {
  const text = message.text?.trim();
  if (!text) return;

  const userId = message.from?.id;
  if (userId === undefined) return;

  if (!allowed.has(userId)) {
    appendLog("telegram_unauthorized", {
      userId,
      user: userLabel(message.from),
      command: text.startsWith("/") ? text.split(/\s+/, 1)[0] : undefined,
    });
    if (text.startsWith("/whoami") && canReplyToWhoami(userId, allowed)) {
      await client.sendMessage(message.chat.id, whoamiText(message.from));
    }
    return;
  }

  if (text.startsWith("/") && (await handleCommand(client, message, text))) {
    appendLog("telegram_command", { userId, user: userLabel(message.from), command: text });
    return;
  }

  appendLog("telegram_request", {
    userId,
    user: userLabel(message.from),
    messageId: message.message_id,
    text,
  });

  try {
    await client.sendTyping(message.chat.id);
    const answer = await answerConciergeRequest({ message: text });
    await client.sendMessage(message.chat.id, answer);
    appendLog("telegram_response", {
      userId,
      user: userLabel(message.from),
      messageId: message.message_id,
      answerLength: answer.length,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    appendLog("telegram_error", {
      userId,
      user: userLabel(message.from),
      messageId: message.message_id,
      error: detail,
    });
    await client.sendMessage(
      message.chat.id,
      `Teď jsem se zasekl při hledání odpovědi.\n\n\`${detail}\``,
    );
  }
}

async function drainPendingUpdates(client: TelegramClient, state: TelegramState): Promise<TelegramState> {
  if (typeof state.offset === "number") return state;
  const updates = await client.getUpdates(undefined);
  const last = updates.at(-1);
  if (!last) return state;
  const offset = last.update_id + 1;
  writeState({ offset });
  console.log(`Drained ${updates.length} pending Telegram update(s). Starting at offset ${offset}.`);
  return { offset };
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const allowed = allowedUserIds();
  if (options.checkConfig) {
    console.log(`TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN?.trim() ? "set" : "missing"}`);
    console.log(`TELEGRAM_ALLOWED_USER_IDS: ${allowed.size ? `${allowed.size} id(s)` : "missing"}`);
    console.log(`CONCIERGE_DATA_DIR: ${dataDir()}`);
    return;
  }

  if (allowed.size === 0) {
    throw new Error("TELEGRAM_ALLOWED_USER_IDS is empty. Use /whoami once to find your id, then set it.");
  }

  const client = new TelegramClient(token());
  let state = await drainPendingUpdates(client, readState());
  console.log(`Futrumi Telegram concierge listening. Allowed users: ${[...allowed].join(", ")}`);

  for (;;) {
    try {
      const updates = await client.getUpdates(state.offset);
      for (const update of updates) {
        state = { offset: update.update_id + 1 };
        writeState(state);
        if (update.message) {
          await handleMessage(client, update.message, allowed);
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      appendLog("telegram_poll_error", { error: detail });
      console.error(`Telegram poll failed: ${detail}`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 5000));
    }
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Telegram concierge failed: ${message}`);
  process.exitCode = 1;
});
