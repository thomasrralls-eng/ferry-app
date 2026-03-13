import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRobotsTxt } from "../src/robots.js";

describe("parseRobotsTxt", () => {
  const origin = "https://example.com";

  it("parses basic Disallow rules", () => {
    const txt = `
User-agent: *
Disallow: /admin/
Disallow: /private/
Allow: /admin/public/
    `;
    const policy = parseRobotsTxt(txt, origin);

    assert.equal(policy.found, true);
    assert.equal(policy.isAllowed("https://example.com/"), true);
    assert.equal(policy.isAllowed("https://example.com/page"), true);
    assert.equal(policy.isAllowed("https://example.com/admin/dashboard"), false);
    assert.equal(policy.isAllowed("https://example.com/private/data"), false);
    // Allow takes precedence when more specific
    assert.equal(policy.isAllowed("https://example.com/admin/public/page"), true);
  });

  it("respects FairyBot-specific rules over wildcard", () => {
    const txt = `
User-agent: *
Disallow: /

User-agent: FairyBot
Disallow: /secret/
Allow: /
    `;
    const policy = parseRobotsTxt(txt, origin);

    // FairyBot rules should apply, not the wildcard block-all
    assert.equal(policy.isAllowed("https://example.com/"), true);
    assert.equal(policy.isAllowed("https://example.com/page"), true);
    assert.equal(policy.isAllowed("https://example.com/secret/data"), false);
  });

  it("extracts Crawl-delay", () => {
    const txt = `
User-agent: *
Crawl-delay: 5
Disallow: /temp/
    `;
    const policy = parseRobotsTxt(txt, origin);
    assert.equal(policy.crawlDelay, 5); // 5 > minimum 2
  });

  it("enforces minimum crawl delay of 2 seconds", () => {
    const txt = `
User-agent: *
Crawl-delay: 0.5
    `;
    const policy = parseRobotsTxt(txt, origin);
    assert.equal(policy.crawlDelay, 2); // Minimum floor
  });

  it("extracts Sitemap URLs", () => {
    const txt = `
Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/sitemap-posts.xml

User-agent: *
Disallow: /admin/
    `;
    const policy = parseRobotsTxt(txt, origin);
    assert.deepEqual(policy.sitemaps, [
      "https://example.com/sitemap.xml",
      "https://example.com/sitemap-posts.xml",
    ]);
  });

  it("handles wildcard patterns in paths", () => {
    const txt = `
User-agent: *
Disallow: /*.pdf$
Disallow: /search*
    `;
    const policy = parseRobotsTxt(txt, origin);

    assert.equal(policy.isAllowed("https://example.com/doc.pdf"), false);
    assert.equal(policy.isAllowed("https://example.com/doc.html"), true);
    assert.equal(policy.isAllowed("https://example.com/search?q=test"), false);
    assert.equal(policy.isAllowed("https://example.com/research"), true);
  });

  it("allows everything when robots.txt is empty", () => {
    const policy = parseRobotsTxt("", origin);
    assert.equal(policy.found, true);
    assert.equal(policy.isAllowed("https://example.com/anything"), true);
  });

  it("ignores comments and blank lines", () => {
    const txt = `
# This is a comment
User-agent: *
# Another comment
Disallow: /blocked/

# Sitemap comment
Sitemap: https://example.com/sitemap.xml
    `;
    const policy = parseRobotsTxt(txt, origin);
    assert.equal(policy.isAllowed("https://example.com/blocked/page"), false);
    assert.equal(policy.isAllowed("https://example.com/allowed/page"), true);
    assert.equal(policy.sitemaps.length, 1);
  });

  it("allows URLs from different origins", () => {
    const txt = `
User-agent: *
Disallow: /
    `;
    const policy = parseRobotsTxt(txt, origin);
    // Different origin → not our concern → allowed
    assert.equal(policy.isAllowed("https://other-site.com/page"), true);
  });
});
