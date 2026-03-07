/**
 * recon.js — Phase 1: Quick Reconnaissance Scan
 *
 * Visits ~5 pages to understand what the site does and what analytics
 * stack is present. Returns enough information to:
 *
 *   1. Power the free-tier "quick scan" CTA on the website
 *   2. Guide the deep crawl's page prioritization
 *   3. Give the user a 30-second taste of what gd ferry finds
 *
 * Flow:
 *   1. Fetch robots.txt + sitemap.xml
 *   2. Visit homepage → capture events, classify page, extract nav links
 *   3. Pick ~4 more diverse pages (from nav + sitemap)
 *   4. Run lint rules on all captured events
 *   5. Return a ReconReport
 */

import { fetchRobotsTxt } from "./robots.js";
import { fetchSitemaps, pickDiverseUrls } from "./sitemap.js";
import { launchBrowser, visitPage, extractNavLinks } from "./browser.js";
import { inferSiteType } from "./page-classifier.js";

const MAX_RECON_PAGES = 5;

/**
 * Run a quick recon scan on a site.
 *
 * @param {string} startUrl - Homepage URL (e.g. "https://example.com")
 * @param {Object} [options]
 * @param {number} [options.maxPages=5] - Max pages to visit in recon
 * @param {Function} [options.onProgress] - Progress callback
 * @param {import('puppeteer').Browser} [options.browser] - Reuse existing browser
 * @returns {Promise<ReconReport>}
 */
export async function reconScan(startUrl, options = {}) {
  const { maxPages = MAX_RECON_PAGES, onProgress, browser: existingBrowser } = options;
  const startTime = Date.now();

  let origin;
  try {
    origin = new URL(startUrl).origin;
  } catch (err) {
    throw new Error(`Invalid URL: ${startUrl}`);
  }

  // Normalize start URL to origin if no path given
  const normalizedUrl = startUrl.replace(/\/$/, "") || origin;

  const progress = (step, detail) => {
    if (onProgress) onProgress({ step, detail, elapsed: Date.now() - startTime });
  };

  // ── Step 1: Fetch robots.txt + sitemap ──
  progress("robots", "Fetching robots.txt...");
  const robotsPolicy = await fetchRobotsTxt(origin);

  progress("sitemap", "Fetching sitemap.xml...");
  const sitemapResult = await fetchSitemaps(origin, robotsPolicy.sitemaps);

  // ── Step 2: Launch browser ──
  const browser = existingBrowser || await launchBrowser();
  const ownsBrowser = !existingBrowser;

  try {
    const pages = [];

    // ── Step 3: Visit homepage ──
    progress("homepage", `Visiting ${normalizedUrl}...`);

    if (!robotsPolicy.isAllowed(normalizedUrl)) {
      throw new Error("Homepage is blocked by robots.txt — cannot scan this site.");
    }

    const homepageResult = await visitPage(browser, normalizedUrl);
    pages.push(homepageResult);

    // Extract nav links for page discovery
    // We need to revisit the homepage briefly for nav extraction
    // (visitPage closes the page, so we use the links it captured)
    const navLinks = homepageResult.links || [];

    // ── Step 4: Pick diverse pages to visit ──
    // Combine nav links + sitemap URLs, then pick diverse ones
    const candidateUrls = new Set();

    // Nav links (high priority — represent site structure)
    for (const link of navLinks) {
      if (robotsPolicy.isAllowed(link) && link !== normalizedUrl) {
        candidateUrls.add(link);
      }
    }

    // Sitemap URLs (fill in gaps)
    if (sitemapResult.found) {
      const diverseSitemap = pickDiverseUrls(sitemapResult.urls, 10);
      for (const url of diverseSitemap) {
        if (robotsPolicy.isAllowed(url) && url !== normalizedUrl) {
          candidateUrls.add(url);
        }
      }
    }

    // Pick up to maxPages-1 additional pages (we already have homepage)
    const additionalUrls = pickDiverseFromCandidates([...candidateUrls], maxPages - 1);

    // ── Step 5: Visit additional pages ──
    for (let i = 0; i < additionalUrls.length; i++) {
      const url = additionalUrls[i];
      progress("page", `Visiting page ${i + 2}/${Math.min(maxPages, additionalUrls.length + 1)}: ${url}`);

      // Respect crawl delay
      await sleep(robotsPolicy.crawlDelay * 1000);

      const pageResult = await visitPage(browser, url);
      pages.push(pageResult);
    }

    // ── Step 6: Assemble recon report ──
    progress("analyzing", "Analyzing captured data...");

    const allEvents = [];
    const allNetworkHits = [];
    const analyticsStack = {
      hasGtm: false,
      hasGtagJs: false,
      hasGoogleAds: false,
      measurementIds: new Set(),
      gtmContainerIds: [],
    };

    for (const pg of pages) {
      allEvents.push(...pg.events);
      allNetworkHits.push(...pg.networkHits);

      if (pg.analyticsPresence) {
        if (pg.analyticsPresence.hasGtm) analyticsStack.hasGtm = true;
        if (pg.analyticsPresence.hasGtagJs) analyticsStack.hasGtagJs = true;
        if (pg.analyticsPresence.hasGoogleAds) analyticsStack.hasGoogleAds = true;
        for (const id of pg.analyticsPresence.measurementIds || []) {
          analyticsStack.measurementIds.add(id);
        }
      }

      // Extract GTM container IDs from script URLs
      for (const script of pg.gtmScripts || []) {
        const match = script.url.match(/[?&]id=(GTM-[A-Z0-9]+)/);
        if (match && !analyticsStack.gtmContainerIds.includes(match[1])) {
          analyticsStack.gtmContainerIds.push(match[1]);
        }
      }
    }

    // Analyze nav link text for site purpose signals
    const navSignals = analyzeNavLinks(navLinks);

    // Classify pages and infer site type
    const classifiedPages = pages.map(pg => pg.classification);
    let siteType = inferSiteType(classifiedPages);

    // If inferSiteType returned "other" but nav signals strongly suggest lead-gen, override
    if (siteType === "other" && navSignals.leadGenScore >= 2) {
      siteType = "lead-gen";
    }

    // Quick health score — run lint rules if available
    let quickHealth = null;
    try {
      // Load lint rules via vm.runInNewContext to handle the CJS/ESM mismatch
      // (extension has "type": "module" but rules/index.js uses module.exports)
      const { fileURLToPath } = await import("url");
      const { dirname, resolve } = await import("path");
      const { readFileSync } = await import("fs");
      const vmMod = await import("vm");
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const rulesAbsPath = resolve(__dirname, "..", "..", "extension", "src", "rules", "index.js");
      const code = readFileSync(rulesAbsPath, "utf8");
      const sandbox = {
        module: { exports: {} }, exports: {}, console,
        setTimeout, URL, Set, Map, Array, Object, Math, RegExp, JSON, String, Number, Date, Error, TypeError, Promise,
      };
      vmMod.default.runInNewContext(code, sandbox, { filename: rulesAbsPath, timeout: 5000 });
      const rules = sandbox.module.exports;
      if (rules.lintSession) {
        const lintResult = rules.lintSession(allEvents, { networkHits: allNetworkHits });
        const errors = lintResult.findings.filter(f => f.severity === "error").length;
        const warnings = lintResult.findings.filter(f => f.severity === "warning").length;
        const totalEvents = allEvents.length;
        const eventsWithErrors = new Set(
          lintResult.findings.filter(f => f.severity === "error")
            .map(f => f.eventIndex).filter(i => i !== undefined)
        ).size;

        const score = totalEvents > 0
          ? Math.round((1 - eventsWithErrors / totalEvents) * 100)
          : 0;

        quickHealth = {
          score,
          totalEvents,
          eventsWithErrors,
          errors,
          warnings,
          topIssues: lintResult.findings
            .filter(f => f.severity === "error")
            .slice(0, 5)
            .map(f => ({ ruleId: f.ruleId, message: f.message })),
          ga4Version: lintResult.ga4Version || { version: "free", hints: [] },
        };
      }
    } catch {
      // Lint rules not available — that's fine for recon
    }

    // Build suggested crawl plan for deep phase
    const suggestedCrawlPlan = {
      priorityUrls: [...candidateUrls].slice(0, 50),
      estimatedPages: Math.min(candidateUrls.size + (sitemapResult.urls?.length || 0), 200),
      pageTypesFound: [...new Set(classifiedPages.map(c => c.type))],
      pageTypesMissing: identifyMissingPageTypes(classifiedPages, siteType),
    };

    const report = {
      url: normalizedUrl,
      origin,
      siteType,
      navSignals,
      analyticsStack: {
        ...analyticsStack,
        measurementIds: [...analyticsStack.measurementIds],
      },
      pages: pages.map(pg => ({
        url: pg.url,
        pageType: pg.classification.type,
        confidence: pg.classification.confidence,
        eventsFound: pg.events.length,
        networkHitsFound: pg.networkHits.length,
        loadTime: pg.loadTime,
        error: pg.error,
      })),
      quickHealth,
      suggestedCrawlPlan,
      robotsTxt: {
        found: robotsPolicy.found,
        crawlDelay: robotsPolicy.crawlDelay,
        sitemapCount: robotsPolicy.sitemaps.length,
      },
      sitemap: {
        found: sitemapResult.found,
        urlCount: sitemapResult.urls?.length || 0,
      },
      totalDuration: Date.now() - startTime,
      scannedAt: new Date().toISOString(),
    };

    progress("complete", "Recon scan complete.");
    return report;

  } finally {
    if (ownsBrowser) {
      await browser.close();
    }
  }
}

/**
 * Pick diverse URLs from candidates — tries to cover different
 * path prefixes to get page type variety.
 */
function pickDiverseFromCandidates(urls, maxCount) {
  if (urls.length <= maxCount) return urls;

  // Group by first path segment
  const buckets = {};
  for (const url of urls) {
    try {
      const path = new URL(url).pathname;
      const segment = path.split("/").filter(Boolean)[0] || "root";
      if (!buckets[segment]) buckets[segment] = [];
      buckets[segment].push(url);
    } catch { continue; }
  }

  const result = [];
  const keys = Object.keys(buckets);

  // Round-robin through buckets
  let idx = 0;
  while (result.length < maxCount && idx < keys.length * 10) {
    const key = keys[idx % keys.length];
    if (buckets[key].length > 0) {
      result.push(buckets[key].shift());
    }
    idx++;
    if (Object.values(buckets).every(b => b.length === 0)) break;
  }

  return result;
}

/**
 * Analyze nav link URLs and paths for site purpose signals.
 * Helps identify lead-gen, fintech, and comparison sites even
 * when DOM classification misses the signals.
 */
function analyzeNavLinks(navLinks) {
  const LEAD_GEN_PATTERNS = [
    /apply/i, /quote/i, /rates?/i, /calculator/i, /compare/i,
    /get-?started/i, /pre-?qualif/i, /estimate/i, /approval/i,
    /loan/i, /mortgage/i, /insurance/i, /credit/i, /refinance/i,
    /lender/i, /savings/i, /invest/i,
  ];

  let leadGenScore = 0;
  const matchedTerms = [];

  for (const link of navLinks) {
    try {
      const path = new URL(link).pathname.toLowerCase();
      for (const pattern of LEAD_GEN_PATTERNS) {
        if (pattern.test(path)) {
          leadGenScore++;
          const match = path.match(pattern);
          if (match && !matchedTerms.includes(match[0])) {
            matchedTerms.push(match[0]);
          }
          break; // Only count once per link
        }
      }
    } catch { continue; }
  }

  return { leadGenScore, matchedTerms, totalLinks: navLinks.length };
}

/**
 * Identify page types that weren't found in recon but are expected
 * for the detected site type. Helps guide the deep crawl.
 */
function identifyMissingPageTypes(classifiedPages, siteType) {
  const found = new Set(classifiedPages.map(c => c.type));
  const missing = [];

  const expectedByType = {
    ecommerce: ["product-detail", "category", "cart", "checkout", "homepage"],
    blog: ["blog-post", "blog-index", "about", "homepage"],
    saas: ["pricing", "about", "contact", "homepage", "blog-post"],
    "lead-gen": ["lead-gen-form", "contact", "landing", "about", "homepage"],
  };

  const expected = expectedByType[siteType] || ["homepage", "about", "contact"];

  for (const pageType of expected) {
    if (!found.has(pageType)) {
      missing.push(pageType);
    }
  }

  return missing;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
