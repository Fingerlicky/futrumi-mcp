import assert from "node:assert/strict";
import test from "node:test";

import { dailyMenu, offerStatus, queryStems, searchMenu, type MenuData } from "../src/services/menu-data.js";

const DATA: MenuData = {
  generatedOn: "2026-10-01",
  city: "Brno",
  businesses: [
    {
      id: "lokal",
      name: "Lokál U Caipla",
      location: { latitude: 49.196, longitude: 16.609 },
      menu: {
        extractedAt: "2026-09-30",
        sections: [{ name: "Hlavní jídla", items: [{ name: "Svíčková na smetaně, houskový knedlík", price: 245 }] }],
      },
      offers: [
        { title: "Polední menu 1. 10.", validity: "daily", validFrom: "2026-10-01", validTo: "2026-10-01",
          postedOn: "2026-10-01", channel: "facebook", items: [{ name: "Kulajda", price: 69 }] },
        { title: "Polední menu 28. 9.", validity: "daily", validFrom: "2026-09-28", validTo: "2026-09-28",
          channel: "facebook", items: [{ name: "Svíčková omáčka z minulého týdne", price: 159 }] },
      ],
    },
    {
      id: "daleko",
      name: "Hospoda za městem",
      location: { latitude: 49.3, longitude: 16.8 },
      menu: { sections: [{ items: [{ name: "Svíčková", price: 199 }] }] },
      offers: [],
    },
  ],
};

test("česky skloněný dotaz najde jídlo v 1. pádě", () => {
  const result = searchMenu(DATA, { query: "kde si dám svíčkovou", today: "2026-10-01" });
  assert.deepEqual(result.hits.map((h) => h.business_id).sort(), ["daleko", "lokal"]);
  assert.equal(result.hits.find((h) => h.business_id === "lokal")?.price, 245);
});

test("prošlé denní menu se nenabízí", () => {
  const result = searchMenu(DATA, { query: "svíčková", today: "2026-10-01" });
  assert.ok(!result.hits.some((h) => h.item.includes("minulého týdne")));
});

test("bližší podnik je první a radius vyřadí vzdálený", () => {
  const brno = { latitude: 49.195, longitude: 16.607 };
  const all = searchMenu(DATA, { query: "svíčková", location: brno, today: "2026-10-01" });
  assert.equal(all.hits[0].business_id, "lokal");
  const near = searchMenu(DATA, { query: "svíčková", location: brno, radiusMeters: 2000, today: "2026-10-01" });
  assert.deepEqual(near.hits.map((h) => h.business_id), ["lokal"]);
});

test("dnešní denní menu vrátí jen platné nabídky", () => {
  const menu = dailyMenu(DATA, "lokal", "2026-10-01");
  assert.equal(menu?.offers.length, 1);
  assert.equal(menu?.offers[0].status, "platí dnes");
  assert.equal(menu?.offers[0].items[0].name, "Kulajda");
});

test("neznámý podnik vrací null místo vymyšleného menu", () => {
  assert.equal(dailyMenu(DATA, "neexistuje", "2026-10-01"), null);
});

test("výplňová slova se z dotazu vyřadí", () => {
  assert.deepEqual(queryStems("Kde si můžu dát smažený sýr?"), ["smaz", "syr"]);
});

test("denní nabídka bez konce platnosti platí jen v den zveřejnění", () => {
  assert.equal(offerStatus({ validity: "daily", validFrom: "2026-10-01", items: [] }, "2026-10-01"), "today");
  assert.equal(offerStatus({ validity: "daily", validFrom: "2026-09-30", items: [] }, "2026-10-01"), "stale");
});

test("stejné jídlo z Instagramu i Facebooku se vrátí jednou", () => {
  const data: MenuData = {
    generatedOn: "2026-10-01",
    city: "Brno",
    businesses: [{
      id: "ramen", name: "Ramen Brno", menu: { sections: [] },
      offers: [
        { title: "Novinka", channel: "instagram", freshness: "current", items: [{ name: "Miso ramen" }] },
        { title: "Novinka", channel: "facebook", freshness: "current", items: [{ name: "Miso ramen" }] },
      ],
    }],
  };
  assert.equal(searchMenu(data, { query: "ramen", today: "2026-10-01" }).hits.length, 1);
});
