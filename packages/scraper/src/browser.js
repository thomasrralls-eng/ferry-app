/**
 * browser.js — Puppeteer lifecycle, Ferry hook injection, and network capture.
 *
 * Manages a headless Chrome instance for the scraper. Each page visit:
 *   1. Navigates to the URL
 *   2. Intercepts GA4 /collect network requests
 *   3. Injects the Ferry dataLayer/gtag hook
 *   4. Waits for events to stabilize (via wait-strategy)
 *   5. Drains captured events and returns them
 *
 * The hook injection is the same logic used in the Chrome extension
 * (injected-hook.js) — normalized via @ferry/core.
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
    await injectFerryHook(page);

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
 * Inject the Ferry dataLayer/gtag hook into the page's MAIN world.
 * This is a simplified version of the extension's injected-hook.js,
 * reusing the same normalization logic.
 */
async function injectFerryHook(page) {
  await page.evaluate(() => {
    if (window.__ferryHooked) return;
    window.__ferryHooked = true;
    window.__ferryEvents = [];

    const LIMITS = { maxDepth: 6, maxKeys: 200, maxArray: 200 };

    function safeClone(value, opts, state) {
      if (!state) state = { seen: new WeakSet(), keysUsed: 0 };
      const { maxDepth, maxKeys, maxArray } = opts;
      function budget() { return state.keysUsed >= maxKeys; }
      function inner(v, depth) {
        const t = typeof v;
        if (v == null || t === "string" || t === "number" || t === "boolean") return v;
        if (depth > maxDepth) return "[MaxDepth]";
        if (t === "bigint" || t === "symbol") return v.toString();
        if (t === "function") return "[Function]";
        if (v instanceof Date) return v.toISOString();
        if (v instanceof Error) return { name: v.name, message: v.message };
        if (Array.isArray(v)) {
          if (budget()) return "[MaxKeys]";
          const len = Math.min(v.length, maxArray);
          const out = [];
          for (let i = 0; i < len; i++) out.push(inner(v[i], depth + 1));
          return out;
        }
        if (t === "object") {
          if (state.seen.has(v)) return "[Circular]";
          state.seen.add(v);
          if (budget()) return "[MaxKeys]";
          const out = {};
          const keys = Object.keys(v);
          for (const k of keys) {
            if (budget()) break;
            state.keysUsed++;
            try { out[k] = inner(v[k], depth + 1); } catch { out[k] = "[Unclonable]"; }
          }
          return out;
        }
        try { return String(v); } catch { return "[Unclonable]"; }
      }
      return inner(value, 0);
    }

    function normalize(item) {
      if (item && typeof item === "object" && Object.prototype.toString.call(item) === "[object Arguments]")
        item = Array.from(item);
      if (Array.isArray(item)) {
        const [cmd, arg1, arg2] = item;
        if (cmd === "event") return { source: "gtag", type: "event", eventName: arg1, params: arg2 };
        if (cmd === "config") return { source: "gtag", type: "config", measurementId: arg1, params: arg2 };
        if (cmd === "set") return { source: "gtag", type: "set", params: arg1 };
        if (cmd === "js") return { source: "gtag", type: "js" };
        return { source: "gtag", type: "unknown", raw: item };
      }
      if (item && typeof item === "object")
        return { source: "dataLayer", type: "object", eventName: item.event || null, payload: item };
      return { source: "unknown", payload: item };
    }

    function post(payload) {
      window.__ferryEvents.push(safeClone(payload, LIMITS));
    }

    // Hook dataLayer.push
    window.dataLayer = window.dataLayer || [];
    const dl = window.dataLayer;
    if (!dl.__ferry_hooked) {
      dl.__ferry_hooked = true;
      const orig = dl.push.bind(dl);
      dl.push = function (...args) {
        args.forEach(item => {
          if (item && typeof item === "object" && Object.prototype.toString.call(item) === "[object Arguments]")
            item = Array.from(item);
          post(normalize(item));
        });
        return orig(...args);
      };
      // Backfill
      dl.forEach(item => {
        if (item && typeof item === "object" && Object.prototype.toString.call(item) === "[object Arguments]")
          item = Array.from(item);
        post(normalize(item));
      });
    }

    // Hook gtag
    const tryWrap = () => {
      if (typeof window.gtag !== "function") return false;
      if (window.gtag.__ferry_hooked) return true;
      const original = window.gtag;
      window.gtag = function (...args) {
        post({ source: "gtag", type: Array.isArray(args) && args[0], time: new Date().toISOString(), args });
        return original.apply(this, args);
      };
      window.gtag.__ferry_hooked = true;
      return true;
    };
    if (!tryWrap()) {
      const start = Date.now();
      const t = setInterval(() => {
        if (tryWrap() || Date.now() - start > 5000) clearInterval(t);
      }, 50);
    }
  });
}

/**
 * Drain all captured events from the page.
 */
async function drainEvents(page) {
  try {
    return await page.evaluate(() => {
      const events = window.__ferryEvents || [];
      window.__ferryEvents = [];
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
