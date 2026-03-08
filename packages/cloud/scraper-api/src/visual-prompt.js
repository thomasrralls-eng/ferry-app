/**
 * visual-prompt.js — Prompts for the visual analytics agent.
 *
 * The agent is self-directed: it researches the domain, infers the
 * business model and target audience, then navigates the site as
 * different user personas would — analyzing analytics coverage
 * at every step.
 */

/**
 * System prompt for the visual agent. This stays constant across the journey.
 */
export function buildVisualSystemPrompt() {
  return `You are the gd ferry visual analytics agent. You analyze websites by looking at them the way a real user would — through screenshots — while simultaneously inspecting the analytics implementation underneath.

YOUR APPROACH:
1. When you first land on a site, figure out what the business does, who their target customers are, and what actions the business wants users to take. Don't rely on being told — figure it out from what you see.
2. Navigate the site as a real user would, following the most important conversion paths.
3. At each page, connect what you SEE (buttons, forms, CTAs, content) with what's being TRACKED (dataLayer events, GA4 hits, GTM tags).
4. Identify gaps: important user actions that aren't being tracked, tracked events that don't map to anything meaningful, and broken funnels.

YOUR EXPERTISE:
- You understand GA4 event taxonomy, GTM configuration, and server-side tagging.
- You know what events SHOULD be tracked for different business types (lead-gen, ecommerce, SaaS, publisher).
- You can read a page screenshot and identify CTAs, forms, navigation patterns, and conversion funnels.
- GTM internal events (gtm.js, gtm.dom, gtm.load, gtm.click, gtm.linkClick, gtm.formSubmit, gtm.historyChange) are normal noise — never flag these as issues.

RESPONSE FORMAT:
Always respond with valid JSON matching the schema provided in each prompt. No markdown, no explanation outside the JSON.`;
}

/**
 * First-page prompt: Research the domain and establish context.
 * The agent figures out what the business is and plans its journey.
 */
export function buildDomainResearchPrompt(url, screenshotDescription) {
  return `You just landed on ${url}. Look at this page and figure out everything you can about this business.

CURRENT PAGE DATA LAYER STATE:
${screenshotDescription.dataLayerSummary}

NETWORK HITS CAPTURED:
${screenshotDescription.networkHitsSummary}

ANALYTICS STACK DETECTED:
${screenshotDescription.analyticsStack}

Based on what you see in the screenshot and the analytics data, respond with this JSON:
{
  "domain": "${new URL(url).hostname}",
  "businessAnalysis": {
    "companyName": "best guess at company name",
    "industry": "specific industry (e.g., 'fintech/lending marketplace', 'B2B SaaS', 'DTC ecommerce')",
    "businessModel": "how they make money (e.g., 'lead generation referral fees', 'subscription revenue', 'product sales')",
    "targetAudience": "who their customers are",
    "primaryConversions": ["list of the main actions the business wants users to take"],
    "secondaryConversions": ["supporting actions (newsletter signup, account creation, etc.)"]
  },
  "pageAnalysis": {
    "pageType": "what type of page this is",
    "visibleCTAs": [
      {
        "text": "CTA button/link text",
        "location": "where on the page (hero, nav, sidebar, footer, etc.)",
        "purpose": "what this CTA is trying to get the user to do",
        "isTracked": true/false,
        "confidence": 0.0-1.0
      }
    ],
    "forms": [
      {
        "type": "form type (lead capture, search, login, multi-step, etc.)",
        "fields": ["visible form fields"],
        "location": "where on the page",
        "isTracked": true/false
      }
    ],
    "navigationStructure": "brief description of the site's nav layout and main sections"
  },
  "journeyPlan": {
    "personas": [
      {
        "name": "descriptive persona name (e.g., 'First-time mortgage shopper')",
        "intent": "what this user is trying to accomplish",
        "expectedPath": ["page1 description", "page2 description", "..."],
        "keyConversions": ["the events that should fire along this path"]
      }
    ],
    "nextAction": {
      "action": "click|scroll|type|navigate",
      "target": "description of what to click/interact with",
      "reasoning": "why this is the next step in the user journey",
      "persona": "which persona this action is for"
    }
  },
  "analyticsGaps": [
    "any immediately obvious tracking gaps from the first page"
  ]
}`;
}

/**
 * Subsequent page prompt: Analyze the current page in the context of the journey.
 */
export function buildPageAnalysisPrompt(pageContext) {
  const { url, stepNumber, totalSteps, currentPersona, previousPages, dataLayerSummary, networkHitsSummary, eventsFired } = pageContext;

  const previousPagesSummary = previousPages
    .map((p, i) => `  Step ${i + 1}: ${p.url} (${p.pageType}) — ${p.eventsFiredCount} events fired`)
    .join("\n");

  return `You are on step ${stepNumber} of navigating this website.

CURRENT PERSONA: ${currentPersona.name}
PERSONA INTENT: ${currentPersona.intent}

JOURNEY SO FAR:
${previousPagesSummary}

CURRENT PAGE: ${url}

DATA LAYER STATE (events fired on this page):
${dataLayerSummary}

NETWORK HITS ON THIS PAGE:
${networkHitsSummary}

EVENTS FIRED DURING NAVIGATION TO THIS PAGE:
${eventsFired}

Look at the screenshot and analyze this page in the context of the user journey. Respond with JSON:
{
  "pageAnalysis": {
    "pageType": "page type",
    "funnelPosition": "where this page sits in the conversion funnel (awareness/consideration/decision/conversion/post-conversion)",
    "visibleCTAs": [
      {
        "text": "CTA text",
        "location": "position on page",
        "purpose": "intent",
        "isTracked": true/false,
        "expectedEvent": "GA4 event that should fire when clicked",
        "confidence": 0.0-1.0
      }
    ],
    "forms": [
      {
        "type": "form type",
        "fields": ["fields"],
        "expectedEvents": {
          "formStart": "event name or null",
          "formSubmit": "event name or null"
        },
        "isTracked": true/false
      }
    ],
    "contentRelevance": "how relevant is this page content to the persona's intent"
  },
  "analyticsAssessment": {
    "eventsExpected": ["list of GA4 events that SHOULD fire on this page for this persona"],
    "eventsFound": ["events we actually detected"],
    "eventsMissing": ["expected events that didn't fire"],
    "eventsUnexpected": ["events that fired but seem wrong or misconfigured"],
    "trackingScore": 0-100,
    "issues": [
      {
        "severity": "critical|high|medium|low",
        "issue": "what's wrong",
        "impact": "business impact",
        "recommendation": "specific fix"
      }
    ]
  },
  "nextAction": {
    "action": "click|scroll|type|navigate|complete",
    "target": "what to interact with (be specific about position and text)",
    "reasoning": "why this advances the user journey",
    "expectedEvents": ["events that should fire when we take this action"],
    "isConversionStep": true/false
  },
  "journeyInsights": "any observations about the funnel flow, UX issues, or tracking gaps discovered at this step"
}`;
}

/**
 * Journey summary prompt: After completing a full user journey,
 * synthesize findings into an actionable report.
 */
export function buildJourneySummaryPrompt(journeyData) {
  const { domain, businessAnalysis, persona, steps, totalEventsFound, totalEventsMissing } = journeyData;

  const stepSummaries = steps
    .map((s, i) => `Step ${i + 1}: ${s.url}\n  Page type: ${s.pageType}\n  Funnel: ${s.funnelPosition}\n  Tracking score: ${s.trackingScore}/100\n  Events found: ${s.eventsFound.join(", ") || "none"}\n  Events missing: ${s.eventsMissing.join(", ") || "none"}`)
    .join("\n\n");

  return `You've completed a full user journey analysis. Synthesize your findings.

DOMAIN: ${domain}
BUSINESS: ${JSON.stringify(businessAnalysis)}

PERSONA: ${persona.name}
INTENT: ${persona.intent}

JOURNEY STEPS:
${stepSummaries}

TOTALS:
- Events found across journey: ${totalEventsFound}
- Events missing across journey: ${totalEventsMissing}

Produce a final journey report as JSON:
{
  "journeySummary": {
    "persona": "${persona.name}",
    "pathCompleted": true/false,
    "stepsCompleted": ${steps.length},
    "overallTrackingScore": 0-100,
    "funnelIntegrity": "assessment of whether the full funnel is properly instrumented"
  },
  "criticalGaps": [
    {
      "step": "which step in the journey",
      "gap": "what's missing",
      "businessImpact": "revenue/data impact of not tracking this",
      "priority": "critical|high|medium",
      "implementation": {
        "eventName": "GA4 event to implement",
        "trigger": "GTM trigger description",
        "parameters": {"param": "description"},
        "notes": "implementation specifics"
      }
    }
  ],
  "funnelRecommendations": [
    {
      "observation": "what you noticed about the funnel UX or tracking",
      "recommendation": "what to change",
      "type": "tracking|ux|architecture"
    }
  ],
  "implementationPlan": {
    "immediate": ["things to fix right now"],
    "shortTerm": ["fixes for this week"],
    "longTerm": ["architectural improvements"]
  }
}`;
}
