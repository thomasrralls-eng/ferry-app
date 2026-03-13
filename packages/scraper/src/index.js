/**
 * /scraper — gd fairy cloud scraper
 *
 * Headless browser crawler that visits websites, captures GA4/GTM
 * events from the dataLayer, and runs them through the lint rules
 * engine to produce data quality reports.
 *
 * Two-phase architecture:
 *   1. Recon scan (~5 pages, <60s) — quick health check + site classification
 *   2. Deep crawl (up to 200 pages) — full report with lint findings
 *
 * Usage:
 *   import { reconScan, deepCrawl, scanSite, generateReport } from "/scraper";
 *
 *   // Quick scan (free tier)
 *   const recon = await reconScan("https://example.com");
 *
 *   // Full scan (pro tier)
 *   const crawl = await deepCrawl("https://example.com", { reconReport: recon });
 *   const report = await generateReport(crawl, recon);
 *
 *   // One-shot convenience method
 *   const fullReport = await scanSite("https://example.com", { maxPages: 50 });
 */

export { reconScan } from "./recon.js";
export { deepCrawl } from "./crawl.js";
export { generateReport } from "./report.js";
export { fetchRobotsTxt, parseRobotsTxt } from "./robots.js";
export { fetchSitemaps, pickDiverseUrls } from "./sitemap.js";
export { launchBrowser, visitPage } from "./browser.js";
export { waitForDataLayer, detectAnalyticsPresence } from "./wait-strategy.js";
export { classifyByUrl, classifyPage, inferSiteType } from "./page-classifier.js";

/**
 * Convenience method: Run a full scan (recon + deep crawl + report).
 *
 * @param {string} url - Homepage URL
 * @param {Object} [options]
 * @param {number} [options.maxPages=50] - Max pages for deep crawl
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<Object>} Full report
 */
export async function scanSite(url, options = {}) {
  const { maxPages = 50, onProgress } = options;

  const progress = (phase, data) => {
    if (onProgress) onProgress({ phase, ...data });
  };

  // Import dynamically to handle the case where Puppeteer isn't installed
  const { launchBrowser: launch } = await import("./browser.js");
  const { reconScan: recon } = await import("./recon.js");
  const { deepCrawl: crawl } = await import("./crawl.js");
  const { generateReport: report } = await import("./report.js");

  const browser = await launch();

  try {
    // Phase 1: Recon
    const reconReport = await recon(url, {
      browser,
      onProgress: (data) => progress("recon", data),
    });

    // Phase 2: Deep crawl
    const crawlReport = await crawl(url, {
      maxPages,
      reconReport,
      browser,
      onProgress: (data) => progress("crawl", data),
    });

    // Phase 3: Report
    const fullReport = await report(crawlReport, reconReport);

    return fullReport;
  } finally {
    await browser.close();
  }
}
