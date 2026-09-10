# Hlasový concierge (GPT-Live) — kontrakt pro klienty

Server drží Live session u OpenAI (`gpt-live-1`) s Responses delegací na Futrumi
nástroje. Klient (iOS appka, web demo) mluví přímo s OpenAI přes WebRTC; náš
server jen session vytvoří, sleduje ji sidebandem a vykonává tooly.

Base URL: `https://mcp.futrumi.cz` (lokálně `http://localhost:8090`).

## Autorizace

Hlavička `x-live-access-code: <kód>` na všech `/live/session*` endpointech.
Kódy jsou v env `LIVE_ACCESS_CODES` (oddělené čárkou). Když je env prázdná
(lokální vývoj), gate se neuplatní. `GET /live/demo` a `GET /live/voices` jsou
vždy volné.

## `POST /live/session`

Headers: `content-type: application/json`, `x-live-access-code`.

```json
{
  "sdp": "v=0\r\no=- ...",
  "voice": "marin",
  "location": { "latitude": 49.1951, "longitude": 16.6068, "accuracy": 35 },
  "locale": "cs-CZ",
  "client": "ios",
  "screen": "Detail podniku Eggo Bistro (business_id abc123), sekce doporučení."
}
```

Povinné je jen `sdp` (SDP offer klienta, musí obsahovat audio track a data kanál
`oai-events`). `screen` je volitelný a projeví se jako developer message pro
hlasový model i jako součást instrukcí backendu.

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

Backend si obsah může vyžádat i sám nástrojem `get_screen_context`.

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

## Limity

- `LIVE_MAX_SESSIONS` (default 3) — souběžné session na proces, jinak 429.
- `LIVE_MAX_SESSION_SECONDS` (default 600) — po uplynutí server pošle
  `session.close`; klient dostane `session.closed`.
