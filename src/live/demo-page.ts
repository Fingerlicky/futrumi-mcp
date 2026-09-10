const VOICE_OPTIONS: ReadonlyArray<{ name: string; isNew: boolean }> = [
  { name: "alloy", isNew: false },
  { name: "ash", isNew: false },
  { name: "ballad", isNew: false },
  { name: "beacon", isNew: true },
  { name: "bossa", isNew: true },
  { name: "cedar", isNew: false },
  { name: "cinder", isNew: true },
  { name: "coral", isNew: false },
  { name: "delta", isNew: true },
  { name: "echo", isNew: false },
  { name: "gleam", isNew: true },
  { name: "marin", isNew: false },
  { name: "meridian", isNew: true },
  { name: "quartz", isNew: true },
  { name: "ripple", isNew: true },
  { name: "sage", isNew: false },
  { name: "shimmer", isNew: false },
  { name: "stone", isNew: true },
  { name: "tempo", isNew: true },
  { name: "verse", isNew: false },
  { name: "vesper", isNew: true },
  { name: "willow", isNew: true },
];

const voiceOptionsHtml = VOICE_OPTIONS.map(
  ({ name, isNew }) =>
    `<option value="${name}"${name === "marin" ? " selected" : ""}>${name}${isNew ? " *" : ""}</option>`,
).join("");

export const DEMO_PAGE = `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Futrumi hlasový concierge — demo</title>
<style>
  :root {
    --bg: #12100e;
    --panel: #1c1917;
    --panel-2: #262220;
    --line: #38312d;
    --text: #f5f1ec;
    --muted: #a49a91;
    --accent: #e8734a;
    --accent-soft: #3a231a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 16px;
  }
  main { max-width: 720px; margin: 0 auto; display: grid; gap: 16px; }
  h1 { font-size: 20px; margin: 0; }
  h1 span { color: var(--muted); font-weight: 400; font-size: 14px; display: block; margin-top: 2px; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 14px; }
  .controls { display: grid; gap: 10px; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  label { font-size: 13px; color: var(--muted); }
  select, input[type="text"], button {
    font: inherit; color: var(--text); background: var(--panel-2);
    border: 1px solid var(--line); border-radius: 10px; padding: 9px 12px;
  }
  input[type="text"] { flex: 1 1 200px; min-width: 0; }
  button { cursor: pointer; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #1a0d07; font-weight: 600; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  .checkbox { display: flex; gap: 8px; align-items: center; font-size: 13px; color: var(--text); }
  #status { font-size: 14px; color: var(--muted); min-height: 20px; }
  #status.live { color: var(--accent); }
  #chat { display: grid; gap: 8px; max-height: 46vh; overflow-y: auto; }
  .bubble { max-width: 82%; padding: 9px 13px; border-radius: 14px; white-space: pre-wrap; word-break: break-word; }
  .bubble.user { margin-left: auto; background: var(--accent-soft); border-bottom-right-radius: 4px; }
  .bubble.assistant { margin-right: auto; background: var(--panel-2); border-bottom-left-radius: 4px; }
  .bubble b { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-bottom: 3px; }
  #cards { display: grid; gap: 10px; }
  .card { border: 1px solid var(--line); border-radius: 12px; padding: 12px; background: var(--panel-2); }
  .card.primary { border-color: var(--accent); }
  .card.opened { box-shadow: 0 0 0 2px var(--accent); }
  .card .tag { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--accent); }
  .card h3 { margin: 3px 0 4px; font-size: 16px; }
  .card .expert { font-size: 13px; color: var(--muted); }
  .card .quote { font-size: 13px; font-style: italic; margin: 7px 0; }
  .card .reason { font-size: 13px; margin: 7px 0 9px; }
  .card a { color: var(--accent); text-decoration: none; font-weight: 600; font-size: 13px; }
  .card .say { font-size: 12px; color: var(--muted); margin-left: 10px; }
  footer { font-size: 13px; color: var(--muted); display: grid; gap: 8px; }
  pre { background: var(--panel-2); border: 1px solid var(--line); border-radius: 10px;
        padding: 10px; overflow: auto; max-height: 40vh; font-size: 12px; margin: 0; }
  summary { cursor: pointer; font-size: 13px; color: var(--muted); }
  .hint { font-size: 12px; color: var(--muted); }
  audio { width: 100%; margin-top: 10px; }
</style>
</head>
<body>
<main>
  <h1>Futrumi hlasový concierge<span>gpt-live-1 + Futrumi doporučení · lokální demo</span></h1>

  <section class="panel controls">
    <div class="row">
      <label for="voice">Hlas</label>
      <select id="voice">${voiceOptionsHtml}</select>
      <button id="start" class="primary">Začít hovor</button>
      <button id="stop" disabled>Ukončit</button>
    </div>
    <div class="row">
      <label class="checkbox"><input type="checkbox" id="useLocation" checked> použít mou polohu</label>
    </div>
    <div class="row">
      <label for="accessCode">Přístupový kód</label>
      <input type="text" id="accessCode" placeholder="přístupový kód (pokud ho server vyžaduje)" autocomplete="off">
    </div>
    <div class="row">
      <input type="text" id="placeHint" placeholder="nebo napiš místo (jen nápověda, co říct)">
    </div>
    <p class="hint">Hvězdička = nový hlas GPT-Live. Zkus: „Kam na dobrou kávu na Vinohradech?“ nebo „Co si dát na večeři v Karlíně?“</p>
    <div id="status">Připraveno.</div>
    <audio id="audio" autoplay controls></audio>
  </section>

  <section class="panel">
    <div id="chat"><p class="hint" id="chatEmpty">Přepis se objeví, až začneš mluvit.</p></div>
  </section>

  <section id="cards"></section>

  <footer class="panel">
    <div id="timer">Délka hovoru: 0:00</div>
    <div id="usage"></div>
    <details>
      <summary>Ukázat surové eventy</summary>
      <pre id="rawLog">(zatím nic)</pre>
    </details>
  </footer>
</main>

<script>
const els = {
  voice: document.getElementById("voice"),
  start: document.getElementById("start"),
  stop: document.getElementById("stop"),
  useLocation: document.getElementById("useLocation"),
  accessCode: document.getElementById("accessCode"),
  status: document.getElementById("status"),
  audio: document.getElementById("audio"),
  chat: document.getElementById("chat"),
  chatEmpty: document.getElementById("chatEmpty"),
  cards: document.getElementById("cards"),
  timer: document.getElementById("timer"),
  usage: document.getElementById("usage"),
  rawLog: document.getElementById("rawLog"),
};

const RATE_USD_PER_MINUTE = 0.05;

let peer = null;
let events = null;
let microphone = null;
let sessionId = null;
let ready = false;
let finalized = false;
let closeTimeout = null;
let timerHandle = null;
let startedAt = 0;
const rawEvents = [];
const openedCalls = new Set();
let lastShown = [];
let lastBubble = null;

const ACCESS_CODE_KEY = "futrumi.live.accessCode";

try {
  const stored = localStorage.getItem(ACCESS_CODE_KEY);
  if (stored) els.accessCode.value = stored;
} catch (error) {
  console.warn("localStorage unavailable", error);
}

els.accessCode.addEventListener("change", () => {
  try { localStorage.setItem(ACCESS_CODE_KEY, els.accessCode.value.trim()); }
  catch (error) { console.warn("localStorage write failed", error); }
});

function authHeaders() {
  const code = els.accessCode.value.trim();
  return code ? { "x-live-access-code": code } : {};
}

function setStatus(text, live) {
  els.status.textContent = text;
  els.status.classList.toggle("live", Boolean(live));
}

function logRaw(event) {
  rawEvents.push(event);
  if (rawEvents.length > 200) rawEvents.shift();
  els.rawLog.textContent = rawEvents.map((item) => JSON.stringify(item)).join("\\n");
}

function appendTranscript(side, delta) {
  if (els.chatEmpty) { els.chatEmpty.remove(); els.chatEmpty = null; }
  if (!lastBubble || lastBubble.dataset.side !== side) {
    lastBubble = document.createElement("div");
    lastBubble.className = "bubble " + side;
    lastBubble.dataset.side = side;
    const who = document.createElement("b");
    who.textContent = side === "user" ? "Ty" : "Futrumi";
    const body = document.createElement("span");
    lastBubble.append(who, body);
    els.chat.append(lastBubble);
  }
  lastBubble.lastChild.textContent += delta;
  els.chat.scrollTop = els.chat.scrollHeight;
}

function renderCards(shown) {
  lastShown = shown;
  els.cards.replaceChildren();
  shown.forEach((choice, index) => {
    const card = document.createElement("div");
    card.className = "card" + (index === 0 ? " primary" : "");
    card.dataset.businessId = choice.business_id;

    const tag = document.createElement("div");
    tag.className = "tag";
    tag.textContent = index === 0 ? "Hlavní volba" : "Záloha";
    card.append(tag);

    const title = document.createElement("h3");
    title.textContent = choice.name || choice.business_id;
    card.append(title);

    if (choice.expert) {
      const expert = document.createElement("div");
      expert.className = "expert";
      expert.textContent = "Doporučuje " + choice.expert;
      card.append(expert);
    }
    if (choice.quote) {
      const quote = document.createElement("div");
      quote.className = "quote";
      quote.textContent = "„" + choice.quote + "“";
      card.append(quote);
    }
    if (choice.reason) {
      const reason = document.createElement("div");
      reason.className = "reason";
      reason.textContent = choice.reason;
      card.append(reason);
    }

    const link = document.createElement("a");
    link.href = choice.deeplink;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Otevřít na futrumi.cz";
    const actions = document.createElement("div");
    actions.append(link);
    if (typeof choice.latitude === "number" && typeof choice.longitude === "number") {
      const map = document.createElement("a");
      map.href = "https://www.google.com/maps/search/?api=1&query=" + choice.latitude + "," + choice.longitude;
      map.target = "_blank";
      map.rel = "noopener";
      map.textContent = "Mapa";
      map.style.marginLeft = "10px";
      actions.append(map);
    }
    const say = document.createElement("span");
    say.className = "say";
    say.textContent = "nebo řekni „otevři to“";
    actions.append(say);
    card.append(actions);

    els.cards.append(card);
  });
}

async function fetchChoices() {
  if (!sessionId) return;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch("/live/session/" + encodeURIComponent(sessionId) + "/choices", {
        headers: authHeaders(),
      });
      if (response.ok) {
        const data = await response.json();
        if (data && data.primary) {
          renderCards([data.primary].concat(Array.isArray(data.backups) ? data.backups : []));
          return;
        }
      }
    } catch (error) {
      console.warn("choices fetch failed", error);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

function highlightAndOpen(businessId, callId) {
  if (openedCalls.has(callId)) return;
  openedCalls.add(callId);
  const card = els.cards.querySelector('[data-business-id="' + businessId + '"]');
  if (card) {
    card.classList.add("opened");
    window.open(card.querySelector("a").href, "_blank", "noopener");
    return;
  }
  window.open("https://futrumi.cz/business/" + businessId, "_blank", "noopener");
}

function openExpertProfile(expertId, callId) {
  if (openedCalls.has(callId)) return;
  openedCalls.add(callId);
  window.open("https://futrumi.cz/expert/" + expertId, "_blank", "noopener");
}

async function showOnMap(businessId, callId) {
  if (openedCalls.has(callId)) return;
  openedCalls.add(callId);
  const card = els.cards.querySelector('[data-business-id="' + businessId + '"]');
  if (card) card.classList.add("opened");
  let match = lastShown.find((item) => item.business_id === businessId);
  if (!match) {
    await fetchChoices();
    match = lastShown.find((item) => item.business_id === businessId);
  }
  if (match && typeof match.latitude === "number" && typeof match.longitude === "number") {
    window.open(
      "https://www.google.com/maps/search/?api=1&query=" + match.latitude + "," + match.longitude,
      "_blank",
      "noopener",
    );
    return;
  }
  window.open("https://futrumi.cz/business/" + businessId, "_blank", "noopener");
}

function handleFunctionCall(item) {
  if (!item || item.type !== "function_call") return;
  if (item.name === "present_choices") {
    void fetchChoices();
    return;
  }
  let args = {};
  try { args = JSON.parse(item.arguments || "{}"); } catch { args = {}; }
  if (item.name === "open_business" && args.business_id) {
    highlightAndOpen(args.business_id, item.call_id);
    return;
  }
  if (item.name === "open_expert" && args.expert_id) {
    openExpertProfile(args.expert_id, item.call_id);
    return;
  }
  if (item.name === "show_on_map" && args.business_id) {
    void showOnMap(args.business_id, item.call_id);
  }
}

function handleEvent(event) {
  logRaw(event);
  if (event.type === "session.started") {
    ready = true;
    sessionId = event.session.id;
    els.stop.disabled = false;
    setStatus("Mluv.", true);
    return;
  }
  if (event.type === "session.input_transcript.delta") return appendTranscript("user", event.delta);
  if (event.type === "session.output_transcript.delta") return appendTranscript("assistant", event.delta);
  if (event.type === "session.closed") {
    finalized = true;
    setStatus("Ukončeno: " + event.reason);
    showUsage(event.usage);
    cleanup();
    return;
  }
  if (event.type === "error") {
    setStatus("Chyba: " + (event.error && event.error.message ? event.error.message : "neznámá"));
    return;
  }
  if (event.type === "response.event" && event.event && event.event.type === "response.output_item.done") {
    handleFunctionCall(event.event.item);
  }
}

function showUsage(usage) {
  const seconds = usage && typeof usage.seconds === "number" ? usage.seconds : 0;
  const cost = (seconds / 60) * RATE_USD_PER_MINUTE;
  els.usage.textContent = "usage: " + JSON.stringify(usage, null, 2) + "\\nodhad ceny: $" + cost.toFixed(3);
  els.usage.style.whiteSpace = "pre-wrap";
}

function tickTimer() {
  const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(elapsed / 60);
  const seconds = String(elapsed % 60).padStart(2, "0");
  els.timer.textContent = "Délka hovoru: " + minutes + ":" + seconds;
}

function cleanup() {
  clearTimeout(closeTimeout);
  clearInterval(timerHandle);
  timerHandle = null;
  if (microphone) microphone.getTracks().forEach((track) => track.stop());
  microphone = null;
  if (events) events.close();
  events = null;
  if (peer) peer.close();
  peer = null;
  els.audio.srcObject = null;
  ready = false;
  sessionId = null;
  lastBubble = null;
  els.start.disabled = false;
  els.stop.disabled = true;
}

async function currentPosition() {
  if (!els.useLocation.checked || !navigator.geolocation) return undefined;
  setStatus("Zjišťuji polohu…");
  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 6000, maximumAge: 60000 });
    });
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : undefined,
    };
  } catch (error) {
    console.warn("geolocation refused", error);
    return undefined;
  }
}

async function waitForIce(connection) {
  if (connection.iceGatheringState === "complete") return;
  await new Promise((resolve) => {
    const timeout = setTimeout(finish, 2000);
    function finish() {
      clearTimeout(timeout);
      connection.removeEventListener("icegatheringstatechange", onState);
      resolve(undefined);
    }
    function onState() {
      if (connection.iceGatheringState === "complete") finish();
    }
    connection.addEventListener("icegatheringstatechange", onState);
    onState();
  });
}

els.start.addEventListener("click", async () => {
  els.start.disabled = true;
  finalized = false;
  openedCalls.clear();
  lastShown = [];
  els.cards.replaceChildren();
  els.usage.textContent = "";
  setStatus("Připojuji…");
  try {
    const location = await currentPosition();
    const connection = new RTCPeerConnection();
    peer = connection;
    connection.addEventListener("track", (event) => {
      els.audio.srcObject = new MediaStream([event.track]);
      els.audio.play().catch(() => setStatus("Klikni na play v přehrávači, aby bylo slyšet Futrumi.", true));
    });

    microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of microphone.getAudioTracks()) connection.addTrack(track, microphone);

    // Data channel must exist before the offer so it is negotiated in the SDP.
    events = connection.createDataChannel("oai-events");
    events.addEventListener("message", ({ data }) => {
      try { handleEvent(JSON.parse(data)); } catch (error) { console.warn("bad event", data, error); }
    });
    events.addEventListener("close", () => {
      if (!finalized) { setStatus("Odpojeno bez finálního usage."); cleanup(); }
    });

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    await waitForIce(connection);
    const sdp = connection.localDescription && connection.localDescription.sdp;
    if (!sdp) throw new Error("Chybí lokální SDP offer.");

    const response = await fetch("/live/session", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        sdp,
        voice: els.voice.value,
        locale: navigator.language,
        client: "web",
        ...(location ? { location } : {}),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((payload.error || "Chyba serveru") + (payload.detail ? " — " + payload.detail : ""));

    sessionId = payload.session.id;
    await connection.setRemoteDescription({ type: "answer", sdp: payload.transport.sdp });
    // The POST already started the session; sending session.start here would be an error.
    startedAt = Date.now();
    tickTimer();
    timerHandle = setInterval(tickTimer, 1000);
    setStatus("Připojeno, čekám na start…");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
    cleanup();
  }
});

els.stop.addEventListener("click", () => {
  if (!ready || !events || events.readyState !== "open") { cleanup(); return; }
  els.stop.disabled = true;
  setStatus("Ukončuji…");
  events.send(JSON.stringify({ type: "session.close" }));
  closeTimeout = setTimeout(() => {
    setStatus("Nepřišel session.closed, zavírám natvrdo.");
    cleanup();
  }, 15000);
});

window.addEventListener("beforeunload", () => {
  if (events && events.readyState === "open") events.send(JSON.stringify({ type: "session.close" }));
  cleanup();
});
</script>
</body>
</html>
`;
