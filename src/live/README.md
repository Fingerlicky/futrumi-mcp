# Hlasový concierge — kontrakt pro klienty

Dva providery za jedním API:

| Provider | Model | Transport | Kdo vykonává tooly |
|---|---|---|---|
| `openai` (default) | `gpt-live-1` + Responses delegace | WebRTC | server přes sideband |
| `gemini` | `gemini-3.8-live` | WebSocket přímo z klienta | server přes relay endpoint |

U OpenAI mluví klient přímo s OpenAI přes WebRTC; náš server session vytvoří,
sleduje ji sidebandem a vykonává tooly. U Gemini se klient připojuje přímo na
Gemini WebSocket s **ephemeral tokenem** a tool cally, které mu přijdou,
přeposílá na `POST /live/session/{id}/tool`. V obou případech zůstávají data
i instrukce na serveru — klient je nikdy nevidí.

Base URL: `https://mcp.futrumi.cz` (lokálně `http://localhost:8090`).

## Autorizace

Hlavička `x-live-access-code: <kód>` na všech `/live/session*` endpointech
(včetně `/tool`). Kódy jsou v env `LIVE_ACCESS_CODES` (oddělené čárkou). Když je
env prázdná (lokální vývoj), gate se neuplatní. `GET /live/demo` a
`GET /live/voices` jsou vždy volné.

`GET /live/voices` vrací hlasy obou providerů a jestli je provider nakonfigurovaný:

```json
{
  "voices": ["alloy", "…"],
  "sessions": 0,
  "providers": {
    "openai": { "available": true, "voices": ["…"] },
    "gemini": { "available": false, "model": "gemini-3.8-live",
                "voices": ["Aoede", "…"], "default": "Kore" }
  }
}
```

`GET /live/voices?provider=gemini` vrátí rovnou jen gemini větev.

## `POST /live/session`

Headers: `content-type: application/json`, `x-live-access-code`.

```json
{
  "provider": "openai",
  "sdp": "v=0\r\no=- ...",
  "voice": "marin",
  "location": { "latitude": 49.1951, "longitude": 16.6068, "accuracy": 35 },
  "locale": "cs-CZ",
  "client": "ios",
  "screen": "Detail podniku Eggo Bistro (business_id abc123), sekce doporučení."
}
```

`provider` je volitelný, default `openai`. Pro `openai` je povinné `sdp` (SDP
offer klienta, musí obsahovat audio track a data kanál `oai-events`); pro
`gemini` se `sdp` neposílá. `screen` je volitelný a projeví se jako developer
message pro hlasový model i jako součást instrukcí backendu.

Odpovědi:

| Status | Tělo |
|---|---|
| 201 | `{ "session": { "id": "…" }, "transport": { "type": "webrtc", "sdp": "…" } }` |
| 400 | `{ "error": "Invalid request body.", "detail": "…" }` nebo detail chyby z OpenAI |
| 401 | `{ "error": "invalid_access_code" }` |
| 429 | `{ "error": "Too many concurrent sessions.", "detail": "…" }` |
| 503 | `{ "error": "OPENAI_API_KEY is not set on the server." }` |

Klient pak nastaví `transport.sdp` jako remote description. `session.start`
neposílá — session už běží.

### Větev `provider: "gemini"`

Request je stejný, jen bez `sdp` a s `voice` z Gemini sady
(`Aoede`, `Charon`, `Fenrir`, `Kore`, `Leda`, `Orus`, `Puck`, `Zephyr`;
default `Kore`, neznámý hlas spadne na default).

Odpověď 201:

```json
{
  "session": { "id": "0f0a…-uuid", "provider": "gemini" },
  "gemini": {
    "token": "auth_tokens/…",
    "model": "gemini-3.8-live",
    "wsUrl": "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=auth_tokens/…",
    "voice": "Kore",
    "expiresAt": "2026-09-16T20:10:00.000Z",
    "newSessionExpiresAt": "2026-09-16T20:01:00.000Z"
  }
}
```

- `session.id` je **naše** UUID, ne Gemini session id. Používá se ve všech
  ostatních `/live/session/{id}/…` endpointech.
- `token` je ephemeral token, ne náš API klíč. Je jednorázový (`uses: 1`),
  socket se s ním musí otevřít do `newSessionExpiresAt` (60 s) a session končí
  nejpozději v `expiresAt` (= `LIVE_MAX_SESSION_SECONDS`).
- Token má zamčený model, `responseModalities: [AUDIO]`, system instruction,
  seznam toolů i hlas. Cokoli z toho klient v `setup` pošle, server ignoruje —
  a instrukce ani nevidí.
- 503 `{ "error": "GEMINI_API_KEY is not set on the server." }`, když klíč chybí.

Připojení (klient):

1. otevři WebSocket na `wsUrl` (hotový, není potřeba skládat),
2. pošli `{"setup":{"model":"models/gemini-3.8-live"}}` — `config` nech prázdný,
3. počkej na `{"setupComplete":{}}`,
4. audio nahoru: `{"realtimeInput":{"audio":{"data":"<base64 PCM16 16 kHz mono>","mimeType":"audio/pcm;rate=16000"}}}`,
5. audio dolů: `serverContent.modelTurn.parts[].inlineData.data` = base64 PCM16 **24 kHz**,
6. přepisy: `serverContent.inputTranscription.text` a `serverContent.outputTranscription.text`,
7. barge-in: na `serverContent.interrupted` zahoď frontu přehrávání,
8. tool cally: `toolCall.functionCalls[] = { id, name, args }` → viz relay níže.

VAD a barge-in jedou na defaultech (`automaticActivityDetection`), klient nic
nenastavuje.

Oficiální SDK `@google/genai` skládá URL se dvěma lomítky (`…com//ws/…`); obě
varianty fungují, my vracíme kanonickou s jedním.

### Úvodní pozdrav

Hlas začíná hovor sám, klient o to nemusí žádat. Statické `instructions` na to
nestačí (naměřeno: model mlčí, dokud uživatel nepromluví), takže server po
prvním sidebandovém eventu (`session.started`) pošle
`session.commentary.append` s `delegation_id: null` a textem pozdravu, který
model parafrázuje. `session.instructions.append` funguje taky, ale k první
slyšitelné odpovědi je o ~2 s pomalejší.

Pozdrav je vázaný na tok médií: dokud WebRTC spojení klienta nestojí, model
nemluví a append skončí chybou `context_injection_incomplete`. V logu serveru
jsou k tomu řádky `greeting requested`, `greeting append acked` a
`greeting spoken (+Xms)`.

## `POST /live/session/{id}/context`

Aktuální obrazovka uživatele. Volej při vstupu na detail podniku/experta a při
každé podstatné změně.

```json
{ "screen": "Detail podniku Eggo Bistro (business_id abc123)." }
```

- 204 — přijato (server to modelu předá přes `session.update`, při chybě přes
  `session.thinking.append`)
- 400 — prázdný nebo delší než 600 znaků
- 404 — neznámá session

Backend si obsah může vyžádat i sám nástrojem `get_screen_context`. Funguje pro
oba providery; u Gemini se jen uloží, model si ho vytáhne toolem.

## `POST /live/session/{id}/tool`

Relay tool cally. Gemini posílá tool cally klientovi, ne nám — klient je tedy
přepošle sem, server je vykoná nad stavem session a vrátí výsledek, který klient
pošle zpátky do Gemini jako `toolResponse`.

Request:

```json
{ "name": "top_businesses", "args": { "locationQuery": "Brno", "limit": 5 } }
```

`args` je objekt (Gemini `functionCall.args`), přijímá se i JSON string kvůli
OpenAI tvaru. Odpověď:

```json
{ "result": { "header": "Nejdoporučovanější podniky…", "businesses": [ … ] } }
```

- 200 — i když tool selhal; chyba přijde jako `{ "result": { "error": "…" } }`,
  aby měl model co říct. Výsledek nad 12 000 znaků se nahradí hláškou, ať se
  session nezahltí.
- 400 — nevalidní tělo nebo tool, který není v seznamu
- 401 — chybí/nesedí `x-live-access-code`
- 404 — neznámá session

Zpátky do Gemini:

```json
{ "toolResponse": { "functionResponses": [
  { "id": "<functionCall.id>", "name": "top_businesses", "response": { "output": { … } } }
] } }
```

U `present_choices`, `open_business`, `open_expert` a `show_on_map` musí klient
kromě přeposlání výsledku udělat i akci v UI — server odpoví
`{ ok: true, handled_by: "app", … }` hned, aby hlas nečekal na obrazovku.

## `GET /live/session/{id}/choices`

Karty, které backend naposledy vybral přes `present_choices`.

```json
{
  "primary": {
    "business_id": "abc123",
    "name": "Eggo Bistro",
    "expert": "Marko Jelič",
    "quote": "Nejlepší snídaně v Brně.",
    "deeplink": "https://futrumi.cz/business/abc123",
    "reason": "Snídaně do 11:00, blízko Lužánek.",
    "latitude": 49.2038,
    "longitude": 16.6089
  },
  "backups": [],
  "presented_at": "2026-09-11T08:12:44.512Z"
}
```

- 404 — session neexistuje, nebo ještě žádné karty nepadly
- `latitude`/`longitude` chybí, když je podnik nemá v datech

## Data kanál (`oai-events`)

Klient **posílá** jen:

```json
{ "type": "session.close" }
```

Klient **čte**:

| Event | K čemu |
|---|---|
| `session.started` | `session.id`, od teď je možné mluvit |
| `session.input_transcript.delta` | `delta` — přepis uživatele |
| `session.output_transcript.delta` | `delta` — přepis asistenta |
| `response.event` | obálka; zajímá nás vnořený `response.output_item.done` s `item.type == "function_call"` |
| `session.closed` | `{ reason, usage }` |
| `error` | `{ error: { code, message, type } }` |

App tooly z `function_call` (`item.name`, `item.arguments` je JSON string):

| `name` | `arguments` | Reakce UI |
|---|---|---|
| `present_choices` | `{ primary, backups }` | stáhnout `GET /live/session/{id}/choices` a vykreslit karty |
| `open_business` | `{ business_id }` | otevřít detail podniku |
| `open_expert` | `{ expert_id }` | otevřít profil experta |
| `show_on_map` | `{ business_id }` | ukázat podnik na mapě (souřadnice jsou v `choices`) |

Server na app tooly odpovídá modelu hned (`{ ok: true, handled_by: "app", … }`),
takže hlas nečeká na UI.

## Nástroje

Oba providery vidí stejný seznam (`LIVE_TOOLS` v `tools.ts`). Pro Gemini se
překládá na `functionDeclarations` v `gemini-tools.ts` — typy jdou na velká
písmena (`OBJECT`, `STRING`), `minItems`/`maxItems` na stringy a
`additionalProperties` se zahazuje, protože Gemini ho odmítá.

Data tooly: `search_recommendations`, `find_recommendations_near`,
`top_businesses`, `get_business`, `get_recommendation`, `get_expert`,
`list_experts`. Session tool: `get_screen_context`. App tooly:
`present_choices`, `open_business`, `open_expert`, `show_on_map`. Klientský
tool: `find_food_along_route`.

### `find_food_along_route` (počítá klient)

Jídlo po cestě autem. Trasu a zajížďky počítá appka přes Apple Mapy (na
zařízení zdarma, na serveru nedostupné); server jen čeká na výsledek a podniky
z `stops` si zapamatuje, aby na ně šlo `present_choices` a `open_business`.

Argumenty: `destination` (povinné), `origin` (vynechat = aktuální poloha),
`via`, `avoid_tolls` (bez dálniční známky), `departure_time` (ISO 8601),
`stop_position` (`middle` | `early` | `late` | `anywhere`), `kind`
(`food` | `coffee` | `any`), `max_detour_minutes`.

Doručení výsledku:

- **OpenAI** — klient uvidí `function_call` v datovém kanálu (`item.call_id`),
  spočítá výsledek a pošle `POST /live/session/{id}/client-result`
  `{ "call_id": "…", "result": { … } }` → 204. Sideband čeká max. 30 s, pak
  modelu vrátí chybu. Výsledek, který dorazí dřív než sideband, se neztratí.
- **Gemini** — klient ho nerelayuje hned, ale až s výsledkem:
  `POST /live/session/{id}/tool` `{ "name", "args", "result": { … } }`.

Tvar výsledku (čte ho instrukce backendu):

```json
{
  "origin": "Tvoje poloha", "destination": "Vimperk", "travel_minutes": 179,
  "distance_km": 271, "avoids_highways": false, "vignette_known": false,
  "departure_time": "08:00",
  "stops": [
    { "business_id": "…", "name": "Triko Tábor", "type": "Bistro", "experts_count": 6,
      "detour_minutes": 15, "minutes_from_start": 108, "share_of_route_percent": 60,
      "arrival_time": "09:55", "open_at_arrival": true, "latitude": 49.41, "longitude": 14.66 }
  ]
}
```

Chyba: `{ "error": "…", "stops": [] }`. Apple Mapy české dálnice na známku
nepovažují za zpoplatněné, takže „bez známky“ appka řeší vyhnutím se dálnicím.

### `top_businesses`

Žebříček podniků podle počtu expertů, kteří je doporučují
(`expertsWithRecommendationCount`), sestupně, při shodě blíž = dřív.

```json
{ "locationQuery": "Jihomoravský kraj", "businessType": "kavárna", "limit": 10 }
```

Lokalita se řeší stejně jako u `find_recommendations_near` (souřadnice nebo
Nominatim). Default radius je 5 km pro bod a větší podle typu místa pro města a
kraje; strop je 50 km. **Radius je kruh kolem středu, tedy okolí, ne přesná
hranice města nebo kraje** — instrukce to modelu říkají, ať to nevydává za
katastr. Kandidáti se stránkují do stropu `TOP_BUSINESSES_CEILING` (600), protože
backend řadí podle vzdálenosti a nejdoporučovanější podnik skoro nikdy není na
první stránce.

## Limity

- `LIVE_MAX_SESSIONS` (default 3) — souběžné session na proces napříč oběma
  providery, jinak 429.
- `LIVE_MAX_SESSION_SECONDS` (default 600) — u OpenAI po uplynutí server pošle
  `session.close`; u Gemini je to `expireTime` tokenu, takže spojení ukončí
  Google. Záznam session na serveru žije ještě 120 s navíc, aby doběhl poslední
  tool call a stažení karet.
