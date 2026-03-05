/**
 * DevTools panel — displays captured dataLayer events and network hits.
 * Receives events from the background service worker via chrome.runtime.connect.
 * Also monitors network requests directly via chrome.devtools.network.
 */

let port = null;
let recording = false;

const state = {
  events: [],   // dataLayer / gtag events (from injected hook)
  network: []   // parsed /collect network hits
};

// --------------------------
// GA4 /collect URL parser
// --------------------------
function parseGa4Hit(url) {
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
    time: new Date().toISOString(),
    event,
    params,
    page: {
      dl: sp.get("dl"),
      dr: sp.get("dr"),
      dt: sp.get("dt")
    },
    meta: {
      tid: sp.get("tid"),
      cid: sp.get("cid"),
      sid: sp.get("sid"),
      sct: sp.get("sct"),
      seg: sp.get("seg")
    }
  };
}

// --------------------------
// UI
// --------------------------
function resetState() {
  state.events = [];
  state.network = [];
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
  const blob = new Blob([JSON.stringify({ events: state.events, network: state.network }, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ferry-recording-${new Date().toISOString().slice(0, 19)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function render() {
  const eventsCount = document.getElementById("eventsCount");
  const hitsCount = document.getElementById("hitsCount");
  const eventsPre = document.getElementById("eventsPre");
  const hitsPre = document.getElementById("hitsPre");
  if (eventsCount) eventsCount.textContent = state.events.length;
  if (hitsCount) hitsCount.textContent = state.network.length;
  if (eventsPre) eventsPre.textContent = JSON.stringify(state.events, null, 2);
  if (hitsPre) hitsPre.textContent = JSON.stringify(state.network, null, 2);
}

// --------------------------
// Network monitoring
// --------------------------
chrome.devtools.network.onRequestFinished.addListener(req => {
  if (!recording) return;

  const url = req.request.url;
  if (!url.includes("/collect")) return;

  const evt = parseGa4Hit(url);
  if (evt) {
    state.network.push(evt);
    render();
  }
});

// --------------------------
// Init
// --------------------------
window.onload = () => {
  port = chrome.runtime.connect({ name: "ferry-panel" });

  port.onMessage.addListener(msg => {
    if (!recording) return;
    if (msg.type === "FERRY_EVENT") {
      state.events.push(msg.payload);
      render();
    }
  });

  document.getElementById("startBtn").onclick = startRecording;
  document.getElementById("stopBtn").onclick = stopRecording;
  document.getElementById("exportBtn").onclick = exportJSON;
  document.getElementById("clearBtn").onclick = resetState;
  setRecordingUI(false);
  render();
};
