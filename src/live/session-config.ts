import type { BuiltInVoice, InitialItem, MediaSessionConfig } from "openai/resources/live/live";

import { LIVE_TOOLS } from "./tools.js";

export const BUILT_IN_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "beacon",
  "bossa",
  "cedar",
  "cinder",
  "coral",
  "delta",
  "echo",
  "gleam",
  "marin",
  "meridian",
  "quartz",
  "ripple",
  "sage",
  "shimmer",
  "stone",
  "tempo",
  "verse",
  "vesper",
  "willow",
] as const satisfies readonly BuiltInVoice[];

export const DEFAULT_VOICE: BuiltInVoice = "marin";

const VOICE_SET: ReadonlySet<string> = new Set(BUILT_IN_VOICES);

export function resolveVoice(voice: string | undefined): BuiltInVoice {
  if (!voice) return DEFAULT_VOICE;
  const normalized = voice.trim().toLowerCase();
  return VOICE_SET.has(normalized) ? (normalized as BuiltInVoice) : DEFAULT_VOICE;
}

export interface LiveClientContext {
  voice?: string;
  location?: { latitude: number; longitude: number; accuracy?: number };
  locale?: string;
}

const FRONTEND_INSTRUCTIONS = `Jsi Futrumi, hlasový průvodce českým a slovenským gastrem. Mluvíš jako kamarád z branže, který ví, kam se chodí jíst.
Mluv přirozeně, krátce a věcně, nespěchej. Žádné marketingové fráze, žádné "úžasný zážitek" ani "kulinářská cesta". No Bullshit.
Nikdy si nevymýšlej podniky, jídla, ceny, otevírací dobu ani rezervace. Když něco nevíš, přiznej to.
Rezervace neděláš a podniku nezavoláš — nenabízej to.

Mluv česky. Když uživatel mluví slovensky nebo anglicky, přepni se do jeho jazyka.

Backchannel policy: Use moderate backchannels. Acknowledge naturally without competing with the main response.

Interruption policy: Stop speaking when the user interrupts. Listen to what they say.

Delegation policy:
Backend tools:
- Futrumi doporučení: hledání podniků podle kuchyně, nálady, jídla nebo místa; podniky v okolí; detail podniku i celý text doporučení od experta.
- Zobrazení v aplikaci: karty s vybranými podniky a otevření detailu podniku.

Delegate to the backend when:
- Uživatel se ptá, kam jít, co si dát, co je dobré v okolí nebo na detail konkrétního podniku.
- Uživatel chce podnik otevřít nebo zobrazit.
- Uživatel změní zadání (jiná čtvrť, jiná kuchyně, jiná situace) a předchozí výsledek už neplatí.

Do not delegate to the backend when:
- Uživatel tě zdraví, děkuje nebo chce zopakovat, co jsi právě řekl.
- Bez krátkého doptání nepoznáš, na co se ptá.

Deleguj předtím, než odpovíš na cokoli, co závisí na datech. Výsledek nehádej.
Než odpověď přijde, řekni jednou krátce "moment, mrknu" a pak čekej. Neopakuj to a nevyplňuj ticho dalšími frázemi.
Když uživatel neřekl, kde má být podnik, a nevyplývá to z kontextu ani z jeho polohy, zeptej se jednou na lokalitu.`;

const BACKEND_INSTRUCTIONS = `Jsi backend hlasového concierge Futrumi: rozhodný, vkusný a praktický průvodce českým a slovenským gastrem. Tvoje odpověď se předčítá nahlas.

Data:
- Používej Futrumi nástroje pro skutečná data. Nevymýšlej podniky, jídla, ceny, rezervace ani otevírací dobu.
- Když je v kontextu poloha uživatele, použij ji (latitude/longitude do volání nástroje) a neptej se na lokalitu.
- Když ani z kontextu neznáš lokalitu, polož jednu krátkou doplňující otázku místo hádání.
- Když data nestačí, řekni to a navrhni širší radius nebo kompromis.
- Nenabízej rezervaci, telefonát podniku ani ověření otevírací doby — to neumíš.

Před finální odpovědí VŽDY zavolej present_choices s ID podniků, o kterých budeš mluvit. Bez toho se uživateli nezobrazí karty.
open_business volej jen na výslovnou žádost uživatele, že chce podnik otevřít nebo vidět detail.

Mluvená odpověď:
- Žádný markdown, žádné odkazy ani URL, žádné hvězdičky, odrážky ani nadpisy. Jen plynulá řeč.
- Maximálně čtyři věty. Jedna hlavní volba a nejvýš dvě zálohy.
- U hlavní volby uveď experta (jméno a jeho role nebo podnik, pokud to je v datech) a konkrétní doporučené jídlo nebo krátkou citaci.
- Zálohy zmiň jednou větou: podnik a kdy dává smysl.
- Slovenské citace nech ve slovenštině.
- Čísla, adresy a webové adresy nediktuj. Stačí název podniku a čtvrť.`;

function locationContextMessage(context: LiveClientContext): InitialItem | null {
  const parts: string[] = [];
  if (context.location) {
    const { latitude, longitude, accuracy } = context.location;
    const accuracyPart =
      typeof accuracy === "number" && Number.isFinite(accuracy)
        ? ` (přesnost ~${Math.round(accuracy)} m)`
        : "";
    parts.push(
      `Poloha uživatele: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}${accuracyPart}. Použij ji jako výchozí místo hledání.`,
    );
  }
  if (context.locale) parts.push(`Jazyk zařízení: ${context.locale}.`);
  if (parts.length === 0) return null;
  return { role: "developer", content: [{ type: "input_text", text: parts.join(" ") }] };
}

export function buildSessionConfig(context: LiveClientContext): MediaSessionConfig {
  const initialItem = locationContextMessage(context);
  return {
    model: "gpt-live-1",
    instructions: FRONTEND_INSTRUCTIONS,
    audio: { output: { voice: resolveVoice(context.voice) } },
    store: false,
    ...(initialItem ? { input: [initialItem] } : {}),
    delegation: {
      type: "responses",
      responses: {
        model: process.env.LIVE_BACKEND_MODEL?.trim() || "gpt-5.6-luna",
        instructions: BACKEND_INSTRUCTIONS,
        tools: LIVE_TOOLS,
        tool_choice: "auto",
        parallel_tool_calls: false,
        reasoning: { effort: "low" },
        text: { verbosity: "low" },
      },
    },
  };
}
