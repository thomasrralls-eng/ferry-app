/**
 * robots.txt — Fetch, parse, and enforce robots.txt compliance.
 *
 * gd fairy respects every site's robots.txt. Before visiting any URL,
 * the scraper checks `isAllowed()` and obeys `Crawl-delay`.
 *
 * Uses a simple built-in parser (no external dependency) that handles
 * the directives we care about: User-agent, Allow, Disallow,
 * Crawl-delay, and Sitemap.
 */

const USER_AGENT = "GdFairyBot/1.0 (+https://gdfairy.com/bot)";
const DEFAULT_CRAWL_DELAY = 2; // seconds — our minimum politeness floor

/**
 * Fetch and parse robots.txt for a given origin.
 *
 * @param {string} origin - e.g. "https://example.com"
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=5000] - fetch timeout
 * @returns {Promise<RobotsPolicy>}
 */
export async function fetchRobotsTxt(origin, options = {}) {
  const { timeoutMs = 5000 } = options;
  const url = `${origin.replace(/\/$/, "")}/robots.txt`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      // No robots.txt or server error → allow everything
      return createPermissivePolicy(origin);
    }

    const text = await res.text();
    return parseRobotsTxt(text, origin);
  } catch (err) {
    // Network error, timeout, etc. → allow everything (be graceful)
    return createPermissivePolicy(origin);
  }
}

/**
 * Parse robots.txt content into a structured policy object.
 *
 * @param {string} text - Raw robots.txt content
 * @param {string} origin - The site origin (for resolving sitemap URLs)
 * @returns {RobotsPolicy}
 */
export function parseRobotsTxt(text, origin) {
  const lines = text.split(/\r?\n/);
  const sitemaps = [];

  // We collect rules for our bot and for "*" (wildcard)
  let currentAgents = [];
  const ruleGroups = []; // { agents: Set, rules: [{ allow, path }], crawlDelay }

  let currentGroup = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const directive = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (directive === "sitemap") {
      sitemaps.push(value);
      continue;
    }

    if (directive === "user-agent") {
      if (currentGroup && currentGroup.rules.length === 0 && currentGroup.crawlDelay === null) {
        // Still collecting agents for this group
        currentGroup.agents.add(value.toLowerCase());
      } else {
        // Start a new group
        currentGroup = { agents: new Set([value.toLowerCase()]), rules: [], crawlDelay: null };
        ruleGroups.push(currentGroup);
      }
      continue;
    }

    if (!currentGroup) continue; // directive before any user-agent — skip

    if (directive === "disallow") {
      if (value) currentGroup.rules.push({ allow: false, path: value });
    } else if (directive === "allow") {
      if (value) currentGroup.rules.push({ allow: true, path: value });
    } else if (directive === "crawl-delay") {
      const delay = parseFloat(value);
      if (!isNaN(delay) && delay > 0) {
        currentGroup.crawlDelay = delay;
      }
    }
  }

  // Find the most specific matching group: prefer "fairybot" > "*"
  const botName = "fairybot";
  let matchedGroup = ruleGroups.find(g => g.agents.has(botName));
  if (!matchedGroup) {
    matchedGroup = ruleGroups.find(g => g.agents.has("*"));
  }

  const rules = matchedGroup?.rules || [];
  const crawlDelay = matchedGroup?.crawlDelay ?? null;

  return {
    found: true,
    origin,
    rules,
    crawlDelay: Math.max(crawlDelay ?? DEFAULT_CRAWL_DELAY, DEFAULT_CRAWL_DELAY),
    sitemaps,
    isAllowed: (url) => checkAllowed(url, origin, rules),
    raw: text,
  };
}

/**
 * Check if a URL is allowed by the parsed rules.
 * Rules are matched by path prefix, with Allow taking precedence
 * over Disallow when both match at the same specificity.
 *
 * @param {string} url - Full URL to check
 * @param {string} origin - Site origin
 * @param {Array} rules - Parsed rules array
 * @returns {boolean}
 */
function checkAllowed(url, origin, rules) {
  let pathname;
  try {
    const parsed = new URL(url);
    if (parsed.origin !== origin) return true; // different origin = not our concern
    pathname = parsed.pathname;
  } catch {
    return true; // invalid URL — skip
  }

  // Find the longest matching rule
  let bestMatch = null;
  let bestLength = -1;

  for (const rule of rules) {
    const pattern = rule.path;

    // Simple prefix matching (handles most real-world robots.txt)
    // Supports trailing * wildcard and $ end anchor
    let matches = false;

    if (pattern.includes("*") || pattern.endsWith("$")) {
      // Convert robots.txt glob to regex
      // Strip trailing $ (it means "end of URL" in robots.txt)
      const hasEndAnchor = pattern.endsWith("$");
      const cleanPattern = hasEndAnchor ? pattern.slice(0, -1) : pattern;
      // Escape regex chars except *, then convert * to .*
      const regexStr = "^" +
        cleanPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") +
        (hasEndAnchor ? "$" : "");
      const regex = new RegExp(regexStr);
      matches = regex.test(pathname);
    } else {
      // Prefix match
      matches = pathname.startsWith(pattern);
    }

    if (matches && pattern.length > bestLength) {
      bestMatch = rule;
      bestLength = pattern.length;
    }
  }

  // No matching rule → allowed by default
  if (!bestMatch) return true;

  return bestMatch.allow;
}

/**
 * Create a permissive policy (when no robots.txt exists).
 */
function createPermissivePolicy(origin) {
  return {
    found: false,
    origin,
    rules: [],
    crawlDelay: DEFAULT_CRAWL_DELAY,
    sitemaps: [],
    isAllowed: () => true,
    raw: null,
  };
}

export { USER_AGENT, DEFAULT_CRAWL_DELAY };
