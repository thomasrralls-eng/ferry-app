/**
 * Site Crawler — discovers and navigates all pages on a site,
 * capturing dataLayer events and network hits on each page.
 *
 * Runs in the service worker context. Controlled by the panel
 * via port messages.
 *
 * Flow:
 *   1. Panel sends FERRY_CRAWL_START with startUrl + maxPages
 *   2. Crawler navigates tab, waits for load, injects hook via scripting API
 *   3. After waiting for tags to fire, drains events + grabs <a> links
 *   4. Crawler queues same-origin links, navigates to next
 *   5. Repeats until queue empty or maxPages reached
 *   6. Sends progress updates and final report to panel
 */

const crawlStates = new Map(); // tabId -> crawl state

function createCrawlState(tabId, startUrl, maxPages) {
  const origin = new URL(startUrl).origin;
  return {
    tabId,
    startUrl,
    origin,
    maxPages: maxPages || 100,
    visited: new Set(),
    queue: [startUrl],
    currentUrl: null,
    running: false,
    pages: [],   // { url, events, network, findings, links, timestamp }
  };
}

/**
 * Start a crawl for a given tab.
 */
function startCrawl(tabId, startUrl, maxPages, panelPort) {
  // Stop any existing crawl for this tab
  stopCrawl(tabId);

  const state = createCrawlState(tabId, startUrl, maxPages);
  state.running = true;
  crawlStates.set(tabId, state);

  crawlNext(tabId, panelPort);
}

/**
 * Stop an in-progress crawl.
 */
function stopCrawl(tabId) {
  const state = crawlStates.get(tabId);
  if (state) {
    state.running = false;
  }
}

/**
 * Navigate to the next URL in the queue.
 */
async function crawlNext(tabId, panelPort) {
  const state = crawlStates.get(tabId);
  if (!state || !state.running) return;

  // Find next unvisited URL
  let nextUrl = null;
  while (state.queue.length > 0) {
    const candidate = state.queue.shift();
    if (!state.visited.has(candidate)) {
      nextUrl = candidate;
      break;
    }
  }

  if (!nextUrl || state.visited.size >= state.maxPages) {
    // Crawl complete
    state.running = false;
    panelPort.postMessage({
      type: "FERRY_CRAWL_COMPLETE",
      pages: state.pages,
      totalVisited: state.visited.size,
      totalQueued: state.queue.length,
    });
    return;
  }

  state.currentUrl = nextUrl;
  state.visited.add(nextUrl);

  // Create the page entry now so events captured during load get stored
  const pageEntry = {
    url: nextUrl,
    events: [],
    network: [],
    findings: [],
    links: [],
    timestamp: new Date().toISOString(),
  };
  state.pages.push(pageEntry);

  // Send progress to panel
  panelPort.postMessage({
    type: "FERRY_CRAWL_PROGRESS",
    currentUrl: nextUrl,
    visited: state.visited.size,
    queued: state.queue.length,
    maxPages: state.maxPages,
  });

  try {
    // Navigate the tab
    await chrome.tabs.update(tabId, { url: nextUrl });

    // Wait for page to finish loading
    await waitForPageLoad(tabId);

    // Inject our dataLayer/gtag hook directly into the page
    await injectHookViaScripting(tabId);

    // Wait for dataLayer / GTM / async tags to fire
    await sleep(3000);

    // Drain captured events from the page
    const events = await drainEventsViaScripting(tabId);
    pageEntry.events = events;

    // Grab all <a> links directly from the page via scripting API
    const links = await getLinksViaScripting(tabId);
    const newLinks = filterLinks(links, state.origin, state.visited);
    state.queue.push(...newLinks);
    pageEntry.links = newLinks;

    // Check if crawl was stopped while we were waiting
    if (!state.running) return;

    // Move to next page
    setTimeout(() => crawlNext(tabId, panelPort), 300);

  } catch (e) {
    // Navigation failed — report and continue
    panelPort.postMessage({
      type: "FERRY_CRAWL_ERROR",
      url: nextUrl,
      error: e.message,
    });

    if (state.running) {
      setTimeout(() => crawlNext(tabId, panelPort), 300);
    }
  }
}

/**
 * Inject the Ferry dataLayer/gtag hook into the page via chrome.scripting.
 *
 * This is the same hook logic from injected-hook.js but executed directly
 * into the page's MAIN world so it can intercept window.dataLayer.push()
 * and window.gtag() calls. We use the MAIN world because the default
 * ISOLATED world can't access page JS globals.
 */
async function injectHookViaScripting(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        if (window.__ferryHooked) return;
        window.__ferryHooked = true;
        window.__ferryEvents = [];

        const DEFAULT_LIMITS = { maxDepth: 6, maxKeys: 200, maxArray: 200 };

        function safeClone(value, opts, state) {
          if (!state) state = { seen: new WeakSet(), keysUsed: 0 };
          const { maxDepth, maxKeys, maxArray } = opts;
          function budgetCheck() { return state.keysUsed >= maxKeys; }
          function cloneInner(v, depth) {
            const t = typeof v;
            if (v == null || t === "string" || t === "number" || t === "boolean") return v;
            if (depth > maxDepth) return "[MaxDepth]";
            if (t === "bigint") return v.toString();
            if (t === "symbol") return v.toString();
            if (t === "function") return "[Function]";
            if (v instanceof Date) return v.toISOString();
            if (v instanceof Error) return { name: v.name, message: v.message };
            if (Array.isArray(v)) {
              if (budgetCheck()) return "[MaxKeys]";
              const len = Math.min(v.length, maxArray);
              const out = new Array(len);
              for (let i = 0; i < len; i++) out[i] = cloneInner(v[i], depth + 1);
              return out;
            }
            if (t === "object") {
              if (state.seen.has(v)) return "[Circular]";
              state.seen.add(v);
              if (budgetCheck()) return "[MaxKeys]";
              const out = {};
              const keys = Object.keys(v);
              for (let i = 0; i < keys.length; i++) {
                if (budgetCheck()) break;
                state.keysUsed += 1;
                try { out[keys[i]] = cloneInner(v[keys[i]], depth + 1); }
                catch { out[keys[i]] = "[Unclonable]"; }
              }
              return out;
            }
            try { return String(v); } catch { return "[Unclonable]"; }
          }
          return cloneInner(value, 0);
        }

        function normalizeItem(item) {
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
          window.__ferryEvents.push(safeClone(payload, DEFAULT_LIMITS));
        }

        // Hook dataLayer.push
        window.dataLayer = window.dataLayer || [];
        const dl = window.dataLayer;
        if (!dl.__ferry_hooked) {
          dl.__ferry_hooked = true;
          const originalPush = dl.push.bind(dl);
          dl.push = function (...args) {
            args.forEach(item => {
              if (item && typeof item === "object" && Object.prototype.toString.call(item) === "[object Arguments]")
                item = Array.from(item);
              post(normalizeItem(item));
            });
            return originalPush(...args);
          };
          // Backfill existing items
          dl.forEach(item => {
            if (item && typeof item === "object" && Object.prototype.toString.call(item) === "[object Arguments]")
              item = Array.from(item);
            post(normalizeItem(item));
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
      },
    });
  } catch (e) {
    // May fail on chrome:// or restricted pages — that's fine
  }
}

/**
 * Drain all captured events from window.__ferryEvents on the page.
 * Returns the array and resets it to empty.
 */
async function drainEventsViaScripting(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        const events = window.__ferryEvents || [];
        window.__ferryEvents = [];
        window.__ferryHooked = false; // Allow re-hook on next page
        return JSON.parse(JSON.stringify(events)); // ensure serializable
      },
    });
    return results?.[0]?.result || [];
  } catch (e) {
    return [];
  }
}

/**
 * Grab all <a href> links from the page using chrome.scripting.executeScript.
 *
 * This is far more reliable than chrome.tabs.sendMessage because it doesn't
 * depend on the content script being re-injected and ready after navigation.
 * The scripting API injects directly into the page's main world.
 */
async function getLinksViaScripting(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return Array.from(document.querySelectorAll("a[href]"))
          .map(a => {
            try { return new URL(a.href, location.href).href; }
            catch { return null; }
          })
          .filter(Boolean);
      },
    });
    return results?.[0]?.result || [];
  } catch (e) {
    // Scripting failed (e.g. chrome:// pages, restricted URLs)
    return [];
  }
}

/**
 * Wait for a tab to finish loading.
 */
function waitForPageLoad(tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000); // max 15s per page

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Filter discovered links to same-origin, unvisited, relevant pages.
 */
function filterLinks(links, origin, visited) {
  const filtered = [];
  const seen = new Set(visited);

  for (const link of links) {
    try {
      const url = new URL(link);

      // Only http/https
      if (!url.protocol.startsWith("http")) continue;

      // Same origin only
      if (url.origin !== origin) continue;

      // Strip hash fragments
      url.hash = "";
      const clean = url.toString();

      // Skip already visited or queued
      if (seen.has(clean)) continue;

      // Skip non-page resources
      const ext = url.pathname.split(".").pop()?.toLowerCase();
      const skipExts = ["jpg", "jpeg", "png", "gif", "svg", "webp", "pdf",
                        "zip", "css", "js", "woff", "woff2", "ttf", "ico",
                        "mp4", "mp3", "avi", "mov", "xml", "json", "rss"];
      if (skipExts.includes(ext)) continue;

      // Skip common non-content paths
      const skipPaths = ["/wp-admin", "/wp-json", "/api/", "/graphql",
                         "/cart", "/checkout", "/account/login",
                         "/cdn-cgi/", "/_next/", "/static/"];
      if (skipPaths.some(p => url.pathname.startsWith(p))) continue;

      seen.add(clean);
      filtered.push(clean);
    } catch {
      // Invalid URL — skip
    }
  }

  return filtered;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Export for use in service-worker.js via importScripts
if (typeof globalThis !== "undefined") {
  globalThis.FerryCrawler = { startCrawl, stopCrawl, crawlStates };
}
