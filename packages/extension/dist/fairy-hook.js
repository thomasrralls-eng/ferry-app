/**
 * fairy-hook.js — Shared dataLayer/gtag hook injection function.
 *
 * This function runs in the page's MAIN world via chrome.scripting.executeScript.
 * It must be fully self-contained (no external references or imports).
 *
 * The same logic is mirrored in packages/scraper/src/browser.js.
 * Keep both in sync — the goal is identical capture behaviour whether
 * the audit runs from the extension or the cloud scraper.
 *
 * What it hooks:
 *   - window.dataLayer.push()   → captures every GTM/dataLayer push
 *   - window.gtag()             → captures direct gtag() calls
 *   - history.pushState /
 *     history.replaceState      → tracks virtual SPA pageviews
 *
 * Captured events land in window.__fairyEvents[] for drain by the crawler.
 * SPA route changes land in window.__fairySPAChanges[].
 */

/* eslint-disable no-var */
function fairyHookFn() {
  if (window.__fairyHooked) return;
  window.__fairyHooked = true;
  window.__fairyEvents    = window.__fairyEvents    || [];
  window.__fairySPAChanges = window.__fairySPAChanges || [];

  // ── Safe structured clone with depth/key/array limits ──────────────────────
  var LIMITS = { maxDepth: 6, maxKeys: 200, maxArray: 200 };

  function safeClone(value, opts, state) {
    if (!state) state = { seen: new WeakSet(), keysUsed: 0 };
    var maxDepth = opts.maxDepth, maxKeys = opts.maxKeys, maxArray = opts.maxArray;

    function budget() { return state.keysUsed >= maxKeys; }

    function inner(v, depth) {
      var t = typeof v;
      if (v == null || t === "string" || t === "number" || t === "boolean") return v;
      if (depth > maxDepth) return "[MaxDepth]";
      if (t === "bigint" || t === "symbol") return v.toString();
      if (t === "function") return "[Function]";
      if (v instanceof Date) return v.toISOString();
      if (v instanceof Error) return { name: v.name, message: v.message };

      if (Array.isArray(v)) {
        if (budget()) return "[MaxKeys]";
        var len = Math.min(v.length, maxArray);
        var outArr = [];
        for (var i = 0; i < len; i++) outArr.push(inner(v[i], depth + 1));
        if (v.length > maxArray) outArr.push("[TruncatedArray:" + v.length + "]");
        return outArr;
      }

      if (t === "object") {
        if (state.seen.has(v)) return "[Circular]";
        state.seen.add(v);
        if (budget()) return "[MaxKeys]";
        var outObj = {};
        var keys = Object.keys(v);
        for (var ki = 0; ki < keys.length; ki++) {
          if (budget()) { outObj.__truncated__ = "[TruncatedKeys:" + keys.length + "]"; break; }
          state.keysUsed++;
          try { outObj[keys[ki]] = inner(v[keys[ki]], depth + 1); }
          catch { outObj[keys[ki]] = "[Unclonable]"; }
        }
        return outObj;
      }

      try { return String(v); } catch { return "[Unclonable]"; }
    }

    return inner(value, 0);
  }

  // ── Normalize a raw dataLayer / gtag item ────────────────────────────────
  function normalize(item) {
    if (item && typeof item === "object" &&
        Object.prototype.toString.call(item) === "[object Arguments]") {
      item = Array.from(item);
    }
    if (Array.isArray(item)) {
      var cmd = item[0], arg1 = item[1], arg2 = item[2];
      if (cmd === "event")  return { source: "gtag", type: "event",  eventName: arg1, params: arg2 };
      if (cmd === "config") return { source: "gtag", type: "config", measurementId: arg1, params: arg2 };
      if (cmd === "set")    return { source: "gtag", type: "set",    params: arg1 };
      if (cmd === "js")     return { source: "gtag", type: "js" };
      return { source: "gtag", type: "unknown", raw: item };
    }
    if (item && typeof item === "object") {
      return { source: "dataLayer", type: "object", eventName: item.event || null, payload: item };
    }
    return { source: "unknown", payload: item };
  }

  function post(payload) {
    window.__fairyEvents.push(safeClone(payload, LIMITS));
  }

  // ── Hook a dataLayer array ───────────────────────────────────────────────
  function hookDataLayer(dl) {
    if (!dl || dl.__fairy_hooked) return;
    dl.__fairy_hooked = true;

    var origPush = dl.push.bind(dl);
    dl.push = function () {
      for (var ai = 0; ai < arguments.length; ai++) {
        var item = arguments[ai];
        if (item && typeof item === "object" &&
            Object.prototype.toString.call(item) === "[object Arguments]") {
          item = Array.from(item);
        }
        post(normalize(item));
      }
      return origPush.apply(dl, arguments);
    };

    // Backfill already-queued items (pre-GTM pushes)
    for (var bi = 0; bi < dl.length; bi++) {
      var existing = dl[bi];
      if (existing && typeof existing === "object" &&
          Object.prototype.toString.call(existing) === "[object Arguments]") {
        existing = Array.from(existing);
      }
      post(normalize(existing));
    }
  }

  // ── Attach to window.dataLayer with setter trap for re-assignment ─────────
  // Some sites re-assign window.dataLayer after GTM loads (e.g. Marriott).
  // The setter trap ensures we hook the new array.
  window.dataLayer = window.dataLayer || [];
  hookDataLayer(window.dataLayer);

  var _currentDL = window.dataLayer;
  try {
    Object.defineProperty(window, "dataLayer", {
      configurable: true,
      enumerable: true,
      get: function () { return _currentDL; },
      set: function (val) {
        if (val === _currentDL) return;
        _currentDL = val;
        hookDataLayer(_currentDL);
      },
    });
  } catch {
    // If defineProperty is blocked, fall back to a periodic re-check
    var recheckInterval = setInterval(function () {
      if (window.dataLayer !== _currentDL) {
        _currentDL = window.dataLayer;
        hookDataLayer(_currentDL);
      }
    }, 500);
    // Don't run forever — stop after 30 s
    setTimeout(function () { clearInterval(recheckInterval); }, 30000);
  }

  // ── Hook gtag() ──────────────────────────────────────────────────────────
  // gtag may not be defined yet when the hook runs (async script loads).
  // Poll until it appears, then wrap it.
  function tryWrapGtag() {
    if (typeof window.gtag !== "function") return false;
    if (window.gtag.__fairy_hooked) return true;
    var orig = window.gtag;
    window.gtag = function () {
      var args = Array.prototype.slice.call(arguments);
      post({ source: "gtag", type: args[0], time: new Date().toISOString(), args: args });
      return orig.apply(this, arguments);
    };
    window.gtag.__fairy_hooked = true;
    return true;
  }

  if (!tryWrapGtag()) {
    var gtagStart = Date.now();
    var gtagTimer = setInterval(function () {
      if (tryWrapGtag() || Date.now() - gtagStart > 5000) clearInterval(gtagTimer);
    }, 50);
  }

  // ── SPA: patch history.pushState / replaceState ───────────────────────────
  // Records virtual pageview route changes so the crawler can detect them.
  // Does NOT reset __fairyHooked — hook continuity across virtual pages is
  // handled by the crawler draining and re-injecting per page.
  if (!history.__fairy_hooked) {
    history.__fairy_hooked = true;

    function patchHistory(method) {
      var orig = history[method];
      history[method] = function () {
        var result = orig.apply(this, arguments);
        window.__fairySPAChanges.push({
          method: method,
          url: location.href,
          ts: Date.now(),
        });
        return result;
      };
    }

    patchHistory("pushState");
    patchHistory("replaceState");
  }
}

// ── Export ────────────────────────────────────────────────────────────────────
// Make available in the service-worker context so crawler.js can pass
// `func: globalThis.fairyHookFn` to chrome.scripting.executeScript.
if (typeof globalThis !== "undefined") {
  globalThis.fairyHookFn = fairyHookFn;
}
