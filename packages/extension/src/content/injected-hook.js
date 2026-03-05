/**
 * Injected into the page context (not the extension context).
 * Hooks dataLayer.push() and gtag() to intercept all events before
 * they're processed by GTM or sent to Google.
 *
 * Communication: window.postMessage → content-script.js → background
 *
 * NOTE: This file must be self-contained (no imports). It runs in the
 * page's JS context, not the extension context. The same logic is
 * extracted into @ferry/core for server-side use.
 */

(() => {
  // --------------------------
  // Safe structured cloning with limits
  // --------------------------
  const DEFAULT_LIMITS = {
    maxDepth: 6,
    maxKeys: 200,
    maxArray: 200
  };

  function describeNode(node) {
    try {
      if (!node || !node.nodeType) return "[Node]";
      const tag = node.tagName ? node.tagName.toLowerCase() : "";
      const id = node.id ? `#${node.id}` : "";
      const cls =
        node.classList && node.classList.length
          ? "." + Array.from(node.classList).slice(0, 3).join(".")
          : "";
      const href =
        typeof node.getAttribute === "function" && node.getAttribute("href")
          ? ` href="${node.getAttribute("href")}"`
          : "";
      return `<${tag}${id}${cls}${href}>`;
    } catch {
      return "[Node]";
    }
  }

  function safeClone(value, opts = DEFAULT_LIMITS, state) {
    if (!state) {
      state = { seen: new WeakSet(), keysUsed: 0 };
    }
    const { maxDepth, maxKeys, maxArray } = opts;

    function budgetCheck() {
      return state.keysUsed >= maxKeys;
    }

    function cloneInner(v, depth) {
      const t = typeof v;
      if (v == null || t === "string" || t === "number" || t === "boolean") return v;
      if (depth > maxDepth) return "[MaxDepth]";
      if (t === "bigint") return v.toString();
      if (t === "symbol") return v.toString();
      if (t === "function") return "[Function]";

      try {
        if (typeof Node !== "undefined" && v instanceof Node) {
          return describeNode(v);
        }
      } catch {}

      if (v instanceof Date) return v.toISOString();
      if (v instanceof Error) {
        return { name: v.name, message: v.message, stack: v.stack };
      }

      if (Array.isArray(v)) {
        if (budgetCheck()) return "[MaxKeys]";
        const len = Math.min(v.length, maxArray);
        const out = new Array(len);
        for (let i = 0; i < len; i++) {
          out[i] = cloneInner(v[i], depth + 1);
        }
        if (v.length > maxArray) out.push(`[TruncatedArray:${v.length}]`);
        return out;
      }

      if (t === "object") {
        if (state.seen.has(v)) return "[Circular]";
        state.seen.add(v);
        if (budgetCheck()) return "[MaxKeys]";
        const out = {};
        const keys = Object.keys(v);
        for (let i = 0; i < keys.length; i++) {
          if (budgetCheck()) {
            out.__truncated__ = `[TruncatedKeys:${keys.length}]`;
            break;
          }
          const k = keys[i];
          state.keysUsed += 1;
          try {
            out[k] = cloneInner(v[k], depth + 1);
          } catch (e) {
            out[k] = `[Unclonable: ${e?.name || "Error"}]`;
          }
        }
        return out;
      }

      try {
        return String(v);
      } catch {
        return "[Unclonable]";
      }
    }

    return cloneInner(value, 0);
  }

  // --------------------------
  // Messaging
  // --------------------------
  function frameUrl() {
    try { return location.href; } catch { return null; }
  }

  function post(payload) {
    const safePayload = safeClone(payload, DEFAULT_LIMITS);
    window.postMessage({ type: "FERRY_EVENT", payload: safePayload }, "*");
  }

  // --------------------------
  // Normalization
  // --------------------------
  function normalizeItem(item) {
    if (item && typeof item === "object" && Object.prototype.toString.call(item) === "[object Arguments]") {
      item = Array.from(item);
    }

    if (Array.isArray(item)) {
      const [cmd, arg1, arg2] = item;
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

  // --------------------------
  // Hook dataLayer.push
  // --------------------------
  function hookDataLayer() {
    window.dataLayer = window.dataLayer || [];
    const dl = window.dataLayer;
    if (dl.__ferry_hooked) return;
    dl.__ferry_hooked = true;

    const originalPush = dl.push.bind(dl);
    dl.push = function (...args) {
      args.forEach((item) => {
        if (item && typeof item === "object" && Object.prototype.toString.call(item) === "[object Arguments]") {
          item = Array.from(item);
        }
        post(normalizeItem(item));
      });
      return originalPush(...args);
    };

    // Backfill existing items
    dl.forEach((item) => {
      if (item && typeof item === "object" && Object.prototype.toString.call(item) === "[object Arguments]") {
        item = Array.from(item);
      }
      post(normalizeItem(item));
    });
  }

  // --------------------------
  // Robust hook with setter trap
  // --------------------------
  function robustHookDataLayer() {
    let lastHooked = window.dataLayer;

    function doHook() {
      if (!window.dataLayer || window.dataLayer === lastHooked) return;
      hookDataLayer();
      lastHooked = window.dataLayer;
    }

    doHook();

    try {
      Object.defineProperty(window, "dataLayer", {
        configurable: true,
        enumerable: true,
        get() { return lastHooked; },
        set(val) {
          if (val === lastHooked) return;
          lastHooked = val;
          hookDataLayer();
        }
      });
    } catch (e) {
      setInterval(doHook, 500);
    }

    setInterval(doHook, 1000);
  }

  // --------------------------
  // Hook gtag
  // --------------------------
  function hookGtag() {
    const tryWrap = () => {
      if (typeof window.gtag !== "function") return false;
      if (window.gtag.__ferry_hooked) return true;
      const original = window.gtag;
      window.gtag = function (...args) {
        post({
          source: "gtag",
          type: Array.isArray(args) && args[0],
          frameUrl: frameUrl(),
          time: new Date().toISOString(),
          args
        });
        return original.apply(this, args);
      };
      window.gtag.__ferry_hooked = true;
      return true;
    };

    if (tryWrap()) return;
    const start = Date.now();
    const t = setInterval(() => {
      if (tryWrap() || Date.now() - start > 5000) clearInterval(t);
    }, 50);
  }

  robustHookDataLayer();
  hookGtag();
})();
