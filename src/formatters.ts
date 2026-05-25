import type {
  BusinessDetail,
  BusinessListItem,
  ExpertDetail,
  ExpertListItem,
  RecommendationDetail,
  RecommendationListItem,
} from "./types.js";

const DEEPLINK_BASE = process.env.FUTRUMI_DEEPLINK_BASE?.trim() || "https://futrumi.cz";

export const businessDeeplink = (id: string) => `${DEEPLINK_BASE}/business/${id}`;
export const expertDeeplink = (id: string) => `${DEEPLINK_BASE}/expert/${id}`;

const formatDistance = (meters: number): string => {
  if (!Number.isFinite(meters) || meters <= 0) return "";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
};

const formatOpeningHours = (hours: string | null | undefined): string => {
  if (!hours) return "";
  const trimmed = hours.trim();
  return trimmed.length > 0 ? `Otevírací doba: ${trimmed}` : "";
};

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

export function formatRecommendationCard(rec: RecommendationListItem, index: number): string {
  const distance = formatDistance(rec.distance);
  const status = formatOpeningHours(rec.business.openingHours);
  const meta = [distance, status].filter(Boolean).join(" · ");
  const headline = `### ${index + 1}. **${rec.business.name}** — ${rec.business.primaryBusinessType.name}`;
  const quote = rec.strongQuote
    ? `> "${rec.strongQuote.trim()}" — **${rec.expert.name}**`
    : `> ${truncate(rec.description.trim(), 220)} — **${rec.expert.name}**`;
  const mealLine = rec.meals.length
    ? `Doporučená jídla: ${rec.meals.map((m) => m.name).join(", ")}`
    : "";

  return [
    headline,
    meta && `*${meta}*`,
    quote,
    `Adresa: ${rec.business.address}`,
    mealLine,
    `[Otevřít v appce](${businessDeeplink(rec.business.id)}) · id: \`${rec.business.id}\` · rec: \`${rec.id}\``,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatRecommendationList(
  recs: RecommendationListItem[],
  header: string,
): string {
  if (recs.length === 0) {
    return `## ${header}\n\nŽádná doporučení nenalezena. Zkus větší radius nebo jinou lokalitu.`;
  }
  const body = recs.map((r, i) => formatRecommendationCard(r, i)).join("\n\n");
  return `## ${header}\n\n${body}`;
}

export function formatBusinessCard(biz: BusinessListItem, index: number): string {
  const distance = formatDistance(biz.distance);
  const status = formatOpeningHours(biz.openingHours);
  const meta = [distance, status, `${biz.expertsWithRecommendationCount} expertů`].filter(Boolean).join(" · ");
  return [
    `### ${index + 1}. **${biz.name}** — ${biz.primaryBusinessType.name}`,
    meta && `*${meta}*`,
    biz.bio && truncate(biz.bio.trim(), 200),
    `Adresa: ${biz.address}`,
    `[Otevřít v appce](${businessDeeplink(biz.id)}) · id: \`${biz.id}\``,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatBusinessList(items: BusinessListItem[], header: string): string {
  if (items.length === 0) {
    return `## ${header}\n\nŽádné podniky nenalezeny. Zkus větší radius.`;
  }
  return `## ${header}\n\n${items.map((b, i) => formatBusinessCard(b, i)).join("\n\n")}`;
}

export function formatRecommendationDetail(rec: RecommendationDetail): string {
  const lines: string[] = [];
  lines.push(`# ${rec.business.name} — doporučuje ${rec.expert.name}`);
  lines.push(
    [
      rec.business.primaryBusinessType.name,
      formatOpeningHours(rec.business.openingHours),
    ]
      .filter(Boolean)
      .join(" · "),
  );
  lines.push("");
  lines.push(`**Adresa:** ${rec.business.address}`);
  if (rec.publishDate) lines.push(`**Publikováno:** ${new Date(rec.publishDate).toLocaleDateString("cs-CZ")}`);
  lines.push("");
  if (rec.strongQuote) lines.push(`> "${rec.strongQuote.trim()}"\n> — **${rec.expert.name}**`);
  lines.push("");
  lines.push(rec.description.trim());

  if (rec.meals.length) {
    lines.push("");
    lines.push(`## Doporučená jídla`);
    for (const meal of rec.meals) {
      lines.push(`- **${meal.name}** — ${meal.description.trim()}`);
    }
  }

  lines.push("");
  lines.push(`[Otevřít v appce](${businessDeeplink(rec.business.id)})`);
  lines.push(`Business id: \`${rec.business.id}\` · Expert id: \`${rec.expert.id}\``);

  return lines.join("\n");
}

export function formatBusinessDetail(biz: BusinessDetail): string {
  const lines: string[] = [];
  lines.push(`# ${biz.name}`);
  const meta = [
    biz.primaryBusinessType.name,
    formatOpeningHours(biz.openingHours),
    `${biz.expertsWithRecommendationCount} expertů doporučuje`,
  ]
    .filter(Boolean)
    .join(" · ");
  lines.push(`*${meta}*`);
  lines.push("");
  lines.push(`**Adresa:** ${biz.address}`);
  if (biz.bio) {
    lines.push("");
    lines.push(biz.bio.trim());
  }

  const links: string[] = [];
  if (biz.webUrl) links.push(`[Web](${biz.webUrl})`);
  if (biz.menuUrl) links.push(`[Menu](${biz.menuUrl})`);
  if (biz.googleMapsUrl) links.push(`[Mapa](${biz.googleMapsUrl})`);
  if (biz.instagramUrl) links.push(`[Instagram](${biz.instagramUrl})`);
  if (biz.facebookUrl) links.push(`[Facebook](${biz.facebookUrl})`);
  if (biz.phoneNumber) links.push(`tel: ${biz.phoneNumber}`);
  if (links.length) {
    lines.push("");
    lines.push(links.join(" · "));
  }

  if (biz.featuredQuotes.length) {
    lines.push("");
    lines.push(`## Co o podniku říkají experti`);
    for (const q of biz.featuredQuotes) {
      lines.push(`> "${q.text.trim()}"`);
    }
  }

  if (biz.recommendations.length) {
    lines.push("");
    lines.push(`## Expertní doporučení (${biz.recommendations.length})`);
    for (const rec of biz.recommendations) {
      const headline = rec.strongQuote
        ? `> "${rec.strongQuote.trim()}"`
        : `> ${truncate(rec.description.trim(), 180)}`;
      lines.push("");
      lines.push(`### ${rec.expert.name}`);
      lines.push(headline);
      if (rec.meals.length) {
        lines.push(`Doporučená jídla: ${rec.meals.map((m) => m.name).join(", ")}`);
      }
      lines.push(`rec id: \`${rec.id}\``);
    }
  }

  lines.push("");
  lines.push(`[Otevřít v appce](${businessDeeplink(biz.id)})`);

  return lines.join("\n");
}

export function formatExpertDetail(
  expert: ExpertDetail,
  recommendations: RecommendationListItem[],
): string {
  const lines: string[] = [];
  lines.push(`# ${expert.name}`);
  lines.push(`*${expert.recommendationCount} doporučení celkem*`);
  if (expert.bio) {
    lines.push("");
    lines.push(expert.bio.trim());
  }

  if (recommendations.length) {
    lines.push("");
    lines.push(`## Doporučení (${recommendations.length})`);
    for (const rec of recommendations) {
      lines.push("");
      lines.push(`### ${rec.business.name} — ${rec.business.primaryBusinessType.name}`);
      lines.push(`*${rec.business.address}*`);
      const quote = rec.strongQuote
        ? `> "${rec.strongQuote.trim()}"`
        : `> ${truncate(rec.description.trim(), 180)}`;
      lines.push(quote);
      if (rec.meals.length) {
        lines.push(`Doporučená jídla: ${rec.meals.map((m) => m.name).join(", ")}`);
      }
      lines.push(
        `[Otevřít v appce](${businessDeeplink(rec.business.id)}) · business id: \`${rec.business.id}\``,
      );
    }
  }

  lines.push("");
  lines.push(`[Profil v appce](${expertDeeplink(expert.id)})`);

  return lines.join("\n");
}

export function formatExpertList(experts: ExpertListItem[], total: number): string {
  if (experts.length === 0) {
    return `## Experti\n\nŽádní experti nenalezeni.`;
  }
  const lines: string[] = [];
  lines.push(`## Experti (${experts.length} z ${total})`);
  for (const e of experts) {
    lines.push("");
    lines.push(`### ${e.name} — ${e.recommendationCount} doporučení`);
    if (e.bio) lines.push(truncate(e.bio.trim(), 200));
    lines.push(`expert id: \`${e.id}\``);
  }
  return lines.join("\n");
}
