/**
 * Ferry DevTools Panel
 *
 * Displays captured dataLayer events and network hits with real-time
 * lint analysis. Uses FerryLint (from rules/index.js loaded before this).
 */

let port = null;
let recording = false;

const state = {
  events: [],       // dataLayer / gtag events (from injected hook)
  network: [],      // parsed /collect network hits
  findings: [],     // lint findings across all events
  sessionState: {}, // mutable state for cross-event rules
};

// ──────────────────────────────────────────────
// GA4 /collect URL parser
// ──────────────────────────────────────────────
function parseGa4Hit(url) {
  try {
    const u = new URL(url);
    const sp = u.searchParams;
    const event = sp.get("en");
    if (!event) return null;

    const params = {};
    for (const [k, v] of sp.entries()) {
      if (k.startsWith("ep.")) params[k.slice(3)] = v;
      if (k.startsWith("epn.")) params[k.slice(4)] = Number(v);
    }

    return {
      source: "network",
      type: "event",
      eventName: event,
      time: new Date().toISOString(),
      params,
      page: { dl: sp.get("dl"), dr: sp.get("dr"), dt: sp.get("dt") },
      meta: { tid: sp.get("tid"), cid: sp.get("cid"), sid: sp.get("sid") }
    };
  } catch (e) {
    return null;
  }
}

// ──────────────────────────────────────────────
// Lint integration
// ──────────────────────────────────────────────
function lintNewEvent(event, index) {
  if (!window.FerryLint) return [];
  const findings = window.FerryLint.lintEvent(event, state.sessionState);
  findings.forEach(f => { f.eventIndex = index; });
  return findings;
}

// ──────────────────────────────────────────────
// UI: Scorecard
// ──────────────────────────────────────────────
function updateScorecard() {
  const totalEvents = state.events.length + state.network.length;
  const errors = state.findings.filter(f => f.severity === "error").length;
  const warnings = state.findings.filter(f => f.severity === "warning").length;
  const info = state.findings.filter(f => f.severity === "info").length;

  document.getElementById("scorecard").style.display = totalEvents > 0 ? "flex" : "none";
  document.getElementById("scoreEvents").textContent = totalEvents;
  document.getElementById("scoreErrors").textContent = errors;
  document.getElementById("scoreWarnings").textContent = warnings;
  document.getElementById("scoreInfo").textContent = info;
}

// ──────────────────────────────────────────────
// UI: Findings tab
// ──────────────────────────────────────────────
function renderFindings() {
  const list = document.getElementById("findingsList");
  const empty = document.getElementById("findingsEmpty");

  if (state.findings.length === 0) {
    empty.style.display = "block";
    empty.textContent = recording
      ? "No issues found yet — looking good so far!"
      : "Start recording to analyze data layer events.";
    list.innerHTML = "";
    return;
  }

  empty.style.display = "none";

  // Sort: errors first, then warnings, then info
  const sorted = [...state.findings].sort((a, b) => {
    const order = { error: 0, warning: 1, info: 2 };
    return (order[a.severity] || 3) - (order[b.severity] || 3);
  });

  list.innerHTML = sorted.map(f => `
    <div class="finding ${f.severity}">
      <span class="severity-badge">${f.severity}</span>
      <span class="category-badge">${f.category}</span>
      <span class="event-ref">Event #${(f.eventIndex || 0) + 1}</span>
      <div class="message">${escapeHtml(f.message)}</div>
      <div class="detail">${escapeHtml(f.detail)}</div>
      ${f.docs ? `<a class="docs-link" href="${f.docs}" target="_blank">View Google docs →</a>` : ""}
    </div>
  `).join("");
}

// ──────────────────────────────────────────────
// UI: Events tab
// ──────────────────────────────────────────────
function renderEvents() {
  const list = document.getElementById("eventsList");
  const empty = document.getElementById("eventsEmpty");

  if (state.events.length === 0) {
    empty.style.display = "block";
    list.innerHTML = "";
    return;
  }
  empty.style.display = "none";

  list.innerHTML = state.events.map((evt, i) => {
    const name = evt.eventName || evt.event || (evt.payload && evt.payload.event) || "(unknown)";
    const source = evt.source || "unknown";
    const eventFindings = state.findings.filter(f => f.eventIndex === i);
    const errCount = eventFindings.filter(f => f.severity === "error").length;
    const warnCount = eventFindings.filter(f => f.severity === "warning").length;

    return `
      <div class="event-row" onclick="toggleEventDetail(${i})">
        <span class="event-name">${escapeHtml(name)}</span>
        <span class="event-source">${source} · ${evt.type || ""}</span>
        <div class="event-badges">
          ${errCount > 0 ? `<span class="mini-badge err">${errCount} error${errCount > 1 ? "s" : ""}</span>` : ""}
          ${warnCount > 0 ? `<span class="mini-badge warn">${warnCount} warning${warnCount > 1 ? "s" : ""}</span>` : ""}
        </div>
        <div class="event-detail" id="event-detail-${i}">
          <pre>${escapeHtml(JSON.stringify(evt, null, 2))}</pre>
        </div>
      </div>
    `;
  }).join("");
}

// ──────────────────────────────────────────────
// UI: Network tab
// ──────────────────────────────────────────────
function renderNetwork() {
  const list = document.getElementById("networkList");
  const empty = document.getElementById("networkEmpty");

  if (state.network.length === 0) {
    empty.style.display = "block";
    list.innerHTML = "";
    return;
  }
  empty.style.display = "none";

  list.innerHTML = state.network.map((hit, i) => {
    const name = hit.eventName || hit.event || "(unknown)";
    return `
      <div class="event-row" onclick="toggleNetworkDetail(${i})">
        <span class="event-name">${escapeHtml(name)}</span>
        <span class="event-source">network · ${hit.meta?.tid || ""}</span>
        <div class="event-detail" id="network-detail-${i}">
          <pre>${escapeHtml(JSON.stringify(hit, null, 2))}</pre>
        </div>
      </div>
    `;
  }).join("");
}

function toggleEventDetail(idx) {
  const el = document.getElementById(`event-detail-${idx}`);
  if (el) el.classList.toggle("open");
}

function toggleNetworkDetail(idx) {
  const el = document.getElementById(`network-detail-${idx}`);
  if (el) el.classList.toggle("open");
}

// ──────────────────────────────────────────────
// Render all
// ──────────────────────────────────────────────
function render() {
  updateScorecard();
  renderFindings();
  renderEvents();
  renderNetwork();
}

// ──────────────────────────────────────────────
// Tabs
// ──────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
    });
  });
}

// ──────────────────────────────────────────────
// Recording controls
// ──────────────────────────────────────────────
function resetState() {
  state.events = [];
  state.network = [];
  state.findings = [];
  state.sessionState = {};
  render();
}

function setRecordingUI(isRecording) {
  document.getElementById("startBtn").disabled = isRecording;
  document.getElementById("stopBtn").disabled = !isRecording;
  const pill = document.getElementById("statusPill");
  pill.textContent = isRecording ? "Recording" : "Stopped";
  pill.classList.toggle("recording", isRecording);
}

function startRecording() {
  resetState();
  recording = true;
  setRecordingUI(true);
}

function stopRecording() {
  recording = false;
  setRecordingUI(false);
}

function exportJSON() {
  const data = {
    exportedAt: new Date().toISOString(),
    events: state.events,
    network: state.network,
    findings: state.findings,
    summary: {
      totalEvents: state.events.length,
      totalNetworkHits: state.network.length,
      errors: state.findings.filter(f => f.severity === "error").length,
      warnings: state.findings.filter(f => f.severity === "warning").length,
      info: state.findings.filter(f => f.severity === "info").length,
    }
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ferry-recording-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ──────────────────────────────────────────────
// Event handling
// ──────────────────────────────────────────────
function handleDataLayerEvent(payload) {
  const idx = state.events.length;
  state.events.push(payload);
  const newFindings = lintNewEvent(payload, idx);
  state.findings.push(...newFindings);
  render();
}

function handleNetworkHit(hit) {
  state.network.push(hit);
  // Also lint network hits (they have eventName + params)
  const idx = state.events.length + state.network.length - 1;
  const newFindings = lintNewEvent(hit, idx);
  state.findings.push(...newFindings);
  render();
}

// ──────────────────────────────────────────────
// Network monitoring
// ──────────────────────────────────────────────
chrome.devtools.network.onRequestFinished.addListener(req => {
  if (!recording) return;
  const url = req.request.url;
  if (!url.includes("/collect")) return;
  const hit = parseGa4Hit(url);
  if (hit) handleNetworkHit(hit);
});

// ──────────────────────────────────────────────
// Utility
// ──────────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ──────────────────────────────────────────────
// Init
// ──────────────────────────────────────────────
window.onload = () => {
  port = chrome.runtime.connect({ name: "ferry-panel" });

  port.onMessage.addListener(msg => {
    if (!recording) return;
    if (msg.type === "FERRY_EVENT") {
      handleDataLayerEvent(msg.payload);
    }
  });

  document.getElementById("startBtn").onclick = startRecording;
  document.getElementById("stopBtn").onclick = stopRecording;
  document.getElementById("exportBtn").onclick = exportJSON;
  document.getElementById("clearBtn").onclick = resetState;

  initTabs();
  setRecordingUI(false);
  render();
};
