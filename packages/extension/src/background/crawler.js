/**
 * Site Crawler — discovers and navigates all pages on a site,
 * capturing dataLayer events and network hits on each page.
 *
 * Runs in the service worker context. Controlled by the panel
 * via port messages.
 *
 * Flow:
 *   1. Panel sends FAIRY_CRAWL_START with startUrl + maxPages
 *   2. Crawler fetches robots.txt, then begins crawl loop
 *   3. Per page: navigate → wait for load → inject hook (from fairy-hook.js)
 *      → smart stability wait → drain events + links
 *   4. Queues same-origin links; respects robots.txt and safe-mode skip paths
 *   5. Applies crawl delay between pages (default 1500ms, respects Crawl-Delay)
 *   6. Sends FAIRY_CRAWL_PROGRESS updates and final FAIRY_CRAWL_COMPLETE to panel
 *
 * The network hits (GA4 /collect, GTM script loads) are buffered directly
 * into each page entry by service-worker.js's webRequest listener.
 */

// fairy-hook.js is inlined before this content by the vite.config.js build step,
// so globalThis.fairyHookFn is already available here.

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_CRAWL_DELAY_MS = 1500; // between pages (polite default)
const MAX_PAGES_CAP = 100;           // hard cap regardless of user input

/**
 * Paths always skipped in safe-mode crawls.
 * Audit crawls are passive observers — they must not trigger purchases,
 * form submissions, account mutations, or destructive operations.
 */
const SAFE_SKIP_PATHS = [
  // Admin / internal tools
  "/wp-admin", "/wp-json", "/admin/", "/dashboard/",
  // APIs and static assets
  "/api/", "/graphql", "/cdn-cgi/", "/_next/", "/static/",
  // Authentication
  "/account/", "/sign-in", "/signin", "/signup", "/sign-up",
  "/login", "/register", "/logout", "/auth/",
  // Commerce — skip to avoid accidental order creation
  "/cart", "/checkout", "/payment", "/billing",
  "/order/", "/orders/", "/purchase",
  // Destructive / irreversible
  "/unsubscribe", "/delete", "/remove",
];

// ── Crawl state ───────────────────────────────────────────────────────────────

const crawlStates = new Map(); // tabId → crawl state

function createCrawlState(tabId, startUrl, maxPages) {
  const origin = new URL(startUrl).origin;
  return {
    tabId,
    startUrl,
    origin,
    maxPages: Math.min(maxPages || 50, MAX_PAGES_CAP),
    crawlDelayMs: DEFAULT_CRAWL_DELAY_MS,
    robotsPolicy: null,   // set after fetchRobotsTxt resolves
    visited: new Set(),
    queue: [startUrl],
    currentUrl: null,
    running: false,
    pages: [],  // { url, events, network, findings, links, timestamp }
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start a new crawl. Fetches robots.txt first, then begins navigation loop.
 */
async function startCrawl(tabId, startUrl, maxPages, panelPort) {
  stopCrawl(tabId);

  const state = createCrawlState(tabId, startUrl, maxPages);
  state.running = true;
  crawlStates.set(tabId, state);

  // Fetch robots.txt before first navigation; start with permissive policy
  state.robotsPolicy = makePermissivePolicy();
  const robots = await fetchRobotsTxt(new URL(startUrl).origin);
  if (!state.running) return; // stopped while fetching

  state.robotsPolicy = robots;
  // Honour Crawl-Delay from robots.txt (never go faster than our default)
  if (robots.crawlDelayMs) {
    state.crawlDelayMs = Math.max(state.crawlDelayMs, robots.crawlDelayMs);
  }

  crawlNext(tabId, panelPort);
}

function stopCrawl(tabId) {
  const state = crawlStates.get(tabId);
  if (state) state.running = false;
}

// ── Crawl loop ────────────────────────────────────────────────────────────────

async function crawlNext(tabId, panelPort) {
  const state = crawlStates.get(tabId);
  if (!state || !state.running) return;

  // Pick next URL: unvisited AND allowed by robots.txt
  let nextUrl = null;
  while (state.queue.length > 0) {
    const candidate = state.queue.shift();
    if (state.visited.has(candidate)) continue;
    if (!state.robotsPolicy.isAllowed(candidate)) continue;
    nextUrl = candidate;
    break;
  }

  if (!nextUrl || state.visited.size >= state.maxPages) {
    state.running = false;
    panelPort.postMessage({
      type: "FAIRY_CRAWL_COMPLETE",
      pages: state.pages,
      totalVisited: state.visited.size,
      totalQueued: state.queue.length,
    });
    return;
  }

  state.currentUrl = nextUrl;
  state.visited.add(nextUrl);

  // Create the page entry immediately so the webRequest listener can buffer
  // network hits (GA4 /collect, GTM script loads) into it in real time.
  const pageEntry = {
    url: nextUrl,
    events: [],
    network: [],   // filled by service-worker.js webRequest listener
    findings: [],
    links: [],
    timestamp: new Date().toISOString(),
  };
  state.pages.push(pageEntry);

  panelPort.postMessage({
    type: "FAIRY_CRAWL_PROGRESS",
    currentUrl: nextUrl,
    visited: state.visited.size,
    queued: state.queue.length,
    maxPages: state.maxPages,
  });

  try {
    // Navigate
    await chrome.tabs.update(tabId, { url: nextUrl });
    await waitForPageLoad(tabId);

    // Inject the Ferry hook (from fairy-hook.js via globalThis.fairyHookFn)
    await injectHookViaScripting(tabId);

    // Also patch history.pushState so virtual SPA navigations are tracked
    await injectSPAHook(tabId);

    // Smart wait: poll for dataLayer stability instead of a fixed sleep
    await waitForEventStability(tabId);

    // Click obvious interactive elements (accordions, tabs, etc.) so that
    // interaction-gated tags fire, simulating real user journeys
    await interactWithPageElements(tabId);

    // Secondary wait: let any interaction-triggered events settle
    await waitForEventStability(tabId, { minWaitMs: 200, hardTimeoutMs: 2500, stabilityWindowMs: 800 });

    // Drain all captured events
    pageEntry.events = await drainEventsViaScripting(tabId);

    // Collect links for the crawl queue
    const links = await getLinksViaScripting(tabId);
    const newLinks = filterLinks(links, state.origin, state.visited);
    state.queue.push(...newLinks);
    pageEntry.links = newLinks;

    if (!state.running) return;

    // Polite delay between pages (crawl policy)
    setTimeout(() => crawlNext(tabId, panelPort), state.crawlDelayMs);

  } catch (e) {
    panelPort.postMessage({ type: "FAIRY_CRAWL_ERROR", url: nextUrl, error: e.message });
    if (state.running) {
      setTimeout(() => crawlNext(tabId, panelPort), state.crawlDelayMs);
    }
  }
}

// ── Hook injection ────────────────────────────────────────────────────────────

/**
 * Inject fairyHookFn (from fairy-hook.js) into the page's MAIN world.
 *
 * MAIN world is required to access window.dataLayer and window.gtag —
 * the default ISOLATED world cannot see page JS globals.
 */
async function injectHookViaScripting(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: globalThis.fairyHookFn, // defined in fairy-hook.js via importScripts
    });
  } catch {
    // chrome:// pages, restricted origins — silently skip
  }
}

/**
 * Inject the SPA history patch into the page's MAIN world.
 *
 * Patches history.pushState and history.replaceState so the crawler
 * can detect virtual pageview navigations on single-page apps and
 * extend the stability wait if a route change happens mid-wait.
 *
 * Note: fairyHookFn already patches history — this is a guard in case
 * the hook was skipped or window.__fairyHooked was already true from
 * a previous navigation on a persistent SPA tab.
 */
async function injectSPAHook(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        if (history.__fairy_hooked) return;
        history.__fairy_hooked = true;
        window.__fairySPAChanges = window.__fairySPAChanges || [];

        const patch = (method) => {
          const orig = history[method];
          history[method] = function (...args) {
            const result = orig.apply(this, args);
            window.__fairySPAChanges.push({ method, url: location.href, ts: Date.now() });
            return result;
          };
        };
        patch("pushState");
        patch("replaceState");
      },
    });
  } catch {}
}

// ── Smart stability wait ──────────────────────────────────────────────────────

/**
 * Replace the old fixed sleep(3000) with a polling stability check.
 *
 * Strategy (mirrors the cloud scraper's wait-strategy.js):
 *   1. Wait at least minWaitMs (tags need time to initialise)
 *   2. Poll window.__fairyEvents.length every pollIntervalMs
 *   3. Return when event count has been stable for stabilityWindowMs
 *   4. Hard timeout at hardTimeoutMs regardless
 *   5. Early exit if no events after 60% of hardTimeoutMs
 *      (site may not have GA4/GTM at all)
 *
 * Also checks window.__fairySPAChanges — if a virtual route change fires
 * during the wait, the stability clock is reset to capture route-level events.
 */
async function waitForEventStability(tabId, opts = {}) {
  const {
    pollIntervalMs    = 250,
    stabilityWindowMs = 1500,
    hardTimeoutMs     = 8000,
    minWaitMs         = 800,
  } = opts;

  const startTime = Date.now();
  await sleep(minWaitMs);

  let lastEventCount  = 0;
  let lastSPACount    = 0;
  let lastChangeTime  = Date.now();

  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= hardTimeoutMs) break;

    let currentEvents = 0;
    let currentSPA    = 0;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: () => ({
          events: (window.__fairyEvents    || []).length,
          spa:    (window.__fairySPAChanges || []).length,
        }),
      });
      const counts = results?.[0]?.result;
      if (counts) { currentEvents = counts.events; currentSPA = counts.spa; }
    } catch {
      break; // Page navigated or crashed — stop waiting
    }

    // Any change (new events OR a new SPA route change) resets the stability clock
    if (currentEvents > lastEventCount || currentSPA > lastSPACount) {
      lastEventCount = currentEvents;
      lastSPACount   = currentSPA;
      lastChangeTime = Date.now();
    }

    const timeSinceChange = Date.now() - lastChangeTime;

    // Stable: nothing new for the stability window
    if (timeSinceChange >= stabilityWindowMs && lastEventCount > 0) break;

    // Early exit: no events at all well past minWait (no GA/GTM on page)
    if (elapsed > hardTimeoutMs * 0.6 && lastEventCount === 0) break;

    await sleep(pollIntervalMs);
  }
}

// ── Event drain ───────────────────────────────────────────────────────────────

async function drainEventsViaScripting(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        const events = window.__fairyEvents || [];
        window.__fairyEvents = [];
        window.__fairyHooked = false; // allow re-hook on next page
        return JSON.parse(JSON.stringify(events));
      },
    });
    return results?.[0]?.result || [];
  } catch {
    return [];
  }
}

// ── Link extraction ───────────────────────────────────────────────────────────

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
  } catch {
    return [];
  }
}

// ── Page load wait ────────────────────────────────────────────────────────────

function waitForPageLoad(tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);

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

// ── Link filtering ────────────────────────────────────────────────────────────

/**
 * Filter discovered links to same-origin, unvisited, audit-safe pages.
 *
 * Uses SAFE_SKIP_PATHS to avoid triggering forms, purchases, auth flows,
 * or any other destructive/side-effectful page. An audit crawl is a
 * passive observer only.
 */
function filterLinks(links, origin, visited) {
  const filtered = [];
  const seen = new Set(visited);

  for (const link of links) {
    try {
      const url = new URL(link);

      if (!url.protocol.startsWith("http")) continue;
      if (url.origin !== origin) continue;

      url.hash = "";
      const clean = url.toString();
      if (seen.has(clean)) continue;

      // Skip non-page file extensions
      const ext = url.pathname.split(".").pop()?.toLowerCase();
      const skipExts = [
        "jpg", "jpeg", "png", "gif", "svg", "webp", "avif",
        "pdf", "zip", "gz", "tar",
        "css", "js", "mjs",
        "woff", "woff2", "ttf", "eot", "ico",
        "mp4", "mp3", "avi", "mov", "webm",
        "xml", "json", "rss", "atom",
      ];
      if (skipExts.includes(ext)) continue;

      // Skip safe-mode paths (audit-safe policy)
      const pathLower = url.pathname.toLowerCase();
      if (SAFE_SKIP_PATHS.some(p => pathLower.startsWith(p))) continue;

      seen.add(clean);
      filtered.push(clean);
    } catch {
      // Invalid URL — skip
    }
  }

  return filtered;
}

// ── Robots.txt ────────────────────────────────────────────────────────────────

/**
 * Fetch and parse robots.txt for an origin.
 * Returns a policy object with isAllowed(url) and optional crawlDelayMs.
 *
 * Matches GdFairyBot-specific rules first, then falls back to the wildcard
 * User-agent: * block. Permissive if robots.txt is unreachable.
 */
async function fetchRobotsTxt(origin) {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "DataFairyBot/1.0 (+https://datafairy.ai/bot)" },
    });
    if (!res.ok) return makePermissivePolicy();
    const text = await res.text();
    return parseRobotsTxt(text);
  } catch {
    return makePermissivePolicy();
  }
}

function parseRobotsTxt(text) {
  // Collect rules for all user-agent blocks; prefer bot-specific over wildcard
  const blocks = [];   // [ { agents: string[], disallowed: string[], crawlDelay: number|null } ]
  let current = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;

    const field = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (field === "user-agent") {
      if (!current || current.disallowed.length > 0 || current.crawlDelay !== null) {
        current = { agents: [], disallowed: [], crawlDelay: null };
        blocks.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current) {
      if (field === "disallow" && value) current.disallowed.push(value);
      if (field === "allow")    {} // Allow overrides not needed for audit-safe crawl
      if (field === "crawl-delay") {
        const d = parseFloat(value);
        if (!isNaN(d)) current.crawlDelay = d;
      }
    }
  }

  // Find the most-specific applicable block
  const botBlock      = blocks.find(b => b.agents.some(a => a.includes("datafairy")));
  const wildcardBlock = blocks.find(b => b.agents.includes("*"));
  const applicable    = botBlock || wildcardBlock || null;

  if (!applicable) return makePermissivePolicy();

  return {
    isAllowed(url) {
      try {
        const path = new URL(url).pathname;
        return !applicable.disallowed.some(d => matchRobotsPath(d, path));
      } catch { return true; }
    },
    crawlDelayMs: applicable.crawlDelay
      ? Math.max(applicable.crawlDelay * 1000, 1000)
      : null,
  };
}

function matchRobotsPath(pattern, path) {
  if (pattern === "/") return true; // Disallow: / means block everything

  if (!pattern.includes("*") && !pattern.endsWith("$")) {
    return path.startsWith(pattern);
  }

  // Convert robots.txt glob pattern to a regex
  const regexStr = pattern
    .replace(/[.+?^{}()|[\]\\]/g, "\\$&")  // escape regex specials (not * or $)
    .replace(/\*/g, ".*")                   // * → .*
    .replace(/\$$/, "$");                   // trailing $ = end-of-string anchor
  try {
    return new RegExp("^" + regexStr).test(path);
  } catch {
    return path.startsWith(pattern.split("*")[0]);
  }
}

function makePermissivePolicy() {
  return { isAllowed: () => true, crawlDelayMs: null };
}

// ── Interaction simulation ────────────────────────────────────────────────────

/**
 * Click obvious, safe interactive elements on the current page to trigger
 * interaction-gated analytics events (e.g. accordion-expand, tab-switch).
 *
 * Candidate sources (in order of specificity):
 *   1. [aria-expanded="false"]                  — any collapsed ARIA toggle
 *   2. [data-bs-toggle="collapse"|"tab"|"dropdown"] — Bootstrap 5 patterns
 *   3. [data-toggle="collapse"|"tab"|"dropdown"]    — Bootstrap 4 patterns
 *   4. .accordion-button.collapsed               — Bootstrap accordion
 *   5. [role="tab"]:not([aria-selected="true"])  — ARIA tab panels
 *   6. details:not([open]) > summary             — native disclosure widgets
 *   7. [aria-haspopup]:not([aria-expanded="true"]) — nav dropdown triggers
 *
 * Safety guards:
 *   • Deduplicates candidates so each element is only clicked once
 *   • Checks Bootstrap collapse target: skips if already expanded (.show/.in)
 *   • Skips elements whose text / aria-label / title contains purchase, auth,
 *     or destructive keywords
 *   • Skips elements with display:none / visibility:hidden / opacity:0
 *   • Skips elements with zero rendered size (not just off-viewport)
 *   • Skips plain <a href="…"> links that would navigate away
 *   • Skips native form controls
 *   • Caps at MAX_INTERACTIONS clicks so the page doesn't spin forever
 *
 * Runs in MAIN world (needed to fire real click handlers that touch window.*).
 */
async function interactWithPageElements(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        const MAX_INTERACTIONS = 10;

        // Words whose presence in an element's label make it unsafe to click
        const UNSAFE_RE = /\b(buy|checkout|check.?out|cart|purchase|add.?to.?cart|order|submit|login|log.?in|sign.?up|sign.?in|register|delete|remove|cancel|unsubscribe|pay(ment|\.?now)?|subscribe)\b/i;

        // Deduplicated candidate list
        const seen = new Set();
        const candidates = [];
        function addCandidate(el) {
          if (el && !seen.has(el)) { seen.add(el); candidates.push(el); }
        }

        // Helper: is a Bootstrap collapse target currently hidden?
        function bootstrapTargetIsCollapsed(el, targetAttr, expandedClass) {
          const sel = el.getAttribute(targetAttr) || el.getAttribute("href");
          if (!sel) return true; // can't tell — include it anyway
          try {
            const target = document.querySelector(sel);
            return !target || !target.classList.contains(expandedClass);
          } catch { return true; }
        }

        // ── 1. ARIA aria-expanded="false" (any block-level / interactive tag) ──
        document.querySelectorAll('[aria-expanded="false"]').forEach(el => {
          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute("role");
          if (["button", "a", "div", "span", "li", "h1", "h2", "h3", "h4"].includes(tag)
              || role === "button" || role === "tab") {
            addCandidate(el);
          }
        });

        // ── 2. Bootstrap 5 collapse (data-bs-toggle="collapse") ───────────────
        document.querySelectorAll('[data-bs-toggle="collapse"]').forEach(el => {
          if (bootstrapTargetIsCollapsed(el, "data-bs-target", "show")) addCandidate(el);
        });

        // ── 3. Bootstrap 4 collapse (data-toggle="collapse") ─────────────────
        document.querySelectorAll('[data-toggle="collapse"]').forEach(el => {
          if (bootstrapTargetIsCollapsed(el, "data-target", "in")) addCandidate(el);
        });

        // ── 4. Bootstrap accordion buttons with .collapsed class ──────────────
        document.querySelectorAll(".accordion-button.collapsed").forEach(addCandidate);

        // ── 5. Bootstrap 5 tab triggers ───────────────────────────────────────
        document.querySelectorAll('[data-bs-toggle="tab"]:not(.active)').forEach(addCandidate);

        // ── 6. Bootstrap 4 tab triggers ───────────────────────────────────────
        document.querySelectorAll('[data-toggle="tab"]:not(.active)').forEach(addCandidate);

        // ── 7. ARIA role="tab" (inactive) ─────────────────────────────────────
        document.querySelectorAll('[role="tab"]:not([aria-selected="true"])').forEach(addCandidate);

        // ── 8. Native HTML disclosure widgets ─────────────────────────────────
        document.querySelectorAll("details:not([open]) > summary").forEach(addCandidate);

        // ── 9. Navigation dropdown triggers (aria-haspopup) ───────────────────
        // Only buttons/role=button — avoids triggering link navigations
        document.querySelectorAll('[aria-haspopup]:not([aria-expanded="true"])').forEach(el => {
          const tag = el.tagName.toLowerCase();
          if (tag === "button" || el.getAttribute("role") === "button") addCandidate(el);
        });

        // ── Visibility helper ─────────────────────────────────────────────────
        function isRendered(el) {
          // Must have non-zero rendered size (catches display:none, collapsed height)
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return false;
          try {
            const s = window.getComputedStyle(el);
            return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
          } catch { return false; }
        }

        // ── Click loop ────────────────────────────────────────────────────────
        let clicked = 0;
        for (const el of candidates) {
          if (clicked >= MAX_INTERACTIONS) break;

          if (!isRendered(el)) continue;

          // Skip elements with unsafe text / aria-label / title
          const label = [
            el.textContent,
            el.getAttribute("aria-label"),
            el.getAttribute("title"),
          ].filter(Boolean).join(" ").trim();
          if (UNSAFE_RE.test(label)) continue;

          // Skip native form controls
          const tag = el.tagName.toLowerCase();
          if (["input", "select", "textarea", "form"].includes(tag)) continue;

          // Skip anchors with real hrefs — they would navigate away
          if (tag === "a") {
            const href = (el.getAttribute("href") || "").trim();
            if (href && !href.startsWith("#") && !href.startsWith("javascript")) continue;
          }

          try {
            el.click();
            clicked++;
          } catch { /* element removed mid-loop */ }
        }

        return clicked;
      },
    });
  } catch {
    // Page navigated, crashed, or restricted origin — silently skip
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Module export ─────────────────────────────────────────────────────────────

if (typeof globalThis !== "undefined") {
  globalThis.FairyCrawler = { startCrawl, stopCrawl, crawlStates };
}
