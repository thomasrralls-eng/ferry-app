#!/usr/bin/env node

/**
 * cli.js — gd fairy scraper CLI
 *
 * Quick way to run scans from the command line during development.
 *
 * Usage:
 *   node src/cli.js https://example.com                  # recon only
 *   node src/cli.js https://example.com --full            # recon + deep crawl
 *   node src/cli.js https://example.com --full --pages 20 # limit deep crawl pages
 *   node src/cli.js https://example.com --json            # output raw JSON
 */

import { reconScan } from "./recon.js";
import { deepCrawl } from "./crawl.js";
import { generateReport } from "./report.js";
import { launchBrowser } from "./browser.js";

const args = process.argv.slice(2);

// Parse args
const url = args.find(a => !a.startsWith("--"));
const fullMode = args.includes("--full");
const jsonOutput = args.includes("--json");
const pagesIdx = args.indexOf("--pages");
const maxPages = pagesIdx !== -1 ? parseInt(args[pagesIdx + 1], 10) : 50;

if (!url) {
  console.error(`
  gd fairy scraper — GA4/GTM data quality scanner

  Usage:
    node src/cli.js <url> [options]

  Options:
    --full         Run deep crawl after recon (default: recon only)
    --pages <n>    Max pages for deep crawl (default: 50)
    --json         Output raw JSON instead of summary

  Examples:
    node src/cli.js https://example.com
    node src/cli.js https://shop.com --full --pages 20
  `);
  process.exit(1);
}

async function main() {
  const startTime = Date.now();

  console.log(`\n✨  gd fairy scraper\n`);
  console.log(`Target:  ${url}`);
  console.log(`Mode:    ${fullMode ? "Full scan (recon + deep crawl)" : "Recon only"}`);
  if (fullMode) console.log(`Pages:   up to ${maxPages}`);
  console.log("");

  const browser = await launchBrowser();

  try {
    // ── Phase 1: Recon ──
    console.log("━━━ Phase 1: Reconnaissance ━━━");
    const reconReport = await reconScan(url, {
      browser,
      onProgress: ({ step, detail }) => {
        console.log(`  [recon] ${detail || step}`);
      },
    });

    console.log(`\n  Site type:     ${reconReport.siteType}`);
    if (reconReport.navSignals?.matchedTerms?.length > 0) {
      console.log(`  Nav signals:   ${reconReport.navSignals.matchedTerms.join(", ")} (score: ${reconReport.navSignals.leadGenScore})`);
    }
    console.log(`  Pages scanned: ${reconReport.pages.length}`);
    console.log(`  Analytics:     ${formatAnalyticsStack(reconReport.analyticsStack)}`);

    if (reconReport.quickHealth) {
      console.log(`  Quick health:  ${reconReport.quickHealth.score}/100`);
      console.log(`  Events found:  ${reconReport.quickHealth.totalEvents}`);
      console.log(`  With errors:   ${reconReport.quickHealth.eventsWithErrors}`);
      if (reconReport.quickHealth.ga4Version) {
        console.log(`  GA4 version:   ${reconReport.quickHealth.ga4Version.version}`);
      }
    }
    console.log("");

    if (!fullMode) {
      if (jsonOutput) {
        console.log(JSON.stringify(reconReport, null, 2));
      } else {
        printReconSummary(reconReport);
      }
      return;
    }

    // ── Phase 2: Deep Crawl ──
    console.log("━━━ Phase 2: Deep Crawl ━━━");
    const crawlReport = await deepCrawl(url, {
      maxPages,
      reconReport,
      browser,
      onProgress: ({ step, currentUrl, visited, maxPages: max }) => {
        if (currentUrl) {
          console.log(`  [${visited}/${max}] ${currentUrl}`);
        }
      },
    });

    console.log(`\n  Pages visited:  ${crawlReport.stats.totalVisited}`);
    console.log(`  Errors:         ${crawlReport.stats.totalErrors}`);
    console.log(`  Robots blocked: ${crawlReport.stats.totalSkippedByRobots}`);
    console.log(`  Duration:       ${(crawlReport.stats.duration / 1000).toFixed(1)}s`);
    console.log("");

    // ── Phase 3: Report ──
    console.log("━━━ Phase 3: Report ━━━");
    const report = await generateReport(crawlReport, reconReport);

    if (jsonOutput) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printFullReport(report);
    }

  } finally {
    await browser.close();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nCompleted in ${elapsed}s`);
  }
}

function formatAnalyticsStack(stack) {
  const parts = [];
  if (stack.hasGtm) parts.push(`GTM (${stack.gtmContainerIds.join(", ") || "detected"})`);
  if (stack.hasGtagJs) parts.push("gtag.js");
  if (stack.measurementIds?.length) parts.push(`IDs: ${stack.measurementIds.join(", ")}`);
  if (stack.hasGoogleAds) parts.push("Google Ads");
  return parts.join(" | ") || "None detected";
}

function printReconSummary(report) {
  console.log("━━━ Recon Summary ━━━\n");

  for (const page of report.pages) {
    const status = page.error ? "ERR" : "OK";
    console.log(`  [${status}] ${page.pageType.padEnd(16)} ${page.eventsFound} events  ${page.url}`);
  }

  if (report.quickHealth?.topIssues?.length) {
    console.log("\n  Top issues:");
    for (const issue of report.quickHealth.topIssues) {
      console.log(`    - [${issue.ruleId}] ${issue.message}`);
    }
  }

  if (report.suggestedCrawlPlan?.pageTypesMissing?.length) {
    console.log(`\n  Page types not found (try --full): ${report.suggestedCrawlPlan.pageTypesMissing.join(", ")}`);
  }
}

function printFullReport(report) {
  const score = report.health.score !== null ? `${report.health.score}/100` : "Unavailable";
  console.log(`\n  Health score:     ${score} (${report.health.scoreLabel})`);
  console.log(`  Lint available:   ${report.health.lintAvailable ? "Yes" : "No (basic scoring)"}`);
  console.log(`  Total events:     ${report.health.totalDataLayerEvents} dataLayer + ${report.health.totalNetworkHits} network`);
  console.log(`  Events w/ errors: ${report.health.eventsWithErrors}`);
  console.log(`  Errors:           ${report.health.errors}`);
  console.log(`  Warnings:         ${report.health.warnings}`);
  console.log(`  GA4 version:      ${report.ga4Version.version}${report.ga4Version.hints.length ? " — " + report.ga4Version.hints[0] : ""}`);

  console.log(`\n  Coverage:`);
  console.log(`    Pages scanned:      ${report.coverage.totalPages}`);
  console.log(`    With analytics:     ${report.coverage.pagesWithAnalytics}`);
  console.log(`    With events:        ${report.coverage.pagesWithEvents}`);
  console.log(`    Page types found:   ${report.coverage.pageTypesFound.join(", ")}`);

  if (report.scraperFindings.length > 0) {
    console.log(`\n  Scraper findings:`);
    for (const f of report.scraperFindings) {
      const icon = f.severity === "error" ? "X" : f.severity === "warning" ? "!" : "i";
      console.log(`    [${icon}] ${f.title}`);
      if (f.detail) console.log(`        ${f.detail}`);
    }
  }

  if (report.lintFindings.length > 0) {
    const topFindings = report.lintFindings
      .filter(f => f.severity === "error")
      .slice(0, 10);
    if (topFindings.length > 0) {
      console.log(`\n  Top lint errors (${topFindings.length} of ${report.health.errors}):`);
      for (const f of topFindings) {
        console.log(`    - [${f.ruleId}] ${f.message}`);
      }
    }
  }
}

main().catch(err => {
  console.error(`\nFatal error: ${err.message}`);
  process.exit(1);
});
