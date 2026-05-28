import "../env.js";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { answerConciergeRequest } from "./decision-engine.js";

interface CliOptions {
  message: string;
  locationQuery?: string;
  radiusMeters?: number;
  limit?: number;
  useLlm?: boolean;
  help: boolean;
}

const LOCATION_PATTERNS = [
  /\b(?:Praha|Prague)\s*\d{1,2}\b/iu,
  /\bBrno(?:-[\p{Letter}\p{Mark}-]+)?\b/iu,
  /\b(?:Praha|Prague|Karlín|Karlin|Holešovice|Holesovice|Vinohrady|Žižkov|Zizkov|Letná|Letna|Dejvice|Smíchov|Smichov|Národní|Narodni|Anděl|Andel)\b/iu,
];

function readNumberFlag(name: string, value: string | undefined): number {
  if (!value) {
    throw new Error(`Flag ${name} potřebuje hodnotu.`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Flag ${name} musí být číslo.`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const messageParts: string[] = [];
  const options: CliOptions = { message: "", help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--location" || arg === "-l") {
      const value = argv[index + 1];
      if (!value) throw new Error(`Flag ${arg} potřebuje hodnotu.`);
      options.locationQuery = value;
      index += 1;
    } else if (arg === "--radius") {
      options.radiusMeters = readNumberFlag(arg, argv[index + 1]);
      index += 1;
    } else if (arg === "--limit") {
      options.limit = readNumberFlag(arg, argv[index + 1]);
      index += 1;
    } else if (arg === "--no-llm") {
      options.useLlm = false;
    } else if (arg) {
      messageParts.push(arg);
    }
  }

  options.message = messageParts.join(" ").trim();
  return options;
}

function inferLocationQuery(message: string): string | undefined {
  for (const pattern of LOCATION_PATTERNS) {
    const match = message.match(pattern);
    if (match?.[0]) return match[0];
  }
  return undefined;
}

function printHelp(): void {
  console.log(`Futrumi concierge CLI

Usage:
  npm run concierge:cli -- "rande vino Praha 7"
  npm run concierge:cli -- --location "Praha 7" "rande vino"
  npm run concierge:cli -- --location "Národní" --radius 2500 "rychlá večeře bez turistické pasti"

Flags:
  -l, --location   Lokalita pro hledání, pokud není přímo ve zprávě
  --radius         Radius v metrech
  --limit          Počet kandidátů pro odpověď, default 3
  --no-llm         Vynutí deterministický fallback bez OpenAI API
`);
}

async function promptForMissingInput(options: CliOptions): Promise<CliOptions> {
  if (!input.isTTY) return options;

  const rl = createInterface({ input, output });
  try {
    const message = options.message || (await rl.question("Co řešíš? "));
    const inferredLocation = options.locationQuery ?? inferLocationQuery(message);
    const locationQuery =
      inferredLocation || (await rl.question("Kde to chceš hledat? "));
    return {
      ...options,
      message: message.trim(),
      locationQuery: locationQuery.trim() || undefined,
    };
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    printHelp();
    return;
  }

  const options = await promptForMissingInput({
    ...parsed,
    locationQuery: parsed.locationQuery ?? inferLocationQuery(parsed.message),
  });

  if (!options.message) {
    console.log("Napiš dotaz, třeba: npm run concierge:cli -- \"rande vino Praha 7\"");
    return;
  }

  if (!options.locationQuery) {
    console.log("Doplň lokalitu přes --location, nebo ji napiš přímo do dotazu.");
    return;
  }

  const answer = await answerConciergeRequest({
    message: options.message,
    locationQuery: options.locationQuery,
    radiusMeters: options.radiusMeters,
    limit: options.limit,
    useLlm: options.useLlm,
  });
  console.log(answer);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Concierge selhal: ${message}`);
  process.exitCode = 1;
});
