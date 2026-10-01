// Lístky a nabídky podniků pro hlasového Průvodce.
//
// Data nejsou v repu: repo je veřejné a vytěžené lístky jsou aktivum. Server
// si je stahuje z neveřejného Workeru (MENU_DATA_URL + MENU_DATA_TOKEN) a drží
// je v paměti; pro lokální vývoj stačí MENU_DATA_PATH. Zatím jen Brno.

import { readFile } from "node:fs/promises";

import type { Location } from "../types.js";

export interface MenuItem {
  name: string;
  description?: string;
  kind?: string;
  price?: number;
  priceNote?: string;
  variants?: { label?: string; price?: number }[];
  diet?: string[];
  allergens?: number[];
}

export interface MenuSection {
  name?: string;
  kind?: string;
  note?: string;
  items: MenuItem[];
}

export interface Offer {
  title?: string;
  validity?: string;
  validFrom?: string | null;
  validTo?: string | null;
  postedOn?: string | null;
  freshness?: string;
  channel?: string;
  items: MenuItem[];
}

export interface MenuBusiness {
  id: string;
  name: string;
  address?: string;
  type?: string;
  location?: Location | null;
  menu: { status?: string; extractedAt?: string; sources?: string[]; sections: MenuSection[] };
  offers: Offer[];
}

export interface MenuData {
  generatedOn: string;
  city: string;
  businesses: MenuBusiness[];
}

const REFRESH_MS = 60 * 60 * 1000;
let cache: { data: MenuData; loadedAt: number } | null = null;
let loading: Promise<MenuData | null> | null = null;

async function fetchData(): Promise<MenuData | null> {
  const path = process.env.MENU_DATA_PATH?.trim();
  if (path) return JSON.parse(await readFile(path, "utf8")) as MenuData;
  // Adresa tajná není (bez tokenu Worker vrací 401), tajný je jen token.
  const url = process.env.MENU_DATA_URL?.trim() || "https://futrumi-data.honza-8fd.workers.dev/brno_nabidky.json";
  const token = process.env.MENU_DATA_TOKEN?.trim();
  if (!url || !token) return null;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`menu data: HTTP ${response.status}`);
  return (await response.json()) as MenuData;
}

/** Data z paměti; jednou za hodinu se obnoví. Výpadek zdroje nechá platit stará data. */
export async function loadMenuData(now = Date.now()): Promise<MenuData | null> {
  if (cache && now - cache.loadedAt < REFRESH_MS) return cache.data;
  loading ??= fetchData()
    .then((data) => {
      if (data) cache = { data, loadedAt: now };
      return data ?? cache?.data ?? null;
    })
    .catch(() => cache?.data ?? null)
    .finally(() => {
      loading = null;
    });
  return loading;
}

export function setMenuDataForTests(data: MenuData | null): void {
  cache = data ? { data, loadedAt: Date.now() } : null;
}

export function fold(text: string | undefined): string {
  return (text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// „svíčkovou“ musí najít „Svíčková na smetaně“ a „knedlíky“ „knedlík“.
// Plné skloňování není potřeba: stačí porovnat začátek slova, který pádové
// koncovky nemění. Krátká slova („pho“, „pivo“) se porovnávají celá.
function stem(word: string): string {
  return word.length <= 4 ? word : word.slice(0, Math.max(4, word.length - 3));
}

// Výplňová slova z mluvené otázky („kde si můžu dát…“). Bez nich by dotaz
// vyžadoval i slovo „můžu“ v názvu jídla a nenašel nic.
const STOP_WORDS = new Set([
  "a", "s", "se", "na", "v", "ve", "z", "ze", "do", "k", "ke", "u", "o", "pro", "po", "kde", "kam", "dat", "dam",
  "si", "nejaky", "nejakou", "nejake", "nejaka", "mit", "maji", "muzu", "muzeme", "chci", "chtel", "chtela",
  "bych", "dneska", "dnes", "ted", "tady", "blizko", "okoli", "poblíz", "pobliz", "dobry", "dobrou", "dobre",
  "nejlepsi", "prosim", "nekde", "jidlo", "co",
]);

export function queryStems(query: string): string[] {
  return fold(query)
    .split(" ")
    .filter((w) => w && !STOP_WORDS.has(w))
    .map(stem);
}

function matches(stems: string[], text: string): boolean {
  const words = fold(text).split(" ");
  return stems.every((s) => words.some((w) => w.startsWith(s)));
}

export function distanceMeters(a: Location, b: Location): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}

/** Platí nabídka v daný den? Prošlé a bez data se vracejí jen jako nejisté. */
export function offerStatus(offer: Offer, today: string): "today" | "current" | "unknown" | "stale" {
  if (offer.validFrom && offer.validTo) {
    if (offer.validFrom <= today && today <= offer.validTo) return "today";
    return offer.validTo < today ? "stale" : "unknown";
  }
  if (offer.validFrom && !offer.validTo && offer.validity === "daily") {
    return offer.validFrom === today ? "today" : "stale";
  }
  if (offer.freshness === "stale") return "stale";
  if (offer.freshness === "current") return "current";
  return "unknown";
}

export interface MenuHit {
  business_id: string;
  business: string;
  address?: string;
  distance_m?: number;
  item: string;
  description?: string;
  price?: number;
  price_note?: string;
  variants?: { label?: string; price?: number }[];
  where: string;
  valid?: string;
  source_date?: string;
}

export interface SearchMenuInput {
  query: string;
  location?: Location;
  radiusMeters?: number;
  today: string;
  limit?: number;
}

export function searchMenu(data: MenuData, input: SearchMenuInput): { hits: MenuHit[]; total: number } {
  const stems = queryStems(input.query);
  if (!stems.length) return { hits: [], total: 0 };
  const hits: MenuHit[] = [];
  for (const b of data.businesses) {
    const distance = input.location && b.location ? distanceMeters(input.location, b.location) : undefined;
    if (input.radiusMeters && distance !== undefined && distance > input.radiusMeters) continue;
    const base = { business_id: b.id, business: b.name, address: b.address, distance_m: distance };
    for (const section of b.menu.sections) {
      for (const item of section.items) {
        if (!matches(stems, `${item.name} ${item.description ?? ""}`)) continue;
        hits.push({
          ...base, item: item.name, description: item.description, price: item.price,
          price_note: item.priceNote, variants: item.variants,
          where: `stálý lístek${section.name ? `, ${section.name}` : ""}`, source_date: b.menu.extractedAt,
        });
      }
    }
    for (const offer of b.offers) {
      const status = offerStatus(offer, input.today);
      if (status === "stale") continue;
      for (const item of offer.items) {
        if (!matches(stems, `${item.name} ${item.description ?? ""}`)) continue;
        hits.push({
          ...base, item: item.name, description: item.description, price: item.price,
          price_note: item.priceNote, where: `${offer.title ?? "nabídka"} (${offer.channel ?? "web"})`,
          valid: status === "today" ? "dnes" : status === "current" ? "aktuální" : "nejisté, ověřit",
          source_date: offer.postedOn ?? undefined,
        });
      }
    }
  }
  // Tentýž podnik dá stejné jídlo na Instagram i Facebook; Průvodce by ho
  // jinak četl dvakrát.
  const seen = new Set<string>();
  const unique = hits.filter((hit) => {
    const key = `${hit.business_id}|${fold(hit.item)}|${hit.price ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  hits.length = 0;
  hits.push(...unique);
  // Dnešní nabídky první, pak podle vzdálenosti.
  hits.sort((a, b) => Number(b.valid === "dnes") - Number(a.valid === "dnes")
    || (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity));
  return { hits: hits.slice(0, input.limit ?? 8), total: hits.length };
}

export interface DailyMenu {
  business_id: string;
  business: string;
  today: string;
  offers: { title?: string; status: string; channel?: string; posted_on?: string | null;
            items: { name: string; price?: number; price_note?: string; description?: string }[] }[];
  has_menu: boolean;
}

export function dailyMenu(data: MenuData, businessId: string, today: string): DailyMenu | null {
  const b = data.businesses.find((x) => x.id === businessId);
  if (!b) return null;
  const offers = b.offers
    .map((offer) => ({ offer, status: offerStatus(offer, today) }))
    .filter(({ status }) => status !== "stale")
    .sort((x, y) => Number(y.status === "today") - Number(x.status === "today"))
    .map(({ offer, status }) => ({
      title: offer.title, status: status === "today" ? "platí dnes" : status === "current" ? "aktuální" : "nejisté, ověřit",
      channel: offer.channel, posted_on: offer.postedOn,
      items: offer.items.map((i) => ({ name: i.name, price: i.price, price_note: i.priceNote, description: i.description })),
    }));
  return { business_id: b.id, business: b.name, today, offers, has_menu: b.menu.sections.length > 0 };
}

export function menuSummary(data: MenuData, businessId: string): Record<string, unknown> | null {
  const b = data.businesses.find((x) => x.id === businessId);
  if (!b) return null;
  return {
    sections: b.menu.sections.map((s) => ({ name: s.name, kind: s.kind, items: s.items.length })),
    items_total: b.menu.sections.reduce((n, s) => n + s.items.length, 0),
    extracted_at: b.menu.extractedAt,
    hint: "Na konkrétní jídla a ceny použij search_menu_items, na dnešní nabídku get_daily_menu.",
  };
}
