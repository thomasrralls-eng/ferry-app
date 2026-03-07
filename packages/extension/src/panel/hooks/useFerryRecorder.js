import { useState, useRef, useEffect, useCallback } from "react";

/**
 * The hook injection script. Executed directly in the page's MAIN world
 * via chrome.scripting.executeScript. Hooks dataLayer.push and gtag()
 * and stores captured events in window.__ferryEvents for the panel to poll.
 */
const INJECT_HOOK_CODE = () => {
  if (window.__ferryHooked) return;
  window.__ferryHooked = true;
  window.__ferryEvents = [];

  function safeClone(v, depth) {
    if (depth === undefined) depth = 0;
    if (depth > 5) return "[MaxDepth]";
    var t = typeof v;
    if (v == null || t === "string" || t === "number" || t === "boolean") return v;
    if (t === "function") return "[Function]";
    if (t === "symbol" || t === "bigint") return String(v);
    try { if (v instanceof Node) return "<" + (v.tagName||"node").toLowerCase() + ">"; } catch(e){}
    if (v instanceof Date) return v.toISOString();
    if (v instanceof Error) return { name: v.name, message: v.message };
    if (Array.isArray(v)) {
      var arr = [];
      for (var i = 0; i < Math.min(v.length, 100); i++) arr.push(safeClone(v[i], depth+1));
      return arr;
    }
    if (t === "object") {
      try {
        var out = {};
        var keys = Object.keys(v);
        for (var i = 0; i < Math.min(keys.length, 100); i++) {
          try { out[keys[i]] = safeClone(v[keys[i]], depth+1); }
          catch(e) { out[keys[i]] = "[Error]"; }
        }
        return out;
      } catch(e) { return "[Unclonable]"; }
    }
    try { return String(v); } catch(e) { return "[?]"; }
  }

  function normalizeItem(item) {
    if (item && typeof item === "object" && Object.prototype.toString.call(item) === "[object Arguments]") {
      item = Array.from(item);
    }
    if (Array.isArray(item)) {
      var cmd = item[0], arg1 = item[1], arg2 = item[2];
      if (cmd === "event") return { source: "gtag", type: "event", eventName: arg1, params: arg2, raw: item };
      if (cmd === "config") return { source: "gtag", type: "config", measurementId: arg1, params: arg2, raw: item };
      if (cmd === "set") return { source: "gtag", type: "set", params: arg1, raw: item };
      if (cmd === "js") return { source: "gtag", type: "js", date: arg1, raw: item };
      return { source: "gtag", type: "unknown", raw: item };
    }
    if (item && typeof item === "object") {
      return { source: "dataLayer", type: "object", eventName: item.event || null, payload: item };
    }
    return { source: "unknown", payload: item };
  }

  function capture(item) {
    var normalized = normalizeItem(item);
    var safe = safeClone(normalized);
    safe.time = new Date().toISOString();
    safe.pageUrl = location.href;
    window.__ferryEvents.push(safe);
  }

  /* Hook dataLayer.push */
  function hookDL() {
    if (!window.dataLayer) window.dataLayer = [];
    var dl = window.dataLayer;
    if (dl.__ferryH) return;
    dl.__ferryH = true;
    var origPush = dl.push.bind(dl);
    dl.push = function() {
      for (var i = 0; i < arguments.length; i++) capture(arguments[i]);
      return origPush.apply(dl, arguments);
    };
    for (var i = 0; i < dl.length; i++) capture(dl[i]);
  }

  hookDL();

  /* Re-hook if dataLayer gets replaced (GTM does this) */
  var _dl = window.dataLayer;
  try {
    Object.defineProperty(window, "dataLayer", {
      configurable: true, enumerable: true,
      get: function() { return _dl; },
      set: function(v) { _dl = v; hookDL(); }
    });
  } catch(e) {}
  setInterval(function() { if (window.dataLayer && !window.dataLayer.__ferryH) hookDL(); }, 1000);

  /* Hook gtag() */
  function hookGtag() {
    if (typeof window.gtag !== "function" || window.gtag.__ferryH) return false;
    var orig = window.gtag;
    window.gtag = function() {
      capture(Array.from(arguments));
      return orig.apply(this, arguments);
    };
    window.gtag.__ferryH = true;
    return true;
  }
  if (!hookGtag()) {
    var start = Date.now();
    var t = setInterval(function() {
      if (hookGtag() || Date.now() - start > 10000) clearInterval(t);
    }, 100);
  }
};

/**
 * Drain window.__ferryEvents from the page. Returns the array and resets it.
 */
const DRAIN_EVENTS_CODE = () => {
  var e = window.__ferryEvents || [];
  window.__ferryEvents = [];
  return JSON.parse(JSON.stringify(e));
};

/**
 * Clear stale events and reset hook flag so a fresh start is possible.
 */
const CLEAR_EVENTS_CODE = () => {
  window.__ferryEvents = [];
};


/**
 * Core recording hook — manages event capture, network monitoring,
 * and lint analysis.
 *
 * DataLayer events: injected + polled via chrome.scripting.executeScript (MAIN world).
 * Network hits: captured by the service worker via webRequest, relayed via port.
 */
export default function useFerryRecorder() {
  const [recording, setRecording] = useState(false);
  const [events, setEvents] = useState([]);
  const [network, setNetwork] = useState([]);
  const [findings, setFindings] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const sessionStateRef = useRef({});
  const recordingRef = useRef(false);
  const pollTimerRef = useRef(null);
  const portRef = useRef(null);
  const activeTabRef = useRef(null);

  useEffect(() => { recordingRef.current = recording; }, [recording]);
  useEffect(() => { activeTabRef.current = activeTabId; }, [activeTabId]);

  // ── Get active tab and track tab switches ──
  useEffect(() => {
    const updateActiveTab = async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) {
          setActiveTabId(tabs[0].id);
        }
      } catch (e) {}
    };

    updateActiveTab();

    const onActivated = () => updateActiveTab();
    const onUpdated = (tabId, changeInfo) => {
      if (changeInfo.status === "complete" && tabId === activeTabRef.current) {
        // Page navigated — re-inject hook if recording
        if (recordingRef.current) {
          injectHook(tabId);
        }
      }
    };

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  // ── Port connection for network hits from service worker ──
  useEffect(() => {
    if (!activeTabId) return;

    const port = chrome.runtime.connect({ name: "ferry-panel" });
    portRef.current = port;

    port.postMessage({ type: "FERRY_INIT", tabId: activeTabId });

    port.onMessage.addListener((msg) => {
      // Network hits relayed from service worker's webRequest listener
      if (msg.type === "FERRY_NETWORK_HIT" && recordingRef.current) {
        const hit = parseGa4Hit(msg.url);
        if (hit) {
          hit.hitType = msg.hitType;
          setNetwork((prev) => {
            const idx = prev.length + 1000;
            const newFindings = lintNewEvent(hit, idx);
            if (newFindings.length > 0) {
              setFindings((f) => [...f, ...newFindings]);
            }
            return [...prev, hit];
          });
        }
      }

      // Crawl messages forwarded through
      // (handled by useFerryCrawler via its own port)
    });

    port.onDisconnect.addListener(() => {
      portRef.current = null;
    });

    return () => {
      try { port.disconnect(); } catch (e) {}
      portRef.current = null;
    };
  }, [activeTabId]);

  // ── Inject hook into page via scripting API ──
  const injectHook = useCallback(async (tabId) => {
    const tid = tabId || activeTabRef.current;
    if (!tid) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tid },
        world: "MAIN",
        func: INJECT_HOOK_CODE,
      });
      await chrome.scripting.executeScript({
        target: { tabId: tid },
        world: "MAIN",
        func: CLEAR_EVENTS_CODE,
      });
    } catch (e) {
      // May fail on chrome:// or restricted pages
    }
  }, []);

  // ── GA4 /collect parser ──
  const parseGa4Hit = useCallback((url) => {
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
        source: "network", type: "event", eventName: event,
        time: new Date().toISOString(), params,
        page: { dl: sp.get("dl"), dr: sp.get("dr"), dt: sp.get("dt") },
        meta: { tid: sp.get("tid"), cid: sp.get("cid"), sid: sp.get("sid") },
      };
    } catch { return null; }
  }, []);

  // ── Lint a single event ──
  const lintNewEvent = useCallback((event, index) => {
    if (!window.FerryLint) return [];
    const results = window.FerryLint.lintEvent(event, sessionStateRef.current);
    results.forEach((f) => { f.eventIndex = index; });
    return results;
  }, []);

  // ── Poll for dataLayer events via scripting API ──
  const pollEvents = useCallback(async () => {
    if (!recordingRef.current || !activeTabRef.current) return;

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTabRef.current },
        world: "MAIN",
        func: DRAIN_EVENTS_CODE,
      });

      const newEvents = results?.[0]?.result;
      if (!newEvents || newEvents.length === 0) return;

      setEvents((prev) => {
        let startIdx = prev.length;
        const allNewFindings = [];
        for (const evt of newEvents) {
          const f = lintNewEvent(evt, startIdx);
          allNewFindings.push(...f);
          startIdx++;
        }
        if (allNewFindings.length > 0) {
          setFindings((old) => [...old, ...allNewFindings]);
        }
        return [...prev, ...newEvents];
      });
    } catch (e) {
      // scripting.executeScript failed — page may have navigated
    }
  }, [lintNewEvent]);

  // ── Start/stop polling ──
  useEffect(() => {
    if (recording) {
      pollTimerRef.current = setInterval(pollEvents, 500);
      pollEvents();
    } else {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [recording, pollEvents]);

  // ── Controls ──
  const startRecording = useCallback(async () => {
    setEvents([]);
    setNetwork([]);
    setFindings([]);
    sessionStateRef.current = {};

    await injectHook();
    setRecording(true);
  }, [injectHook]);

  const stopRecording = useCallback(() => {
    pollEvents(); // one final drain
    setRecording(false);
  }, [pollEvents]);

  const clear = useCallback(() => {
    setEvents([]);
    setNetwork([]);
    setFindings([]);
    sessionStateRef.current = {};
  }, []);

  const exportJSON = useCallback(() => {
    const data = {
      exportedAt: new Date().toISOString(),
      events, network, findings,
      summary: {
        totalEvents: events.length,
        totalNetworkHits: network.length,
        errors: findings.filter((f) => f.severity === "error").length,
        warnings: findings.filter((f) => f.severity === "warning").length,
        info: findings.filter((f) => f.severity === "info").length,
      },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ferry-recording-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [events, network, findings]);

  return {
    recording, events, network, findings, activeTabId,
    startRecording, stopRecording, clear, exportJSON,
  };
}
