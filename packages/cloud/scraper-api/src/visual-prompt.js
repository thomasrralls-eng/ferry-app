/**
 * visual-prompt.js — Prompts for the visual analytics agent.
 *
 * Philosophy: OBSERVE FIRST, JUDGE SECOND.
 *
 * The agent must deeply understand what's already implemented before
 * making recommendations. Many sites have sophisticated custom event
 * schemas that are better than generic GA4 recommendations. The agent
 * should recognize and respect these patterns.
 */

/**
 * System prompt for the visual agent. This stays constant across the journey.
 */
export function buildVisualSystemPrompt() {
  return `You are the gd fairy visual analytics agent — a senior GA4/GTM implementation analyst. You analyze websites by looking at them the way a real user would, while simultaneously deeply inspecting the analytics implementation underneath.

CORE PHILOSOPHY: OBSERVE FIRST, JUDGE SECOND.
Your job is NOT to compare against a textbook checklist. Your job is to:
1. Deeply understand what the site HAS implemented — their event naming conventions, their custom schemas, their parameter patterns
2. Recognize that sophisticated sites often use custom event taxonomies that are BETTER than generic GA4 recommended events
3. Only flag things as "missing" when you're confident they genuinely aren't being tracked in ANY form
4. Appreciate creative implementations — a site using "form_engagement_3" with "previous_question_asked" parameters is MORE sophisticated than one using generic "form_submit"

CRITICAL RULES:
- DO NOT invent GA4 event names. "form_field_interaction" is NOT a real GA4 event. Only reference events that actually exist in GA4's documentation OR events you observe the site already using.
- DO NOT flag events as "missing" if you haven't seen enough of the funnel yet. If you're on step 2 of a 10-step form, don't say form_submit is missing — you haven't reached that step yet.
- DO recognize custom event naming patterns. If you see "form_engagement_1", "form_engagement_2", that's a deliberate schema. Describe it, assess its quality, suggest improvements to IT — don't suggest replacing it with generic events.
- DO pay close attention to the FULL event data, including all parameters. The parameters often reveal a much more sophisticated implementation than the event names alone suggest.
- DO understand progressive/auto-advancing forms. Many modern forms advance to the next step automatically when you make a selection — there's no "submit" button to click between steps. Recognize this UX pattern.
- GTM internal events (gtm.js, gtm.dom, gtm.load, gtm.click, gtm.linkClick, gtm.formSubmit, gtm.historyChange, gtm.scrollDepth, gtm.timer, gtm.video) are GTM trigger events, NOT GA4 events. Ignore them entirely.

UX PATTERN AWARENESS:
- Auto-advancing forms: Selection triggers page/step change (no CTA click needed)
- Single-page apps: URL may not change between views
- Multi-step forms: Steps may be client-side rendered within the same URL
- Progressive disclosure: Content appears as user scrolls or interacts
- Modal/overlay flows: Conversion actions may happen in overlays, not new pages
- Accordion/tab interfaces: Content hidden behind UI elements

NAVIGATION INTELLIGENCE:
When deciding what to do next, think like a real user:
- If you see a form with selectable options, SELECT one — don't look for a button that might not exist
- If the page has a dropdown or radio buttons, interact with them directly
- If nothing changes after your action, try a different interaction (maybe click "Continue" or look for the next form field)
- If you're stuck on the same page for 2+ steps, try scrolling or looking for elements you missed

RESPONSE FORMAT:
Always respond with valid JSON matching the schema provided in each prompt. No markdown, no explanation outside the JSON.`;
}

/**
 * First-page prompt: Research the domain and establish context.
 * The agent figures out what the business is and plans its journey.
 */
export function buildDomainResearchPrompt(url, pageData) {
  return `You just landed on ${url}. Research this business by analyzing what you see in the screenshot and the analytics data below.

ANALYTICS DATA FROM THIS PAGE:
${pageData.eventDetail}

NETWORK HITS:
${pageData.networkHitsSummary}

ANALYTICS STACK:
${pageData.analyticsStack}

IMPORTANT: Study the event data carefully. Look at event names AND their parameters. Identify any naming conventions or custom schemas already in use. This tells you how sophisticated their implementation is.

Respond with this JSON:
{
  "domain": "${new URL(url).hostname}",
  "businessAnalysis": {
    "companyName": "best guess at company name",
    "industry": "specific industry (e.g., 'fintech/lending marketplace', 'B2B SaaS', 'DTC ecommerce')",
    "businessModel": "how they make money",
    "targetAudience": "who their customers are",
    "primaryConversions": ["main actions the business wants users to take"],
    "secondaryConversions": ["supporting actions"]
  },
  "existingImplementation": {
    "eventNamingConvention": "describe the naming pattern you observe (e.g., 'snake_case custom events', 'form_engagement_n numbered steps', 'standard GA4 recommended events')",
    "customSchemaDetected": true/false,
    "observedEvents": ["list every distinct event name you can see in the data"],
    "observedParameters": ["notable custom parameters you spotted"],
    "sophisticationLevel": "basic|intermediate|advanced|enterprise",
    "notes": "any observations about their implementation approach"
  },
  "pageAnalysis": {
    "pageType": "what type of page this is",
    "visibleCTAs": [
      {
        "text": "CTA button/link text",
        "location": "where on the page",
        "purpose": "what this CTA does",
        "interactionType": "click|select|hover|auto-advance"
      }
    ],
    "forms": [
      {
        "type": "form type (multi-step, single-page, auto-advancing, etc.)",
        "fields": ["visible form fields"],
        "behavior": "describe how the form works — does it auto-advance? require a submit button? use steps?"
      }
    ],
    "navigationStructure": "brief description of the site's nav layout"
  },
  "journeyPlan": {
    "personas": [
      {
        "name": "descriptive persona name",
        "intent": "what this user is trying to accomplish",
        "expectedPath": ["page/step descriptions"],
        "keyMoments": ["the important interaction points to watch for tracking"]
      }
    ],
    "nextAction": {
      "action": "click|select|scroll|type|navigate",
      "target": "specific element to interact with",
      "interactionNote": "any special handling needed (e.g., 'this is a dropdown - select an option, form may auto-advance')",
      "reasoning": "why this is the next step"
    }
  }
}`;
}

/**
 * Subsequent page prompt: Analyze the current page in the context of the journey.
 */
export function buildPageAnalysisPrompt(pageContext) {
  const { url, stepNumber, totalSteps, currentPersona, previousPages, eventDetail, networkHitsSummary, eventsFired, existingImplementation } = pageContext;

  const previousPagesSummary = previousPages
    .map((p, i) => `  Step ${i + 1}: ${p.url} (${p.pageType}) — ${p.eventsFiredCount} events, tracking score: ${p.trackingScore}/100`)
    .join("\n");

  const implContext = existingImplementation
    ? `\nKNOWN IMPLEMENTATION PATTERN: ${existingImplementation.eventNamingConvention || "unknown"}
SOPHISTICATION: ${existingImplementation.sophisticationLevel || "unknown"}
PREVIOUSLY OBSERVED EVENTS: ${(existingImplementation.observedEvents || []).join(", ")}`
    : "";

  return `You are on step ${stepNumber} of navigating this website.

CURRENT PERSONA: ${currentPersona.name}
PERSONA INTENT: ${currentPersona.intent}
${implContext}

JOURNEY SO FAR:
${previousPagesSummary}

CURRENT PAGE: ${url}

FULL EVENT DATA FROM THIS PAGE (study this carefully — look at names AND parameters):
${eventDetail}

NETWORK HITS ON THIS PAGE:
${networkHitsSummary}

EVENTS FIRED DURING NAVIGATION TO THIS PAGE:
${eventsFired}

CRITICAL REMINDERS:
- Study the ACTUAL events and parameters. Don't assume things are missing if you see custom events covering the same purpose.
- If this is a multi-step form and you haven't reached the end, do NOT flag form_submit as missing.
- If you see numbered events (form_engagement_1, step_2, etc.), that's a PATTERN — describe it, don't replace it.
- If the form auto-advances on selection, describe that behavior and choose "select" as your next action type.
- Only flag genuine gaps — things that truly aren't being tracked in any form.

Respond with JSON:
{
  "pageAnalysis": {
    "pageType": "page type",
    "funnelPosition": "awareness|consideration|decision|conversion|post-conversion",
    "formBehavior": "describe how the form/page works (auto-advancing, multi-step, standard submit, etc.) or null if no form",
    "visibleCTAs": [
      {
        "text": "CTA text",
        "location": "position on page",
        "purpose": "intent",
        "interactionType": "click|select|auto-advance"
      }
    ],
    "contentRelevance": "how relevant is this page to the persona's intent"
  },
  "analyticsAssessment": {
    "eventsObserved": [
      {
        "eventName": "exact event name from the data",
        "parameters": ["notable parameters"],
        "purpose": "what this event appears to track",
        "quality": "good|adequate|needs-improvement|misconfigured"
      }
    ],
    "customSchemaAnalysis": "describe any custom event naming patterns or parameter schemas you observe",
    "trackingCoverage": {
      "whatIsTracked": ["user actions that ARE being tracked on this page"],
      "whatIsNotTracked": ["user actions that genuinely are NOT tracked (be conservative — only list if you're confident)"],
      "tooEarlyToTell": ["things you can't assess yet because you haven't progressed far enough"]
    },
    "trackingScore": 0-100,
    "issues": [
      {
        "severity": "critical|high|medium|low",
        "issue": "specific problem you observed",
        "evidence": "what data led you to this conclusion",
        "recommendation": "specific fix that respects their existing implementation patterns"
      }
    ]
  },
  "nextAction": {
    "action": "click|select|scroll|type|navigate|complete",
    "target": "specific element to interact with (for select: the option to choose, for click: the button text)",
    "interactionNote": "special handling (e.g., 'dropdown auto-advances on selection', 'need to scroll to reveal form fields')",
    "reasoning": "why this advances the user journey",
    "isConversionStep": true/false
  },
  "journeyInsights": "observations about funnel flow, UX patterns, or tracking — be specific and reference actual data you observed"
}`;
}

/**
 * Journey summary prompt: After completing a full user journey,
 * synthesize findings into an actionable report.
 */
export function buildJourneySummaryPrompt(journeyData) {
  const { domain, businessAnalysis, persona, steps, totalEventsFound, totalEventsMissing, existingImplementation } = journeyData;

  const stepSummaries = steps
    .map((s, i) => {
      const observed = (s.analysis?.analyticsAssessment?.eventsObserved || [])
        .map(e => `${e.eventName} (${e.quality})`)
        .join(", ");
      return `Step ${i + 1}: ${s.url}\n  Page type: ${s.pageType}\n  Funnel: ${s.funnelPosition}\n  Tracking score: ${s.trackingScore}/100\n  Events observed: ${observed || "none"}\n  Gaps identified: ${(s.analysis?.analyticsAssessment?.trackingCoverage?.whatIsNotTracked || []).join(", ") || "none confirmed"}`;
    })
    .join("\n\n");

  const implSummary = existingImplementation
    ? `\nEXISTING IMPLEMENTATION:
Convention: ${existingImplementation.eventNamingConvention || "unknown"}
Sophistication: ${existingImplementation.sophisticationLevel || "unknown"}
Custom schema: ${existingImplementation.customSchemaDetected ? "Yes" : "No"}`
    : "";

  return `You've completed a full user journey analysis. Synthesize your findings.

IMPORTANT: Your recommendations must RESPECT the site's existing implementation patterns. Don't suggest replacing a working custom schema with generic GA4 events. Instead, suggest improvements WITHIN their existing framework. If they use "form_engagement_n" events, suggest adding parameters to those events — don't suggest switching to "form_submit".

DOMAIN: ${domain}
BUSINESS: ${JSON.stringify(businessAnalysis)}
${implSummary}

PERSONA: ${persona.name}
INTENT: ${persona.intent}

JOURNEY STEPS:
${stepSummaries}

Produce a final journey report as JSON:
{
  "journeySummary": {
    "persona": "${persona.name}",
    "pathCompleted": true/false,
    "stepsCompleted": ${steps.length},
    "overallTrackingScore": 0-100,
    "implementationMaturity": "basic|intermediate|advanced|enterprise",
    "funnelIntegrity": "assessment of the full funnel instrumentation"
  },
  "implementationStrengths": [
    "things their implementation does well — be specific"
  ],
  "genuineGaps": [
    {
      "step": "which step",
      "gap": "what's actually missing (not just different from textbook)",
      "evidence": "how you know it's missing vs. just implemented differently",
      "businessImpact": "revenue/data impact",
      "priority": "critical|high|medium",
      "implementation": {
        "approach": "describe the fix in terms of their existing patterns",
        "eventName": "event name that fits their naming convention",
        "parameters": {"param": "description"},
        "notes": "implementation specifics using their GTM setup"
      }
    }
  ],
  "improvementOpportunities": [
    {
      "observation": "something that works but could be better",
      "currentState": "how it works now",
      "suggestedImprovement": "specific enhancement",
      "effort": "low|medium|high",
      "impact": "low|medium|high"
    }
  ],
  "funnelRecommendations": [
    {
      "observation": "funnel flow or UX observation",
      "recommendation": "what to change",
      "type": "tracking|ux|architecture"
    }
  ]
}`;
}
