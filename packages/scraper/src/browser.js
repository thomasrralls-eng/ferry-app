/**
 * browser.js — Puppeteer lifecycle, Ferry hook injection, and network capture.
 *
 * Manages a headless Chrome instance for the scraper. Each page visit:
 *   1. Navigates to the URL
 *   2. Intercepts GA4 /collect network requests
 *   3. Injects the Ferry dataLayer/gtag hook (fairyHookFn)
 *   4. Waits for events to stabilize (via wait-strategy)
 *   5. Drains captured events and returns them
 *
 * fairyHookFn is intentionally kept in sync with the Chrome extension's
 * packages/extension/src/background/fairy-hook.js so cloud and user-Chrome
 * runs capture events identically.
 */

import { waitForDataLayer, detectAnalyticsPresence } from "./wait-strategy.js";
import { domClassifierScript, classifyPage } from "./page-classifier.js";
import { USER_AGENT } from "./robots.js";

/**
 * Launch a headless browser instance.
 *
 * @param {Object} [options]
 * @param {boolean} [options.headless=true]
 * @param {string[]} [options.args] - Extra Chrome args
 * @returns {Promise<import('puppeteer').Browser>}
 */
export async function launchBrowser(options = {}) {
  // Dynamic import so the module loads even if Puppeteer isn't installed yet
  const puppeteer = await import("puppeteer");

  const browser = await puppeteer.default.launch({
    headless: options.headless !== false ? "new" : false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1440,900",
      ...(options.args || []),
    ],
    defaultViewport: { width: 1440, height: 900 },
  });

  return browser;
}

/**
 * Visit a single page, inject hooks, capture events + network hits.
 *
 * @param {import('puppeteer').Browser} browser
 * @param {string} url - URL to visit
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=15000] - Navigation timeout
 * @param {Object} [options.waitOptions] - Override wait-strategy options
 * @returns {Promise<PageResult>}
 */
export async function visitPage(browser, url, options = {}) {
  const { timeoutMs = 15000, waitOptions = {} } = options;
  const page = await browser.newPage();
  const startTime = Date.now();

  // Set our bot user agent
  await page.setUserAgent(USER_AGENT);

  // Collect network hits to GA4 /collect endpoints
  const networkHits = [];
  const gtmScripts = [];

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const reqUrl = req.url();

    // Capture GA4 collect hits with enriched params
    if (reqUrl.includes("/g/collect") || reqUrl.includes("/collect?") || reqUrl.includes("/mp/collect")) {
      try {
        const parsed = new URL(reqUrl);
        networkHits.push({
          url: reqUrl,
          timestamp: new Date().toISOString(),
          hitType: reqUrl.includes("/mp/collect") ? "measurement-protocol" : "ga4-collect",
          hasUserId: !!(parsed.searchParams.get("uid")),
          hasUserIpOverride: !!(parsed.searchParams.get("_uip")),
          customDimensionCount: [...parsed.searchParams.keys()].filter(k => k.startsWith("ep.") || k.startsWith("epn.")).length,
        });
      } catch {
        networkHits.push({ url: reqUrl, timestamp: new Date().toISOString(), hitType: "ga4-collect" });
      }
    }

    // Capture Google Ads conversion tracking (enterprise signal)
    if (reqUrl.includes("googleadservices.com/pagead/conversion") || reqUrl.includes("google.com/pagead/")) {
      networkHits.push({
        url: reqUrl,
        timestamp: new Date().toISOString(),
        hitType: "google-ads-conversion",
      });
    }

    // Capture GTM / gtag.js loads
    if (reqUrl.includes("googletagmanager.com/gtm.js") || reqUrl.includes("googletagmanager.com/gtag/js")) {
      gtmScripts.push({
        url: reqUrl,
        hitType: reqUrl.includes("gtm.js") ? "gtm-container" : "gtag-js",
        timestamp: new Date().toISOString(),
      });
    }

    // Don't block requests — let everything load normally
    req.continue();
  });

  try {
    // Navigate
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    // Inject the Ferry dataLayer/gtag hook
    await injectFairyHook(page);

    // Wait for dataLayer to stabilize
    const waitResult = await waitForDataLayer(page, waitOptions);

    // Detect analytics stack
    const analyticsPresence = await detectAnalyticsPresence(page);

    // Run DOM classifier
    const domSignals = await page.evaluate(domClassifierScript());
    const classification = classifyPage(url, domSignals);

    // Drain captured events
    const events = await drainEvents(page);

    // Extract links for crawl queue
    const links = await extractLinks(page);

    const loadTime = Date.now() - startTime;

    await page.close();

    return {
      url,
      events,
      networkHits,
      gtmScripts,
      analyticsPresence,
      classification,
      domSignals,
      links,
      waitResult,
      loadTime,
      timestamp: new Date().toISOString(),
      error: null,
    };
  } catch (err) {
    try { await page.close(); } catch {}

    return {
      url,
      events: [],
      networkHits,
      gtmScripts,
      analyticsPresence: null,
      classification: classifyPage(url),
      domSignals: null,
      links: [],
      waitResult: null,
      loadTime: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      error: err.message,
    };
  }
}

/**
 * fairyHookFn — the Ferry dataLayer/gtag hook injected into each page.
 *
 * KEEP IN SYNC with packages/extension/src/background/fairy-hook.js.
 * Both implementations must be identical so cloud and extension crawls
 * produce consistent capture results.
 *
 * Self-contained: no imports, no external references. Runs inside the
 * page's JS context via page.evaluate().
 */
/* eslint-disable no-var */
function fairyHookFn() {
  if (window.__fairyHooked) return;
  window.__fairyHooked = true;
  window.__fairyEvents     = window.__fairyEvents    || [];
  window.__fairySPAChanges = window.__fairySPAChanges || [];

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
        var outArr = [];
        var len = Math.min(v.length, maxArray);
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
    for (var bi = 0; bi < dl.length; bi++) {
      var existing = dl[bi];
      if (existing && typeof existing === "object" &&
          Object.prototype.toString.call(existing) === "[object Arguments]") {
        existing = Array.from(existing);
      }
      post(normalize(existing));
    }
  }

  // Hook with setter trap for dataLayer re-assignment
  window.dataLayer = window.dataLayer || [];
  hookDataLayer(window.dataLayer);
  var _currentDL = window.dataLayer;
  try {
    Object.defineProperty(window, "dataLayer", {
      configurable: true, enumerable: true,
      get: function () { return _currentDL; },
      set: function (val) {
        if (val === _currentDL) return;
        _currentDL = val;
        hookDataLayer(_currentDL);
      },
    });
  } catch {
    var ri = setInterval(function () {
      if (window.dataLayer !== _currentDL) {
        _currentDL = window.dataLayer;
        hookDataLayer(_currentDL);
      }
    }, 500);
    setTimeout(function () { clearInterval(ri); }, 30000);
  }

  // Hook gtag
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
    var gt = setInterval(function () {
      if (tryWrapGtag() || Date.now() - gtagStart > 5000) clearInterval(gt);
    }, 50);
  }

  // SPA history patching
  if (!history.__fairy_hooked) {
    history.__fairy_hooked = true;
    function patchHistory(method) {
      var orig = history[method];
      history[method] = function () {
        var result = orig.apply(this, arguments);
        window.__fairySPAChanges.push({ method: method, url: location.href, ts: Date.now() });
        return result;
      };
    }
    patchHistory("pushState");
    patchHistory("replaceState");
  }
}

/**
 * Inject fairyHookFn into the Puppeteer page context.
 */
async function injectFairyHook(page) {
  await page.evaluate(fairyHookFn);
}

/**
 * Drain all captured events from the page.
 */
async function drainEvents(page) {
  try {
    return await page.evaluate(() => {
      const events = window.__fairyEvents || [];
      window.__fairyEvents = [];
      return JSON.parse(JSON.stringify(events));
    });
  } catch {
    return [];
  }
}

/**
 * Extract all same-origin <a href> links from the page.
 */
async function extractLinks(page) {
  try {
    return await page.evaluate(() => {
      const origin = location.origin;
      return Array.from(document.querySelectorAll("a[href]"))
        .map(a => {
          try {
            const url = new URL(a.href, location.href);
            url.hash = "";
            return url.origin === origin ? url.href : null;
          } catch { return null; }
        })
        .filter(Boolean);
    });
  } catch {
    return [];
  }
}

/**
 * Extract navigation links (from <nav> and <header>) for recon scan.
 * These represent the site's primary page structure.
 */
export async function extractNavLinks(page) {
  try {
    return await page.evaluate(() => {
      const origin = location.origin;
      const navLinks = new Set();

      // Primary nav
      const navEls = document.querySelectorAll("nav a[href], header a[href]");
      for (const a of navEls) {
        try {
          const url = new URL(a.href, location.href);
          url.hash = "";
          if (url.origin === origin) navLinks.add(url.href);
        } catch {}
      }

      // Footer links (often have important pages like pricing, about, contact)
      const footerLinks = document.querySelectorAll("footer a[href]");
      for (const a of footerLinks) {
        try {
          const url = new URL(a.href, location.href);
          url.hash = "";
          if (url.origin === origin) navLinks.add(url.href);
        } catch {}
      }

      return [...navLinks];
    });
  } catch {
    return [];
  }
}
