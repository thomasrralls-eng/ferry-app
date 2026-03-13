/**
 * report.js — Assemble a full data quality report from crawl results.
 *
 * Runs the lint rules engine on all captured events and produces
 * the same analysis report structure that the Chrome extension uses,
 * with additional scraper-specific findings (pages with no tracking,
 * inconsistent tracking across page types, etc.).
 */

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { readFileSync } from "fs";
import vm from "vm";

/**
 * Load the lint rules engine from the extension package.
 *
 * The extension uses `"type": "module"` in its package.json, which makes Node
 * treat all .js files as ESM — but rules/index.js uses `module.exports` (CJS).
 * This means `require()` returns an empty object and `import()` fails.
 * We use vm.runInNewContext to load it correctly regardless of package type.
 */
let _lintSession = null;
let _detectGA4Version = null;

async function loadRules() {
  if (_lintSession) return { lintSession: _lintSession, detectGA4Version: _detectGA4Version };

  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const rulesPath = resolve(__dirname, "..", "..", "extension", "src", "rules", "index.js");

    const code = readFileSync(rulesPath, "utf8");
    const sandbox = {
      module: { exports: {} },
      exports: {},
      console,
      setTimeout, URL, Set, Map, Array, Object, Math, RegExp, JSON, String, Number, Date, Error, TypeError, Promise,
    };
    vm.runInNewContext(code, sandbox, { filename: rulesPath, timeout: 5000 });

    _lintSession = sandbox.module.exports.lintSession;
    _detectGA4Version = sandbox.module.exports.detectGA4Version;

    if (!_lintSession) {
      console.warn("[fairy-scraper] Lint rules loaded but lintSession not found in exports");
    }

    return { lintSession: _lintSession, detectGA4Version: _detectGA4Version };
  } catch (err) {
    console.error("[fairy-scraper] Could not load lint rules:", err.message);
    return { lintSession: null, detectGA4Version: null };
  }
}

/**
 * Generate a full data quality report from crawl results.
 *
 * @param {Object} crawlReport - Output from deepCrawl()
 * @param {Object} [reconReport] - Output from reconScan() (optional, adds context)
 * @returns {Promise<FullReport>}
 */
export async function generateReport(crawlReport, reconReport = null) {
  const { lintSession, detectGA4Version } = await loadRules();

  // Collect all events and network hits across pages
  const allEvents = [];
  const allNetworkHits = [];
  const pageResults = [];

  for (const page of crawlReport.pages) {
    const pageEvents = page.events || [];
    const pageHits = page.networkHits || [];

    // Tag each event with its source page
    for (const evt of pageEvents) {
      evt._pageUrl = page.url;
      evt._pageType = page.classification?.type || "unknown";
      allEvents.push(evt);
    }
    allNetworkHits.push(...pageHits);

    pageResults.push({
      url: page.url,
      pageType: page.classification?.type || "unknown",
      confidence: page.classification?.confidence || 0,
      eventCount: pageEvents.length,
      networkHitCount: pageHits.length,
      loadTime: page.loadTime,
      hasAnalytics: !!(page.analyticsPresence?.hasGtm || page.analyticsPresence?.hasGtagJs),
      error: page.error,
    });
  }

  // ── Lint all events ──
  let lintResult = null;
  let ga4Version = { version: "free", hints: [] };

  if (lintSession) {
    lintResult = lintSession(allEvents, { networkHits: allNetworkHits });
    ga4Version = lintResult.ga4Version || ga4Version;
  }

  // ── Scraper-specific findings ──
  const scraperFindings = [];

  // Pages with no analytics at all
  const pagesWithoutAnalytics = pageResults.filter(p => !p.hasAnalytics && !p.error);
  if (pagesWithoutAnalytics.length > 0) {
    scraperFindings.push({
      type: "no-analytics",
      severity: "error",
      title: `${pagesWithoutAnalytics.length} page${pagesWithoutAnalytics.length !== 1 ? "s" : ""} have no analytics`,
      detail: "These pages don't have GTM or gtag.js installed. No data is being collected.",
      pages: pagesWithoutAnalytics.map(p => p.url),
    });
  }

  // Pages with no events (analytics loaded but nothing fires)
  const pagesWithAnalyticsButNoEvents = pageResults.filter(
    p => p.hasAnalytics && p.eventCount === 0 && !p.error
  );
  if (pagesWithAnalyticsButNoEvents.length > 0) {
    scraperFindings.push({
      type: "analytics-no-events",
      severity: "warning",
      title: `${pagesWithAnalyticsButNoEvents.length} page${pagesWithAnalyticsButNoEvents.length !== 1 ? "s" : ""} have analytics but no events fired`,
      detail: "GTM/gtag.js is present but no events were captured within the wait window. Tags may be misconfigured.",
      pages: pagesWithAnalyticsButNoEvents.map(p => p.url),
    });
  }

  // Inconsistent tracking across page types
  const trackingByPageType = {};
  for (const p of pageResults) {
    if (!trackingByPageType[p.pageType]) {
      trackingByPageType[p.pageType] = { withEvents: 0, withoutEvents: 0 };
    }
    if (p.eventCount > 0) trackingByPageType[p.pageType].withEvents++;
    else trackingByPageType[p.pageType].withoutEvents++;
  }

  const inconsistentTypes = Object.entries(trackingByPageType)
    .filter(([, counts]) => counts.withEvents > 0 && counts.withoutEvents > 0);
  if (inconsistentTypes.length > 0) {
    scraperFindings.push({
      type: "inconsistent-tracking",
      severity: "warning",
      title: "Inconsistent tracking across page types",
      detail: inconsistentTypes.map(
        ([type, c]) => `${type}: ${c.withEvents} pages with events, ${c.withoutEvents} without`
      ).join("; "),
    });
  }

  // Pages blocked by robots.txt
  if (crawlReport.skippedByRobots?.length > 0) {
    scraperFindings.push({
      type: "robots-blocked",
      severity: "info",
      title: `${crawlReport.skippedByRobots.length} URL${crawlReport.skippedByRobots.length !== 1 ? "s" : ""} blocked by robots.txt`,
      detail: "These pages were skipped to respect the site's robots.txt policy.",
      pages: crawlReport.skippedByRobots.slice(0, 10),
    });
  }

  // Crawl errors
  if (crawlReport.errors?.length > 0) {
    scraperFindings.push({
      type: "crawl-errors",
      severity: "warning",
      title: `${crawlReport.errors.length} page${crawlReport.errors.length !== 1 ? "s" : ""} had errors during crawl`,
      detail: crawlReport.errors.slice(0, 5).map(e => `${e.url}: ${e.error}`).join("; "),
    });
  }

  // ── Compute health score ──
  // Match extension logic: include network hits in total (analysis-agent.js line 525)
  const totalEvents = allEvents.length + allNetworkHits.length;
  let healthScore = null;
  let eventsWithErrors = 0;

  if (lintResult) {
    const errorEventIndexes = new Set(
      lintResult.findings
        .filter(f => f.severity === "error" && f.eventIndex !== undefined)
        .map(f => f.eventIndex)
    );
    eventsWithErrors = errorEventIndexes.size;
    healthScore = totalEvents > 0
      ? Math.round((1 - eventsWithErrors / totalEvents) * 100)
      : 0;
  } else {
    // Lint rules not available — compute basic score from coverage
    const pagesWithEvents = pageResults.filter(p => p.eventCount > 0).length;
    if (pageResults.length > 0) {
      healthScore = Math.round((pagesWithEvents / pageResults.length) * 100);
    }
  }

  // ── Assemble final report ──
  return {
    // Site-level
    origin: crawlReport.origin,
    startUrl: crawlReport.startUrl,
    siteType: reconReport?.siteType || inferSiteTypeFromPages(pageResults),
    ga4Version,

    // Health
    health: {
      score: healthScore,
      scoreLabel: healthScore === null ? "Unavailable"
        : healthScore >= 95 ? "Excellent"
        : healthScore >= 85 ? "Good"
        : healthScore >= 70 ? "Needs Work"
        : healthScore >= 50 ? "Poor" : "Critical",
      lintAvailable: !!lintResult,
      totalEvents,
      totalDataLayerEvents: allEvents.length,
      totalNetworkHits: allNetworkHits.length,
      eventsWithErrors,
      errors: lintResult?.summary?.errors || 0,
      warnings: lintResult?.summary?.warnings || 0,
      info: lintResult?.summary?.info || 0,
    },

    // Detailed findings
    lintFindings: lintResult?.findings || [],
    scraperFindings,

    // Page-level data
    pages: pageResults,

    // Coverage
    coverage: {
      totalPages: pageResults.length,
      pagesWithAnalytics: pageResults.filter(p => p.hasAnalytics).length,
      pagesWithEvents: pageResults.filter(p => p.eventCount > 0).length,
      pageTypesFound: [...new Set(pageResults.map(p => p.pageType))],
    },

    // Crawl metadata
    crawlStats: crawlReport.stats,
    reconSummary: reconReport ? {
      siteType: reconReport.siteType,
      analyticsStack: reconReport.analyticsStack,
      quickHealthScore: reconReport.quickHealth?.score,
    } : null,

    generatedAt: new Date().toISOString(),
  };
}

/**
 * Infer site type from page results when no recon report is available.
 */
function inferSiteTypeFromPages(pages) {
  const types = pages.map(p => p.pageType);
  if (types.includes("product-detail") || types.includes("cart")) return "ecommerce";
  if (types.filter(t => t === "blog-post").length >= 2) return "blog";
  if (types.includes("pricing")) return "saas";
  if (types.includes("lead-gen-form") || types.includes("contact") || types.includes("landing")) return "lead-gen";
  return "other";
}
