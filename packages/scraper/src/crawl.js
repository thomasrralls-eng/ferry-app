/**
 * crawl.js — Phase 2: Deep Crawl with Rate Limiting & robots.txt Compliance
 *
 * BFS crawl that visits up to `maxPages` pages, capturing events on each.
 * Uses recon results to prioritize diverse page types.
 *
 * Key features:
 *   - robots.txt compliance (checked before every page visit)
 *   - Rate limiting (respects Crawl-delay, minimum 2s)
 *   - Page type prioritization from recon scan
 *   - Configurable max pages
 *   - Progress callbacks for real-time UI updates
 *   - Same-origin only (no cross-domain crawling)
 */

import { fetchRobotsTxt } from "./robots.js";
import { launchBrowser, visitPage } from "./browser.js";
import { classifyByUrl } from "./page-classifier.js";

const DEFAULT_MAX_PAGES = 50;
const MAX_ALLOWED_PAGES = 200;

/**
 * Run a deep crawl on a site.
 *
 * @param {string} startUrl - Homepage URL
 * @param {Object} [options]
 * @param {number} [options.maxPages=50] - Max pages to visit
 * @param {Object} [options.reconReport] - Recon report for smart prioritization
 * @param {Function} [options.onProgress] - Progress callback
 * @param {Function} [options.onPageComplete] - Called after each page
 * @param {import('puppeteer').Browser} [options.browser] - Reuse browser
 * @param {Object} [options.robotsPolicy] - Reuse robots policy from recon
 * @returns {Promise<CrawlReport>}
 */
export async function deepCrawl(startUrl, options = {}) {
  const {
    maxPages = DEFAULT_MAX_PAGES,
    reconReport = null,
    onProgress,
    onPageComplete,
    browser: existingBrowser,
    robotsPolicy: existingPolicy,
  } = options;

  const effectiveMaxPages = Math.min(maxPages, MAX_ALLOWED_PAGES);
  const startTime = Date.now();

  let origin;
  try {
    origin = new URL(startUrl).origin;
  } catch {
    throw new Error(`Invalid URL: ${startUrl}`);
  }

  const progress = (data) => {
    if (onProgress) onProgress({ ...data, elapsed: Date.now() - startTime });
  };

  // ── Robots policy ──
  const robotsPolicy = existingPolicy || await fetchRobotsTxt(origin);

  // ── Browser ──
  const browser = existingBrowser || await launchBrowser();
  const ownsBrowser = !existingBrowser;

  // ── Crawl state ──
  const visited = new Set();
  const queue = new PriorityQueue();
  const pages = [];
  const errors = [];
  const skippedByRobots = [];

  // Seed the queue
  queue.enqueue(startUrl, 100); // Homepage = highest priority

  // Add recon-suggested priority URLs
  if (reconReport?.suggestedCrawlPlan?.priorityUrls) {
    for (const url of reconReport.suggestedCrawlPlan.priorityUrls) {
      queue.enqueue(url, 80);
    }
  }

  try {
    while (!queue.isEmpty() && visited.size < effectiveMaxPages) {
      const nextUrl = queue.dequeue();
      if (!nextUrl || visited.has(nextUrl)) continue;

      // robots.txt check
      if (!robotsPolicy.isAllowed(nextUrl)) {
        skippedByRobots.push(nextUrl);
        continue;
      }

      visited.add(nextUrl);

      progress({
        step: "crawling",
        currentUrl: nextUrl,
        visited: visited.size,
        queued: queue.size(),
        maxPages: effectiveMaxPages,
      });

      // Rate limit — respect crawl delay
      if (pages.length > 0) {
        await sleep(robotsPolicy.crawlDelay * 1000);
      }

      // Visit page
      const pageResult = await visitPage(browser, nextUrl);

      if (pageResult.error) {
        errors.push({ url: nextUrl, error: pageResult.error });
      }

      pages.push(pageResult);

      // Notify caller
      if (onPageComplete) {
        onPageComplete(pageResult, { visited: visited.size, total: effectiveMaxPages });
      }

      // Add discovered links to queue with priority scores
      for (const link of pageResult.links || []) {
        if (visited.has(link)) continue;

        // Filter out non-page resources
        if (!isPageUrl(link, origin)) continue;

        // Prioritize based on page type diversity
        const priority = calculatePriority(link, pages, reconReport);
        queue.enqueue(link, priority);
      }
    }

    // ── Assemble report ──
    progress({ step: "complete", visited: visited.size });

    return {
      origin,
      startUrl,
      pages,
      errors,
      skippedByRobots,
      stats: {
        totalVisited: visited.size,
        totalQueued: queue.size(),
        totalErrors: errors.length,
        totalSkippedByRobots: skippedByRobots.length,
        maxPages: effectiveMaxPages,
        crawlDelay: robotsPolicy.crawlDelay,
        duration: Date.now() - startTime,
      },
      robotsTxt: {
        found: robotsPolicy.found,
        crawlDelay: robotsPolicy.crawlDelay,
      },
      completedAt: new Date().toISOString(),
    };

  } finally {
    if (ownsBrowser) {
      await browser.close();
    }
  }
}

/**
 * Calculate crawl priority for a URL.
 * Higher = visit sooner. Range: 0–100.
 *
 * Prioritizes:
 *   - Page types we haven't seen yet (diversity)
 *   - Pages likely to have rich analytics (ecommerce, forms)
 *   - Shorter paths (more likely to be important pages)
 */
function calculatePriority(url, visitedPages, reconReport) {
  let priority = 50; // baseline

  const urlClassification = classifyByUrl(url);
  const seenTypes = new Set(visitedPages.map(p => p.classification?.type));

  // Bonus for unseen page types
  if (!seenTypes.has(urlClassification.type)) {
    priority += 20;
  }

  // Bonus for high-value page types
  const highValueTypes = ["product-detail", "checkout", "cart", "pricing", "contact"];
  if (highValueTypes.includes(urlClassification.type)) {
    priority += 15;
  }

  // Bonus for pages that recon identified as missing
  if (reconReport?.suggestedCrawlPlan?.pageTypesMissing?.includes(urlClassification.type)) {
    priority += 25;
  }

  // Shorter paths tend to be more important
  try {
    const path = new URL(url).pathname;
    const depth = path.split("/").filter(Boolean).length;
    priority -= depth * 3; // Penalize deep pages slightly
  } catch {}

  return Math.max(0, Math.min(100, priority));
}

/**
 * Check if a URL looks like a visitable page (not a resource file).
 */
function isPageUrl(url, origin) {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== origin) return false;
    if (!parsed.protocol.startsWith("http")) return false;

    const ext = parsed.pathname.split(".").pop()?.toLowerCase();
    const skipExts = [
      "jpg", "jpeg", "png", "gif", "svg", "webp", "pdf", "zip",
      "css", "js", "woff", "woff2", "ttf", "ico", "mp4", "mp3",
      "avi", "mov", "xml", "json", "rss", "atom", "map",
    ];
    if (skipExts.includes(ext)) return false;

    const skipPaths = [
      "/wp-admin", "/wp-json", "/api/", "/graphql",
      "/cdn-cgi/", "/_next/", "/static/", "/.well-known/",
      "/feed", "/rss",
    ];
    if (skipPaths.some(p => parsed.pathname.startsWith(p))) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Simple priority queue backed by a sorted array.
 * Good enough for crawl sizes of 200 pages.
 */
class PriorityQueue {
  constructor() {
    this.items = []; // { url, priority }
    this.seen = new Set();
  }

  enqueue(url, priority) {
    if (this.seen.has(url)) return;
    this.seen.add(url);
    this.items.push({ url, priority });
    // Sort descending by priority (highest first)
    this.items.sort((a, b) => b.priority - a.priority);
  }

  dequeue() {
    const item = this.items.shift();
    return item?.url || null;
  }

  isEmpty() {
    return this.items.length === 0;
  }

  size() {
    return this.items.length;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
