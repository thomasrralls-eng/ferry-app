/**
 * wait-strategy.js — Smart wait for dataLayer / GA4 events to stabilize.
 *
 * The extension crawler uses a flat `sleep(3000)` which misses late-firing
 * tags on slow sites and wastes time on fast sites. The cloud scraper
 * is smarter:
 *
 *   1. After DOMContentLoaded, inject the Ferry hook
 *   2. Poll `window.__ferryEvents` every 250ms
 *   3. Wait until the event count stabilizes (no new events for 1.5s)
 *   4. Hard timeout at 10s — move on regardless
 *
 * This captures lazy-loaded GTM containers, deferred gtag calls,
 * and async consent-gated tags while keeping fast pages fast.
 */

const DEFAULT_OPTIONS = {
  pollIntervalMs: 250,       // How often to check for new events
  stabilityWindowMs: 1500,   // No new events for this long = stable
  hardTimeoutMs: 10000,      // Move on after this regardless
  minWaitMs: 1000,           // Always wait at least this long (tags need time to init)
};

/**
 * Wait for the dataLayer to stabilize on a Puppeteer page.
 *
 * @param {import('puppeteer').Page} page - Puppeteer page instance
 * @param {Object} [options] - Override default timing options
 * @returns {Promise<WaitResult>}
 */
export async function waitForDataLayer(page, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();

  // Ensure minimum wait
  await sleep(opts.minWaitMs);

  let lastCount = 0;
  let lastChangeTime = Date.now();
  let stableCount = 0;

  while (true) {
    const elapsed = Date.now() - startTime;

    // Hard timeout
    if (elapsed >= opts.hardTimeoutMs) {
      return {
        stable: false,
        reason: "timeout",
        waitedMs: elapsed,
        eventCount: lastCount,
      };
    }

    // Poll event count from page context
    let currentCount;
    try {
      currentCount = await page.evaluate(() => {
        return (window.__ferryEvents || []).length;
      });
    } catch {
      // Page might have navigated or crashed
      return {
        stable: false,
        reason: "page-error",
        waitedMs: elapsed,
        eventCount: lastCount,
      };
    }

    if (currentCount > lastCount) {
      // New events arrived — reset stability window
      lastCount = currentCount;
      lastChangeTime = Date.now();
      stableCount = 0;
    } else {
      stableCount++;
    }

    // Check stability: no new events for stabilityWindowMs
    const timeSinceChange = Date.now() - lastChangeTime;
    if (timeSinceChange >= opts.stabilityWindowMs && lastCount > 0) {
      return {
        stable: true,
        reason: "stabilized",
        waitedMs: Date.now() - startTime,
        eventCount: lastCount,
      };
    }

    // Also consider stable if we've waited a long time with zero events
    // (site might not have GA4/GTM at all)
    if (elapsed > opts.hardTimeoutMs * 0.6 && lastCount === 0) {
      return {
        stable: true,
        reason: "no-events",
        waitedMs: elapsed,
        eventCount: 0,
      };
    }

    await sleep(opts.pollIntervalMs);
  }
}

/**
 * Check if the page has a dataLayer or gtag defined.
 * Useful for quick detection before waiting.
 *
 * @param {import('puppeteer').Page} page
 * @returns {Promise<AnalyticsPresence>}
 */
export async function detectAnalyticsPresence(page) {
  try {
    return await page.evaluate(() => {
      const hasDataLayer = Array.isArray(window.dataLayer) && window.dataLayer.length > 0;
      const hasGtag = typeof window.gtag === "function";
      const hasGtm = !!document.querySelector('script[src*="googletagmanager.com/gtm.js"]');
      const hasGtagJs = !!document.querySelector('script[src*="googletagmanager.com/gtag/js"]');

      // Extract measurement IDs from gtag config calls
      const measurementIds = [];
      if (hasDataLayer) {
        for (const item of window.dataLayer) {
          if (Array.isArray(item) && item[0] === "config" && typeof item[1] === "string") {
            measurementIds.push(item[1]);
          }
        }
      }

      // Check for Google Ads conversion tags
      const hasGoogleAds = !!document.querySelector('script[src*="googleadservices.com"]') ||
                           !!document.querySelector('script[src*="gtag/js?id=AW-"]');

      return {
        hasDataLayer,
        hasGtag,
        hasGtm,
        hasGtagJs,
        hasGoogleAds,
        measurementIds,
        dataLayerLength: hasDataLayer ? window.dataLayer.length : 0,
      };
    });
  } catch {
    return {
      hasDataLayer: false,
      hasGtag: false,
      hasGtm: false,
      hasGtagJs: false,
      hasGoogleAds: false,
      measurementIds: [],
      dataLayerLength: 0,
    };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export { DEFAULT_OPTIONS };
