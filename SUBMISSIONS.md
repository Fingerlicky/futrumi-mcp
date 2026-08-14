# ChatGPT plugin submission — Futrumi

Podklady pro submission Futrumi MCP serveru do **ChatGPT Plugins Directory** (portál
`platform.openai.com/plugins`, sdílený s Codexem). Stav k 14. 8. 2026.

Terminologie 2026: OpenAI už neříká „app", ale **plugin** — jeden plugin obsahuje MCP server,
skills, nebo obojí. My submitujeme variantu **„With MCP" (MCP-only)**, bez skills a bez UI
komponent. Anonymní read-only MCP server je pro submission přípustný; UI není povinné.

Hodnoty polí jsou **anglicky** (directory je anglický), i když data samotná jsou česká.

## Předpoklady (blokují submit, musí udělat Honza)

1. **Identity verification** v `platform.openai.com/settings/organization/general` — individual
   (na jméno) nebo business (na Fingerlicky s.r.o.). Bez toho nejde vybrat Developer Identity.
   Pozn.: 3. 6. 2026 přišel na honza@futrumi.cz „OpenAI confirmation code" přes frompersona.com
   (Persona = ověřovací vendor OpenAI), takže část verifikace už možná proběhla — zkontrolovat,
   ne dělat znovu.
2. **Apps Management** write permission u účtu v org role settings.
3. Rozhodnout, pod jakým jménem publikovat: *Futrumi* vs *Fingerlicky s.r.o.* Doporučení:
   verifikovat business a publikovat jako **Futrumi** (shodně s Claude directory listingem).

## Info tab

| Pole | Hodnota |
|---|---|
| Plugin name | `Futrumi` |
| Short description | `Czech expert restaurant recommendations` |
| Long description | viz [connector-description.md](connector-description.md), sekce „Long description" — doplnit explicitní větu o rozsahu dat (níže) |
| Logo | `https://futrumi.cz/LogoWithoutBackground.svg` (200 OK, ověřeno) |
| Category | `Travel` — „Food & Drink" v OpenAI číselníku neexistuje stejně jako v Anthropicu, ověřit v portálu |
| Website URL | `https://futrumi.cz` |
| Privacy policy URL | `https://futrumi.cz/privacy` (200 OK; část B pokrývá MCP server) |
| Terms URL | `https://futrumi.cz/terms` (200 OK) |
| Support URL | `https://futrumi.cz/support` — HOTOVO 14. 8. (`futrumi-web`, commit `24570d6`) |

Support stránka je česká s anglickou sekcí (directory listing je anglický, takže tam dorazí i
lidé, co česky nečtou) a obsahuje inline analytics beacon jako ostatní statické stránky.

Rozsah dat je **doplněný do long description** v [connector-description.md](connector-description.md):
data pokrývají **pouze Českou republiku**, primárně Prahu a Brno. Ověřeno: dotaz na Vídeň
i Bratislavu vrací `0 z 0` s čitelnou zprávou, ne halucinaci — což je dobře, ale v popisu to musí
být předem, jinak je globální dostupnost zavádějící.

## MCP tab

| Pole | Hodnota |
|---|---|
| MCP server URL | `https://mcp.futrumi.cz/mcp` (universal, streamable HTTP) |
| Authentication | žádná — anonymní read-only. Demo credentials tedy N/A |
| Demo account | N/A (bez auth) |
| Content security policy | N/A bez UI komponent, ověřit, jestli portál pole nevynucuje |
| Domain verification | **hostovat token na `https://futrumi.cz/.well-known/openai-apps-challenge`** |

Domain verification je jediný zbývající technický krok a je snadný: `.well-known` už v allow-listu
`build.mjs` **je** (celá složka se kopíruje rekurzivně), takže stačí přidat soubor s tokenem.
Mechanismus je ověřený — `/.well-known/apple-app-site-association` vrací 200. Token se získá až
při vytvoření pluginu v portálu, takže pořadí je: vytvořit plugin → opsat token → přidat
`.well-known/openai-apps-challenge` → push do `main` (purge workflow doběhne sám) → ověřit 200 →
dokončit verifikaci v portálu.

Pozn.: `main` ve `futrumi-web` drží jiný worktree (`futrumi-web-expert-invite`), takže se do něj
nedá jen tak přepnout. Cesta, která funguje: vlastní worktree z `origin/main` a `git push origin
HEAD:main`.

### Nástroje a anotace

Všech 6 nástrojů má ověřeně `readOnlyHint: true` a `openWorldHint: false` (`tools/list` na
produkci, 14. 8.). Chybné nebo chybějící action labels jsou podle guidelines *„a common cause of
rejection"*, takže tohle je splněné a nemá se na to sahat.

| Tool | readOnlyHint | Účel |
|---|---|---|
| `search_recommendations` | ✓ | tipy podle kategorie/nálady kolem místa |
| `find_recommendations_near` | ✓ | geo výpis podniků podle vzdálenosti |
| `get_recommendation` | ✓ | plný text jednoho doporučení |
| `get_business` | ✓ | profil podniku se všemi doporučeními |
| `get_expert` | ✓ | bio experta a jeho tipy |
| `list_experts` | ✓ | adresář expertů |

## Testing tab — 5 pozitivních případů

Všechny výstupy níže jsou **reálně ověřené proti produkci 14. 8. 2026**, ne vymyšlené.

1. **Prompt:** „Najdi mi vinný bar na rande na Vinohradech."
   **Tool:** `search_recommendations(query="vinný bar na rande", locationQuery="Praha Vinohrady")`
   **Výsledek:** 5 tipů ze 120 kandidátů — Café Bar Pilotů (955 m, citace Daniela Juráše
   „Jeden z nejlepších koktejlových barů v Praze"), Aprés bar, Bukowski's Bar, BeerGeek Bar,
   Střecha Radost. Každý s citací experta, adresou, otevírací dobou a deep linkem.

2. **Prompt:** „Co dobrého je kolem centra Brna?"
   **Tool:** `find_recommendations_near(locationQuery="Brno-střed")`
   **Výsledek:** 5 podniků ze 74, řazeno podle vzdálenosti — Sorry (89 m), Ramen Brno (123 m,
   7 expertů), Bonjour Vietnam (211 m, 9 expertů), Klásek, FATFUCK smash burgers.

3. **Prompt:** „Řekni mi víc o Ramen Brno."
   **Tool:** `get_business(business_id="f7a06f37-cbe5-4dab-afc1-5626eae10030")`
   **Výsledek:** adresa Václavská 16, otevírací doba, web/menu/mapa/IG/FB/telefon, 5 fotek,
   3 featured citace a 7 expertních doporučení včetně `rec id` pro follow-up.

4. **Prompt:** „Kde má dobré pho v Praze 7?"
   **Tool:** `search_recommendations(query="vietnamská pho", locationQuery="Praha 7")`
   **Výsledek:** Tràng An (765 m) s citací Marka Jeliče „Nejlepší Phở, stále stejné jako
   15 let zpátky" a doporučeným jídlem Phở.

5. **Prompt:** „Kdo je Adam Huml a co doporučuje?"
   **Tool:** `list_experts` → `get_expert(expert_id="0dce1cc6-dc70-4743-9207-1fdeb9bd3dec")`
   **Výsledek:** 62 expertů v adresáři; Huml má 78 doporučení, vrací se bio a tipy
   (Pivní Ráj Olomouc, Café Bar Pilotů, poco.) s business ID.

## Testing tab — 3 negativní případy

1. **Prompt:** „Najdi mi restauraci ve Vídni."
   **Očekávané chování:** server vrátí `0 z 0 kandidátů` a text „Žádná doporučení nenalezena";
   model musí říct, že Futrumi pokrývá jen Česko, a **nesmí** doplnit tipy z vlastních znalostí.
   **Ověřeno:** dotaz na Vienna Austria i Bratislava vrací prázdno s čitelnou zprávou.
   **Důvod:** data jsou výhradně česká, mimo ČR neexistuje pokrytí.

2. **Prompt:** „Rezervuj mi stůl pro čtyři v Ramen Brno na dnes na sedm."
   **Očekávané chování:** odmítnutí — plugin je celý read-only, žádný nástroj neumí zapisovat
   ani rezervovat. Model může nabídnout telefon a web podniku z `get_business`.
   **Důvod:** všech 6 nástrojů má `readOnlyHint: true`, žádná write operace neexistuje.

3. **Prompt:** „Dej mi telefon a domácí adresu experta Adama Humla."
   **Očekávané chování:** odmítnutí — nástroje vrací u experta jen jméno, bio, foto a jeho
   doporučení. Kontaktní údaje se vrací pouze u **podniků** (veřejné firemní kontakty), nikdy
   u fyzických osob.
   **Důvod:** ochrana osobních údajů; expert souhlasil se zveřejněním tipů, ne kontaktů.

## Prompts tab — starter prompts

- „Kam na dobrou kávu v Karlíně?"
- „Najdi mi vinný bar na rande na Vinohradech."
- „Co doporučují experti v Brně?"
- „Kde má v Praze nejlepší ramen?"
- „Co doporučuje Michal Daněk?"

Anglické varianty pro neceské uživatele („Where should I eat in Prague tonight?") mají smysl —
citace se vrací v češtině a model si je přeloží, ale doporučení zůstane autentické.

## Global tab — dostupnost

Doporučení: **nechat globálně dostupné**, ne jen CZ. Data jsou česká, ale hlavní publikum navíc
tvoří lidé plánující cestu do Prahy — a `ChatGPT-User` fetche na futrumi.cz (1 → 256/den mezi
7. a 11. 8.) ukazují, že poptávka přes ChatGPT už existuje. Podmínka: rozsah dat musí být
explicitně v popisu, jinak je globální dostupnost zavádějící.

## Submit tab — release notes

> Initial submission. Read-only MCP server exposing published expert recommendations for Czech
> restaurants, cafés and bars — the same data as the Futrumi iOS app. Six tools, no auth,
> no UI components. Data coverage is Czechia only (primarily Prague and Brno).

## Známá rizika před submitem

- **Kategorie.** Stejná past jako u Anthropicu: „Food & Drink" pravděpodobně v číselníku není.
  Nevymýšlet, vybrat z nabídky (nejblíž `Travel`), jinak se to bude opravovat mailem měsíc.
- **Semantický ranking měl dvě ověřené kolize — OPRAVENO 14. 8.** (diagnostikováno lokálním
  skórováním, ne odhadem — `src/semantic-search.ts` je ruční lexikon, ne embeddingy):
  1. České **„o něm"** se po odstranění diakritiky rovná `nem` (vietnamský závitek) v konceptu
     `vietnamese`. Proto u dotazu „vietnamská pho / Praha 7" vyskočila francouzská Le Terroir —
     v jejím popisu je „vůbec se o něm nemluví". Zúženo bisekcí na jediné slovo.
  2. Koncept `wine-date` má term `vino`, který **prefixem matchuje „Vinohradská"** — takže dotaz
     „vinárna" vytáhne pekárnu jen podle adresy. Ověřeno A/B: stejná pekárna na Kodaňské neskóruje.
  Společná příčina: koncepty se skórovaly proti **všem** polím včetně adresy a jména experta, a
  krátké termy prefixují. Oprava zavádí `FieldKind`: `food` (jídla, název, typ podniku — cokoli
  projde), `prose` (citace, popis — jen termy od 4 znaků) a `meta` (adresa, jméno experta — koncepty
  nikdy). Přímé matche na slova z dotazu zůstávají na všech polích, takže hledání podle ulice nebo
  experta funguje dál. Ověřeno na produkčních datech: „pho / Praha" 3 → 2 podniky (vypadl
  Le Terroir), „vinárna / Vinohrady" 26 → 25 (vypadl **APETIT**, vývařovna na Vinohradské 106),
  „kavárna / Vinohrady" 20 → 20 bez změny. Plus 10 unit probe testů.
  Pozn.: BeerGeek Bar u dotazu „vinný bar na rande" **není** ukázka téhle vady — matchnul
  legitimně na slovo „bar" v názvu. Co oprava vědomě neřeší: lexikon konceptu `wine-date`
  obsahuje `bar`, `tapas` i `koktejl`, takže dotaz „vinárna" pořád vrací koktejlové bary. To je
  volba lexikonu, ne kolize — na přesnější rozlišení by byly potřeba embeddingy.
- **Doporučení bez textu.** ~6 % publikovaných doporučení nemá citaci ani popis. Prázdné
  blockquotes opraveny 14. 8. (commit `b613744`), ale u takového tipu se vrací jen jméno
  experta — recenzent to může vnímat jako prázdný obsah. Pokud to vyskočí v reviewu, řešení je
  takové doporučení z výstupu vypustit úplně, ne dopisovat text.
- **Nezaměňovat s Anthropic submissionem.** Ten je hotový a živý (community connector), kategorie
  se pořád řeší mailem. Stav viz paměť `project_mcp_directory_submission`.

## Pořadí kroků

1. Honza: ověřit/dokončit identity verification + Apps Management permission
2. Přidat `/support` stránku do `futrumi-web` (blocker Info tabu)
3. Doplnit rozsah dat do long description
4. Vytvořit plugin v portálu → získat token pro domain verification
5. Přidat `.well-known/openai-apps-challenge` + zápis do `build.mjs` allow-listu → push → ověřit 200
6. Vyplnit taby podle tohoto dokumentu
7. Submit (**vždy až po Honzově explicitním potvrzení** — submit obsahuje policy attestations)
8. Po approvalu si publikaci načasovat sám, approval ≠ publikace
