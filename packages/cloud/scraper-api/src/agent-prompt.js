/**
 * agent-prompt.js — System prompt and formatting for the gd fairy AI agent.
 *
 * The agent acts as a senior GA4/GTM consultant, analyzing raw scan
 * data and producing actionable recommendations.
 */

/**
 * Build the system prompt for the gd fairy AI agent.
 */
export function buildSystemPrompt() {
  return `You are the gd fairy AI — a senior Google Analytics 4 and Google Tag Manager consultant. You analyze website scan data and provide clear, actionable recommendations.

Your audience is marketing/analytics professionals who manage GA4 and GTM implementations. They understand dataLayer events, measurement IDs, and tag configuration — but they want expert guidance on what to fix and what to implement.

IMPORTANT RULES:
- Be direct and specific. No fluff, no generic advice.
- Prioritize by business impact, not by error count.
- Distinguish between real implementation problems and harmless noise (like GTM internal events).
- When recommending event tracking, use the exact GA4 event names and parameter names from Google's documentation.
- Reference the specific data from the scan — page URLs, event names, error messages.
- Format output as structured JSON matching the schema provided.

DOMAIN EXPERTISE:
- GTM internal events (gtm.js, gtm.dom, gtm.load, gtm.click, gtm.linkClick, gtm.formSubmit, gtm.historyChange, gtm.scrollDepth, gtm.timer, gtm.video) are normal. They should NOT be flagged as errors. They are GTM triggers, not GA4 events.
- Events with names like "Viewed / Page" or "CTA Click" are likely from a tag management layer (Tealium, Segment, etc.) pushing to dataLayer before GTM processes them. These are implementation style choices, not errors.
- GA4 reserved event names: first_open, first_visit, in_app_purchase, session_start, user_engagement, ad_click, ad_exposure, ad_impression, ad_query, ad_reward, app_clear_data, app_exception, app_remove, app_store_refund, app_store_subscription_cancel, app_store_subscription_convert, app_store_subscription_renew, app_update, dynamic_link_app_open, dynamic_link_app_update, dynamic_link_first_open, error, notification_dismiss, notification_foreground, notification_open, notification_receive, os_update, screen_view, click, file_download, form_start, form_submit, page_view, scroll, search, select_content, select_item, select_promotion, video_complete, video_progress, video_start, view_item, view_item_list, view_promotion, view_search_results, login, sign_up, purchase, refund, begin_checkout, add_to_cart, remove_from_cart, add_to_wishlist, add_payment_info, add_shipping_info, earn_virtual_currency, generate_lead, join_group, level_end, level_start, level_up, post_score, spend_virtual_currency, tutorial_begin, tutorial_complete, unlock_achievement.
- GA4 has a 25 custom event parameter limit (free) vs 100 (360).
- GA4 has a 50 custom event limit (free) vs 200 (360).
- Cross-domain tracking requires specific linker configuration.
- Server-side tagging (sGTM) uses custom endpoints instead of google-analytics.com.
- Measurement Protocol hits go to /mp/collect.

SITE TYPE EXPERTISE:
- lead-gen: Must track generate_lead, form_start, form_submit. Should track CTA clicks, calculator usage, comparison tool interactions, quote requests. Key metrics: lead quality, conversion funnel, form abandonment.
- ecommerce: Must track the full ecommerce funnel (view_item, add_to_cart, begin_checkout, add_payment_info, add_shipping_info, purchase). Should track view_item_list, select_item, remove_from_cart, refund.
- saas: Must track sign_up, login, trial starts, feature usage. Should track subscription events, upgrade/downgrade, churn indicators.
- publisher/blog: Must track page_view, scroll, engagement time. Should track article_read, newsletter_signup, content sharing, author/category dimensions.
- other: Recommend based on what events are already present and what the site appears to do.`;
}

/**
 * Build an enriched system prompt that layers in per-domain context from
 * the fairy slave (agentContext) and cross-domain learnings from the
 * fairy master (masterContext).
 *
 * The base system prompt always comes first; domain and master context
 * are appended as additional instruction blocks so Gemini knows to
 * personalise recommendations and reference industry benchmarks.
 *
 * @param {Object|null} domainContext  — domain.agentContext from Firestore
 * @param {Object|null} masterContext  — result of getMasterContext() from master-fairy.js
 * @returns {string}
 */
export function buildEnrichedSystemPrompt(domainContext, masterContext) {
  const base = buildSystemPrompt();
  const parts = [base];

  // ── Domain-specific context (fairy slave knowledge) ────────────────────────
  if (domainContext) {
    const lines = [];

    if (domainContext.businessType) {
      lines.push(`Business type: ${domainContext.businessType}`);
    }
    if (domainContext.businessDescription) {
      lines.push(`Business description: ${domainContext.businessDescription}`);
    }
    if (domainContext.keyEvents?.length) {
      lines.push(`Critical conversion events: ${domainContext.keyEvents.join(", ")}`);
      lines.push(
        `These events are the primary KPIs. Flag any issues with them as CRITICAL regardless of other heuristics.`
      );
    }
    if (domainContext.funnelStages?.length) {
      lines.push(`User funnel stages (in order): ${domainContext.funnelStages.join(" → ")}`);
      lines.push(
        `When evaluating missing tracking, prioritise coverage across each funnel stage.`
      );
    }
    if (domainContext.notes) {
      lines.push(`Analyst context / known issues: ${domainContext.notes}`);
    }

    if (lines.length) {
      parts.push(
        `\nDOMAIN CONTEXT (provided by the analyst — treat as ground truth):\n${lines.join("\n")}`
      );
    }
  }

  // ── Master fairy learnings (cross-domain patterns) ─────────────────────────
  if (masterContext?.patterns?.length) {
    const topPatterns = masterContext.patterns.slice(0, 10);
    const businessType = masterContext.businessType || "similar";
    const domainCount = masterContext.domainCount || "multiple";
    const analysisCount = masterContext.analysisCount || "multiple";

    const patternLines = topPatterns.map(
      (p) =>
        `  - [${p.severity}] ${p.pattern}` +
        ` (found in ${Math.round(p.frequency * 100)}% of ${businessType} sites` +
        ` across ${analysisCount} analyses)`
    );

    parts.push(
      `\nFAIRY MASTER LEARNINGS — Cross-domain patterns from ${domainCount} ${businessType} sites:` +
        `\n${patternLines.join("\n")}` +
        `\n\nFor each of these patterns: explicitly state whether this site is affected, ` +
        `and how it compares to the industry baseline. Use phrases like ` +
        `"Like ${Math.round(topPatterns[0]?.frequency * 100) || "many"}% of ${businessType} sites, ..." ` +
        `to give the client benchmark context.`
    );
  }

  return parts.join("\n");
}

/**
 * Build the user prompt with scan data for analysis.
 *
 * @param {Object} scanReport - The raw scan report from recon or full scan
 * @returns {string} The formatted prompt
 */
export function buildAnalysisPrompt(scanReport) {
  const {
    url,
    siteType,
    navSignals,
    analyticsStack,
    pages,
    quickHealth,
    robotsTxt,
    sitemap,
  } = scanReport;

  // Collect unique events across all pages
  const allPageData = (pages || []).map(p => ({
    url: p.url,
    pageType: p.pageType,
    eventsFound: p.eventsFound,
    networkHitsFound: p.networkHitsFound,
    error: p.error,
  }));

  // Format the health data
  const healthData = quickHealth || {};

  return `Analyze this GA4/GTM scan and return your analysis as JSON matching the schema below.

SCAN DATA:
- URL: ${url}
- Site Type: ${siteType}
- Nav Signals: ${JSON.stringify(navSignals)}
- Analytics Stack: ${JSON.stringify(analyticsStack)}
- GA4 Version: ${JSON.stringify(healthData.ga4Version)}
- Health Score: ${healthData.score}/100
- Total Events: ${healthData.totalEvents}
- Events With Errors: ${healthData.eventsWithErrors}
- Lint Errors: ${healthData.errors}
- Lint Warnings: ${healthData.warnings}
- Top Issues: ${JSON.stringify(healthData.topIssues)}
- Robots.txt: ${JSON.stringify(robotsTxt)}
- Sitemap: ${JSON.stringify(sitemap)}

PAGES SCANNED:
${JSON.stringify(allPageData, null, 2)}

RESPONSE SCHEMA (return valid JSON only, no markdown):
{
  "summary": "2-3 sentence executive summary of the implementation quality",
  "healthScoreAdjusted": {
    "score": <number 0-100, your adjusted score filtering out GTM noise>,
    "rationale": "why you adjusted the score"
  },
  "errorTriage": {
    "noise": [
      {
        "pattern": "description of the noise pattern",
        "count": <approximate count>,
        "explanation": "why this is noise and not a real problem"
      }
    ],
    "realIssues": [
      {
        "severity": "critical|high|medium|low",
        "issue": "what's wrong",
        "impact": "business impact if not fixed",
        "fix": "specific steps to fix it"
      }
    ]
  },
  "missingTracking": [
    {
      "priority": "critical|high|medium|low",
      "eventName": "GA4 event name to implement",
      "parameters": ["param1", "param2"],
      "rationale": "why this matters for a ${siteType} site",
      "implementation": "brief GTM or gtag implementation guidance"
    }
  ],
  "positives": [
    "things the implementation is doing well"
  ],
  "quickWins": [
    {
      "action": "specific thing to do",
      "effort": "low|medium|high",
      "impact": "high|medium|low"
    }
  ],
  "architectureNotes": "any observations about their tag architecture (sGTM, multiple containers, etc.)"
}`;
}

/**
 * Build analysis prompt for a full (deep crawl) report.
 * Includes more detail since we have more pages.
 *
 * @param {Object} fullReport - The full scan report
 * @returns {string}
 */
export function buildFullAnalysisPrompt(fullReport) {
  const { health, ga4Version, siteType, pages, lintFindings } = fullReport;

  // Summarize page types
  const pageTypeCounts = {};
  for (const p of pages || []) {
    const t = p.classification?.pageType || "unknown";
    pageTypeCounts[t] = (pageTypeCounts[t] || 0) + 1;
  }

  // Summarize lint findings by rule
  const findingsByRule = {};
  for (const f of lintFindings || []) {
    findingsByRule[f.ruleId] = (findingsByRule[f.ruleId] || 0) + 1;
  }

  return `Analyze this full GA4/GTM deep-crawl scan and return your analysis as JSON (same schema as recon analysis, but with deeper insights given the larger dataset).

SCAN DATA:
- Site Type: ${siteType}
- GA4 Version: ${JSON.stringify(ga4Version)}
- Health Score: ${health?.score}/100
- Total Events: ${health?.totalEvents}
- Events With Errors: ${health?.eventsWithErrors}
- Pages Crawled: ${(pages || []).length}
- Page Type Distribution: ${JSON.stringify(pageTypeCounts)}
- Lint Findings by Rule: ${JSON.stringify(findingsByRule)}

Provide the same JSON schema as the recon analysis but with deeper, more confident recommendations given the larger dataset.`;
}
