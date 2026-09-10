import { DATA_TOOLS, runTool } from "../live/tools.js";
import type { ConciergeRequest } from "./decision-engine.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5";
const DEFAULT_MAX_TOOL_ROUNDS = 4;

type JsonRecord = Record<string, unknown>;

interface MessageOutput {
  type: "message";
  content?: Array<{ type?: string; text?: string }>;
}

interface FunctionCallOutput {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

type OpenAIOutputItem = MessageOutput | FunctionCallOutput | JsonRecord;

interface OpenAIResponse {
  id: string;
  output?: OpenAIOutputItem[];
  output_text?: string;
  error?: { message?: string };
}

type ResponseInputItem =
  | { role: "user" | "assistant"; content: string }
  | OpenAIOutputItem
  | { type: "function_call_output"; call_id: string; output: string };

const clamp = (value: number | undefined, fallback: number, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
};

function extractText(response: OpenAIResponse): string {
  if (response.output_text?.trim()) return response.output_text.trim();
  const parts: string[] = [];
  for (const item of response.output ?? []) {
    if (!isMessageOutput(item)) continue;
    for (const content of item.content ?? []) {
      if (content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function isMessageOutput(item: OpenAIOutputItem): item is MessageOutput {
  return item.type === "message";
}

function functionCalls(response: OpenAIResponse): FunctionCallOutput[] {
  return (response.output ?? []).filter(
    (item): item is FunctionCallOutput =>
      item.type === "function_call" &&
      typeof item.call_id === "string" &&
      typeof item.name === "string" &&
      typeof item.arguments === "string",
  );
}

async function createResponse(input: ResponseInputItem[]): Promise<OpenAIResponse> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
      instructions: SYSTEM_PROMPT,
      input,
      tools: DATA_TOOLS,
      tool_choice: "auto",
      parallel_tool_calls: false,
      max_output_tokens: 1400,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as OpenAIResponse;
  if (data.error?.message) throw new Error(data.error.message);
  return data;
}

const SYSTEM_PROMPT = `Jsi Futrumi premium concierge: rozhodný, vkusný a praktický průvodce českým gastrem.

Pravidla:
- Odpovídej česky, pokud uživatel nepíše jinak.
- Vidíš posledních pár zpráv téhle konverzace jako kontext. Navazuj na ně přirozeně — když se uživatel ptá „a ten druhý?“, „něco blíž“, „a v Brně?“ nebo „kde jsi to říkal“, vztáhni to k tomu, cos právě doporučil.
- Vždy se ale řiď poslední zprávou uživatele: když změní lokalitu, kuchyni, situaci nebo rozpočet, ber to jako nové zadání a nedrž se starého kontextu natvrdo.
- Nejsi katalog. Vyber 1 hlavní volbu a maximálně 2 zálohy.
- Používej Futrumi nástroje pro skutečná data. Nevymýšlej podniky, jídla, ceny, rezervace ani otevírací dobu.
- Nenabízej, že zařídíš rezervaci, zavoláš podniku nebo ověříš aktuální otevírací dobu — to neumíš. Jako další krok nabídni jen to, na co máš data: deeplink nebo mapový odkaz.
- Neslibuj akce do dalšího kroku, na které nemáš nástroj. Odpověď je sama o sobě kompletní.
- U každé volby vysvětli fit na kontext uživatele.
- Uveď provenance: expert, citace nebo konkrétní doporučené jídlo/drink.
- Když ani z kontextu konverzace neznáš lokalitu nebo zásadní detail, polož jednu krátkou doplňující otázku místo hádání.
- Pokud data nestačí, řekni to a navrhni širší radius nebo kompromis.

Formát:
- U běžného doporučení drž formát níže.
- U krátkého navazujícího upřesnění (např. „a ten druhý?“) odpověz stručně a formát klidně vynech.

Šel bych do: [podnik]
Proč: [stručně a konkrétně]
Opírám se o: [expert] - "[krátká citace]" / [doporučené jídlo]
Další krok: [deeplink/mapový link pokud je v datech]

Zálohy:
- [podnik] - [kdy dává smysl]
- [podnik] - [kdy dává smysl]`;

function userInput(request: ConciergeRequest): string {
  return [
    `Dotaz: ${request.message}`,
    request.locationQuery ? `Výchozí lokalita: ${request.locationQuery}` : "",
    typeof request.radiusMeters === "number" ? `Preferovaný radius: ${request.radiusMeters} m` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function canUseOpenAI(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim()) && process.env.CONCIERGE_USE_LLM !== "false";
}

export async function answerWithOpenAI(request: ConciergeRequest): Promise<string> {
  const maxToolRounds = clamp(
    Number.parseInt(process.env.CONCIERGE_MAX_TOOL_ROUNDS ?? "", 10),
    DEFAULT_MAX_TOOL_ROUNDS,
    1,
    8,
  );
  const input: ResponseInputItem[] = [
    ...(request.history ?? []).map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user", content: userInput(request) },
  ];

  for (let round = 0; round < maxToolRounds; round += 1) {
    const response = await createResponse(input);
    const calls = functionCalls(response);
    if (calls.length === 0) {
      const text = extractText(response);
      return text || "Nemám dost jistoty na doporučení. Doplníš prosím lokalitu a situaci?";
    }

    input.push(...(response.output ?? []));
    for (const call of calls) {
      const { payload } = await runTool(call.name, call.arguments, request);
      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(payload),
      });
    }
  }

  return "Potřebuju ještě jednu věc upřesnit, abych nevařil z vody: pro jakou lokalitu a situaci to vybíráme?";
}
