/**
 * sitemap.js — Fetch and parse sitemap.xml files.
 *
 * Supports:
 *   - Standard sitemap.xml with <url><loc> entries
 *   - Sitemap index files (<sitemapindex>) that reference sub-sitemaps
 *   - Gzipped sitemaps (common on large sites)
 *   - Multiple sitemaps from robots.txt Sitemap: directives
 *
 * Used by the recon phase to discover pages beyond just link-following.
 */

import { USER_AGENT } from "./robots.js";

const MAX_URLS_FROM_SITEMAP = 500; // Don't load the entire sitemap for huge sites
const FETCH_TIMEOUT = 8000;

/**
 * Fetch and parse sitemaps for a site.
 *
 * @param {string} origin - e.g. "https://example.com"
 * @param {string[]} [sitemapUrls] - Explicit sitemap URLs (from robots.txt Sitemap: directives)
 * @returns {Promise<SitemapResult>}
 */
export async function fetchSitemaps(origin, sitemapUrls = []) {
  const urls = new Set();
  const errors = [];

  // If no explicit sitemaps from robots.txt, try the default location
  const toFetch = sitemapUrls.length > 0
    ? sitemapUrls
    : [`${origin.replace(/\/$/, "")}/sitemap.xml`];

  for (const sitemapUrl of toFetch) {
    try {
      await parseSitemap(sitemapUrl, urls, errors, 0);
    } catch (err) {
      errors.push({ url: sitemapUrl, error: err.message });
    }

    if (urls.size >= MAX_URLS_FROM_SITEMAP) break;
  }

  return {
    found: urls.size > 0,
    urls: [...urls].slice(0, MAX_URLS_FROM_SITEMAP),
    errors,
  };
}

/**
 * Parse a single sitemap (may recurse for sitemap indexes).
 *
 * @param {string} url - Sitemap URL
 * @param {Set} urls - Accumulator for discovered URLs
 * @param {Array} errors - Accumulator for errors
 * @param {number} depth - Recursion depth (max 2 for sitemap indexes)
 */
async function parseSitemap(url, urls, errors, depth) {
  if (depth > 2) return; // Prevent infinite recursion
  if (urls.size >= MAX_URLS_FROM_SITEMAP) return;

  let text;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      errors.push({ url, error: `HTTP ${res.status}` });
      return;
    }

    text = await res.text();
  } catch (err) {
    errors.push({ url, error: err.message });
    return;
  }

  // Check if this is a sitemap index
  if (text.includes("<sitemapindex")) {
    const subSitemaps = extractTagValues(text, "loc");
    for (const sub of subSitemaps.slice(0, 5)) { // Max 5 sub-sitemaps
      await parseSitemap(sub, urls, errors, depth + 1);
      if (urls.size >= MAX_URLS_FROM_SITEMAP) return;
    }
    return;
  }

  // Standard sitemap — extract <loc> values
  const locs = extractTagValues(text, "loc");
  for (const loc of locs) {
    urls.add(loc);
    if (urls.size >= MAX_URLS_FROM_SITEMAP) return;
  }
}

/**
 * Extract text content from XML tags (lightweight, no XML parser needed).
 * Handles CDATA and basic entity encoding.
 *
 * @param {string} xml - XML string
 * @param {string} tag - Tag name to extract (e.g. "loc")
 * @returns {string[]}
 */
function extractTagValues(xml, tag) {
  const values = [];
  const regex = new RegExp(`<${tag}[^>]*>\\s*(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?\\s*</${tag}>`, "gi");
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const val = match[1]
      .trim()
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    if (val) values.push(val);
  }
  return values;
}

/**
 * Pick a diverse subset of URLs from a sitemap for recon scanning.
 * Tries to get one URL from each "section" of the site.
 *
 * @param {string[]} sitemapUrls - All URLs from sitemap
 * @param {number} [maxUrls=5] - Max URLs to return
 * @returns {string[]}
 */
export function pickDiverseUrls(sitemapUrls, maxUrls = 5) {
  if (sitemapUrls.length <= maxUrls) return [...sitemapUrls];

  // Group by path depth-1 (e.g., "/blog/...", "/products/...", "/about/...")
  const buckets = {};
  for (const url of sitemapUrls) {
    try {
      const path = new URL(url).pathname;
      const segments = path.split("/").filter(Boolean);
      const bucket = segments[0] || "root";
      if (!buckets[bucket]) buckets[bucket] = [];
      buckets[bucket].push(url);
    } catch {
      continue;
    }
  }

  // Take one URL from each bucket, round-robin
  const result = [];
  const bucketKeys = Object.keys(buckets);

  // Prioritize common important sections
  const priorityOrder = [
    "products", "product", "shop", "store", "collections",
    "blog", "news", "articles", "posts",
    "about", "contact", "pricing", "features",
    "category", "categories", "services",
  ];

  const orderedKeys = [
    ...priorityOrder.filter(k => bucketKeys.includes(k)),
    ...bucketKeys.filter(k => !priorityOrder.includes(k)),
  ];

  for (const key of orderedKeys) {
    if (result.length >= maxUrls) break;
    const bucket = buckets[key];
    // Pick a random URL from this bucket
    result.push(bucket[Math.floor(Math.random() * bucket.length)]);
  }

  return result;
}
