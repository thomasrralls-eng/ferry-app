/**
 * visual-agent.js — Visual analytics agent orchestrator.
 *
 * Runs the core loop:
 *   1. Take screenshot of current page
 *   2. Capture dataLayer state + network hits
 *   3. Send screenshot + data to Gemini Vision for analysis
 *   4. Execute the agent's chosen next action (click, navigate, etc.)
 *   5. Repeat until journey is complete
 *
 * The agent is self-directed: it figures out what the business does,
 * plans user journeys, and navigates accordingly.
 */

import { GoogleAuth } from "google-auth-library";
import {
  buildVisualSystemPrompt,
  buildDomainResearchPrompt,
  buildPageAnalysisPrompt,
  buildJourneySummaryPrompt,
} from "./visual-prompt.js";

const VERTEX_API_BASE = "https://us-central1-aiplatform.googleapis.com/v1";
const MODEL = "gemini-2.0-flash-001";
const MAX_JOURNEY_STEPS = 12;

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

async function getAccessToken() {
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token;
}

/**
 * Call Gemini with a screenshot (multimodal) + text prompt.
 *
 * @param {string} systemPrompt
 * @param {string} textPrompt
 * @param {Buffer} [screenshotBuffer] - PNG screenshot as Buffer
 * @param {Object} [options]
 * @returns {Promise<Object>} Parsed JSON response
 */
async function callGeminiVision(systemPrompt, textPrompt, screenshotBuffer, options = {}) {
  const { maxTokens = 4096, temperature = 0.3 } = options;

  const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "ferry-prod";
  const location = process.env.GCP_REGION || "us-central1";
  const token = await getAccessToken();

  const endpoint = `${VERTEX_API_BASE}/projects/${projectId}/locations/${location}/publishers/google/models/${MODEL}:generateContent`;

  // Build the content parts — text + optional image
  const parts = [];

  if (screenshotBuffer) {
    parts.push({
      inlineData: {
        mimeType: "image/png",
        data: screenshotBuffer.toString("base64"),
      },
    });
  }

  parts.push({ text: textPrompt });

  const body = {
    contents: [{ role: "user", parts }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
      responseMimeType: "application/json",
    },
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Vertex AI Vision error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty response from Gemini Vision");

  // Parse JSON response
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Could not parse vision response as JSON");
  }
}

/**
 * Capture the current page state: screenshot, dataLayer events, network hits.
 *
 * @param {import('puppeteer').Page} page
 * @returns {Promise<Object>} Page state snapshot
 */
async function capturePageState(page) {
  // Take screenshot
  const screenshot = await page.screenshot({
    type: "png",
    fullPage: false, // Viewport only — what the user sees
    encoding: "binary",
  });

  // Capture dataLayer events
  const dataLayerState = await page.evaluate(() => {
    const events = window.__ferryEvents || [];
    const dl = window.dataLayer || [];
    return {
      ferryEvents: JSON.parse(JSON.stringify(events.slice(-20))), // Last 20 events
      dataLayerLength: dl.length,
      dataLayerRecent: JSON.parse(JSON.stringify(dl.slice(-10))),
    };
  }).catch(() => ({ ferryEvents: [], dataLayerLength: 0, dataLayerRecent: [] }));

  // Capture analytics presence
  const analyticsStack = await page.evaluate(() => {
    return {
      hasGtm: !!document.querySelector('script[src*="googletagmanager.com/gtm.js"]'),
      hasGtagJs: !!document.querySelector('script[src*="googletagmanager.com/gtag/js"]'),
      hasGa4: typeof gtag === "function" || !!document.querySelector('script[src*="google-analytics.com"]'),
    };
  }).catch(() => ({ hasGtm: false, hasGtagJs: false, hasGa4: false }));

  return { screenshot, dataLayerState, analyticsStack };
}

/**
 * Build detailed event data for the prompt.
 * Shows full event payloads so the agent can analyze parameters,
 * naming conventions, and custom schemas — not just event names.
 */
function buildEventDetail(dataLayerState, networkHits, analyticsStack) {
  // Filter out GTM noise, keep real events with full detail
  const gtmNoise = new Set(["gtm.js", "gtm.dom", "gtm.load", "gtm.click",
    "gtm.linkClick", "gtm.formSubmit", "gtm.historyChange",
    "gtm.scrollDepth", "gtm.timer", "gtm.video"]);

  const meaningfulEvents = [];
  const noiseCount = { total: 0, types: {} };

  for (const evt of dataLayerState.ferryEvents) {
    const name = evt.eventName || evt.event || evt.type || "";
    if (gtmNoise.has(name)) {
      noiseCount.total++;
      noiseCount.types[name] = (noiseCount.types[name] || 0) + 1;
      continue;
    }
    // Keep full payload but truncate very long values
    const cleaned = JSON.parse(JSON.stringify(evt, (key, val) => {
      if (typeof val === "string" && val.length > 200) return val.slice(0, 200) + "...";
      return val;
    }));
    meaningfulEvents.push(cleaned);
  }

  // Also include raw dataLayer entries (these often have the custom event names)
  const rawDlEvents = [];
  for (const entry of dataLayerState.dataLayerRecent) {
    if (entry && typeof entry === "object") {
      const name = entry.event || "";
      if (!gtmNoise.has(name)) {
        const cleaned = JSON.parse(JSON.stringify(entry, (key, val) => {
          if (typeof val === "string" && val.length > 200) return val.slice(0, 200) + "...";
          return val;
        }));
        rawDlEvents.push(cleaned);
      }
    }
  }

  let eventDetail = "";

  if (meaningfulEvents.length > 0 || rawDlEvents.length > 0) {
    eventDetail += `CAPTURED EVENTS (${meaningfulEvents.length} meaningful, ${noiseCount.total} GTM noise filtered out):\n`;
    // Show full payloads for up to 15 events to stay within token limits
    const eventsToShow = meaningfulEvents.slice(0, 15);
    eventDetail += JSON.stringify(eventsToShow, null, 2);

    if (rawDlEvents.length > 0) {
      eventDetail += `\n\nRAW DATALAYER ENTRIES (most recent):\n`;
      eventDetail += JSON.stringify(rawDlEvents.slice(0, 10), null, 2);
    }
  } else {
    eventDetail = `No meaningful events detected (${noiseCount.total} GTM internal events filtered).`;
  }

  const networkHitsSummary = networkHits.length > 0
    ? networkHits.map(h => {
        const parts = [`type: ${h.hitType || "unknown"}`];
        if (h.hasUserId) parts.push("has_user_id");
        if (h.customDimensionCount) parts.push(`custom_dims: ${h.customDimensionCount}`);
        return `  - ${parts.join(", ")}`;
      }).join("\n")
    : "No GA4 network hits detected.";

  return {
    eventDetail,
    networkHitsSummary,
    analyticsStack: JSON.stringify(analyticsStack),
  };
}

/**
 * Execute an action chosen by the agent (click, navigate, type, scroll).
 *
 * @param {import('puppeteer').Page} page
 * @param {Object} action - The agent's chosen action
 * @returns {Promise<boolean>} Whether the action succeeded
 */
async function executeAction(page, action) {
  const { action: actionType, target } = action;

  try {
    switch (actionType) {
      case "click": {
        // Try to find the element by text content
        const clicked = await page.evaluate((targetText) => {
          const lower = targetText.toLowerCase();

          // Search through clickable elements
          const selectors = "a, button, [role='button'], input[type='submit'], [onclick]";
          const elements = document.querySelectorAll(selectors);

          for (const el of elements) {
            const text = (el.textContent || el.value || el.getAttribute("aria-label") || "").trim().toLowerCase();
            if (text.includes(lower) || lower.includes(text)) {
              el.scrollIntoView({ behavior: "instant", block: "center" });
              el.click();
              return true;
            }
          }

          // Fallback: try partial match on href
          const links = document.querySelectorAll("a[href]");
          for (const link of links) {
            const href = link.href.toLowerCase();
            const text = link.textContent.trim().toLowerCase();
            if (text.includes(lower) || href.includes(lower)) {
              link.scrollIntoView({ behavior: "instant", block: "center" });
              link.click();
              return true;
            }
          }

          return false;
        }, target);

        if (!clicked) {
          console.warn(`[visual] Could not find clickable element: "${target}"`);
          return false;
        }

        // Wait for navigation or network settle
        await Promise.race([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }),
          new Promise(r => setTimeout(r, 5000)),
        ]).catch(() => {});

        return true;
      }

      case "navigate": {
        // Direct URL navigation
        try {
          const targetUrl = new URL(target, page.url()).href;
          await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
          return true;
        } catch {
          console.warn(`[visual] Navigation failed: ${target}`);
          return false;
        }
      }

      case "scroll": {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8));
        await new Promise(r => setTimeout(r, 1500));
        return true;
      }

      case "type": {
        // Find first visible input and type
        const typed = await page.evaluate((text) => {
          const inputs = document.querySelectorAll("input:not([type='hidden']):not([type='submit']), textarea");
          for (const input of inputs) {
            if (input.offsetParent !== null) {
              input.focus();
              input.value = text;
              input.dispatchEvent(new Event("input", { bubbles: true }));
              return true;
            }
          }
          return false;
        }, target);
        return typed;
      }

      case "select": {
        // Select an option from a dropdown, radio button, or clickable option
        const selected = await page.evaluate((targetText) => {
          const lower = targetText.toLowerCase();

          // Try select/option elements first
          const selects = document.querySelectorAll("select");
          for (const sel of selects) {
            for (const opt of sel.options) {
              if (opt.text.toLowerCase().includes(lower) || opt.value.toLowerCase().includes(lower)) {
                sel.value = opt.value;
                sel.dispatchEvent(new Event("change", { bubbles: true }));
                return "select-option";
              }
            }
          }

          // Try radio buttons / checkboxes
          const labels = document.querySelectorAll("label");
          for (const label of labels) {
            if (label.textContent.toLowerCase().includes(lower)) {
              const input = label.querySelector("input") || document.getElementById(label.htmlFor);
              if (input) {
                input.click();
                return "radio-or-checkbox";
              }
              label.click();
              return "label-click";
            }
          }

          // Try clickable divs/cards that look like options
          const allEls = document.querySelectorAll("[role='option'], [role='radio'], [data-value], .option, .choice, [class*='option'], [class*='select']");
          for (const el of allEls) {
            if (el.textContent.toLowerCase().includes(lower)) {
              el.scrollIntoView({ behavior: "instant", block: "center" });
              el.click();
              return "custom-option";
            }
          }

          // Fallback: any clickable element with matching text
          const all = document.querySelectorAll("*");
          for (const el of all) {
            const text = el.textContent?.trim().toLowerCase() || "";
            const directText = el.childNodes.length <= 2 ? text : "";
            if (directText && directText.includes(lower) && el.offsetParent !== null) {
              el.scrollIntoView({ behavior: "instant", block: "center" });
              el.click();
              return "text-match-click";
            }
          }

          return null;
        }, target);

        if (!selected) {
          console.warn(`[visual] Could not find selectable element: "${target}"`);
          return false;
        }

        console.log(`[visual] Selected via ${selected}: "${target}"`);

        // Wait for potential auto-advance or UI update
        await Promise.race([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }),
          new Promise(r => setTimeout(r, 3000)),
        ]).catch(() => {});

        return true;
      }

      case "complete": {
        // Journey is done
        return true;
      }

      default:
        console.warn(`[visual] Unknown action type: ${actionType}`);
        return false;
    }
  } catch (err) {
    console.error(`[visual] Action failed:`, err.message);
    return false;
  }
}

/**
 * Run a full visual analytics scan.
 *
 * @param {string} url - Starting URL
 * @param {Object} [options]
 * @param {number} [options.maxSteps=12] - Max pages to visit per journey
 * @param {number} [options.maxPersonas=2] - Max personas to simulate
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<Object>} Full visual analysis report
 */
export async function visualScan(url, options = {}) {
  const { maxSteps = MAX_JOURNEY_STEPS, maxPersonas = 2, onProgress } = options;

  const puppeteer = await import("puppeteer");
  const browser = await puppeteer.default.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1440,900",
    ],
    defaultViewport: { width: 1440, height: 900 },
  });

  const startTime = Date.now();
  const systemPrompt = buildVisualSystemPrompt();
  const report = {
    url,
    startedAt: new Date().toISOString(),
    businessAnalysis: null,
    journeys: [],
    overallScore: null,
    screenshots: [], // Store base64 screenshots for the shadow site
  };

  const progress = (phase, data) => {
    if (onProgress) onProgress({ phase, ...data });
    console.log(`[visual] ${phase}: ${JSON.stringify(data).slice(0, 200)}`);
  };

  try {
    // ─── Step 1: Land on homepage, research the domain ─────────
    progress("research", { message: "Analyzing homepage..." });

    const page = await browser.newPage();
    await page.setUserAgent("FerryBot/1.0 (+https://gdferry.com/bot)");

    // Set up network capture
    const networkHits = [];
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const reqUrl = req.url();
      if (reqUrl.includes("/g/collect") || reqUrl.includes("/collect?") || reqUrl.includes("/mp/collect")) {
        networkHits.push({ url: reqUrl, hitType: "ga4-collect", timestamp: new Date().toISOString() });
      }
      if (reqUrl.includes("googleadservices.com/pagead/conversion")) {
        networkHits.push({ url: reqUrl, hitType: "google-ads", timestamp: new Date().toISOString() });
      }
      req.continue();
    });

    // Inject Ferry hook before navigating
    await page.evaluateOnNewDocument(() => {
      window.__ferryEvents = [];
      window.dataLayer = window.dataLayer || [];
      const dl = window.dataLayer;
      const orig = dl.push.bind(dl);
      dl.push = function (...args) {
        args.forEach(item => {
          try {
            const clone = JSON.parse(JSON.stringify(item));
            window.__ferryEvents.push(clone);
          } catch {}
        });
        return orig(...args);
      };
    });

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000)); // Let events settle

    // Capture initial page state
    const homeState = await capturePageState(page);
    const homeData = buildEventDetail(homeState.dataLayerState, networkHits, homeState.analyticsStack);

    // Store homepage screenshot
    report.screenshots.push({
      url,
      step: 0,
      phase: "research",
      base64: homeState.screenshot.toString("base64"),
    });

    // Ask Gemini to research the domain
    const domainResearch = await callGeminiVision(
      systemPrompt,
      buildDomainResearchPrompt(url, homeData),
      homeState.screenshot,
      { maxTokens: 4096 }
    );

    report.businessAnalysis = domainResearch.businessAnalysis;
    report.existingImplementation = domainResearch.existingImplementation || null;
    progress("research", {
      message: `Identified: ${domainResearch.businessAnalysis?.industry}`,
      implementation: domainResearch.existingImplementation?.sophisticationLevel,
      personas: domainResearch.journeyPlan?.personas?.length || 0,
    });

    // ─── Step 2: Run journeys for each persona ─────────────────
    const personas = (domainResearch.journeyPlan?.personas || []).slice(0, maxPersonas);

    for (let pIdx = 0; pIdx < personas.length; pIdx++) {
      const persona = personas[pIdx];
      progress("journey", { message: `Starting journey: ${persona.name}`, persona: pIdx + 1, total: personas.length });

      const journey = {
        persona,
        steps: [],
        startedAt: new Date().toISOString(),
        completed: false,
      };

      // Start each persona journey from the homepage
      const journeyPage = await browser.newPage();
      await journeyPage.setUserAgent("FerryBot/1.0 (+https://gdferry.com/bot)");

      const journeyNetworkHits = [];
      await journeyPage.setRequestInterception(true);
      journeyPage.on("request", (req) => {
        const reqUrl = req.url();
        if (reqUrl.includes("/g/collect") || reqUrl.includes("/collect?") || reqUrl.includes("/mp/collect")) {
          journeyNetworkHits.push({ url: reqUrl, hitType: "ga4-collect", timestamp: new Date().toISOString() });
        }
        req.continue();
      });

      await journeyPage.evaluateOnNewDocument(() => {
        window.__ferryEvents = [];
        window.dataLayer = window.dataLayer || [];
        const dl = window.dataLayer;
        const orig = dl.push.bind(dl);
        dl.push = function (...args) {
          args.forEach(item => {
            try {
              const clone = JSON.parse(JSON.stringify(item));
              window.__ferryEvents.push(clone);
            } catch {}
          });
          return orig(...args);
        };
      });

      await journeyPage.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));

      // If the domain research suggested a first action, use it
      let nextAction = domainResearch.journeyPlan?.nextAction;

      for (let step = 0; step < maxSteps; step++) {
        const stepStartHits = journeyNetworkHits.length;

        // Capture current state
        const state = await capturePageState(journeyPage);
        const currentUrl = journeyPage.url();
        const hitsSinceLastStep = journeyNetworkHits.slice(stepStartHits);
        const pageData = buildEventDetail(state.dataLayerState, hitsSinceLastStep, state.analyticsStack);

        // Store screenshot
        report.screenshots.push({
          url: currentUrl,
          step: step + 1,
          persona: persona.name,
          base64: state.screenshot.toString("base64"),
        });

        // If we have a pending action from the previous step, execute it first
        if (nextAction && step > 0) {
          progress("action", { step: step + 1, action: nextAction.action, target: nextAction.target });
          const success = await executeAction(journeyPage, nextAction);
          if (!success) {
            progress("action", { step: step + 1, message: "Action failed, analyzing current page" });
          }

          // Wait for events to settle after action
          await new Promise(r => setTimeout(r, 2000));

          // Re-capture state after action
          const postActionState = await capturePageState(journeyPage);
          const postActionUrl = journeyPage.url();

          // If we didn't navigate, use the post-action screenshot for analysis
          if (postActionUrl === currentUrl) {
            // Same page — maybe a modal or form interaction
          }
        }

        // Analyze this page
        const pageContext = {
          url: journeyPage.url(),
          stepNumber: step + 1,
          totalSteps: maxSteps,
          currentPersona: persona,
          previousPages: journey.steps,
          eventDetail: pageData.eventDetail,
          networkHitsSummary: pageData.networkHitsSummary,
          existingImplementation: report.existingImplementation,
          eventsFired: hitsSinceLastStep.length > 0
            ? `${hitsSinceLastStep.length} network hits fired during navigation`
            : "No network hits fired during navigation to this page",
        };

        const pageAnalysis = await callGeminiVision(
          systemPrompt,
          buildPageAnalysisPrompt(pageContext),
          state.screenshot,
          { maxTokens: 4096 }
        );

        // Record step — using new schema fields
        const assessment = pageAnalysis.analyticsAssessment || {};
        journey.steps.push({
          url: journeyPage.url(),
          pageType: pageAnalysis.pageAnalysis?.pageType || "unknown",
          funnelPosition: pageAnalysis.pageAnalysis?.funnelPosition || "unknown",
          formBehavior: pageAnalysis.pageAnalysis?.formBehavior || null,
          trackingScore: assessment.trackingScore || 0,
          eventsObserved: assessment.eventsObserved || [],
          trackingCoverage: assessment.trackingCoverage || {},
          issues: assessment.issues || [],
          eventsFiredCount: state.dataLayerState.ferryEvents.length,
          analysis: pageAnalysis,
        });

        progress("step", {
          step: step + 1,
          url: journeyPage.url(),
          score: pageAnalysis.analyticsAssessment?.trackingScore,
        });

        // Check if the agent says the journey is complete
        nextAction = pageAnalysis.nextAction;
        if (!nextAction || nextAction.action === "complete") {
          journey.completed = true;
          progress("journey", { message: `Journey complete: ${persona.name}`, steps: step + 1 });
          break;
        }
      }

      // Generate journey summary
      const totalEventsObserved = journey.steps.reduce((sum, s) => sum + (s.eventsObserved?.length || 0), 0);
      const totalGaps = journey.steps.reduce((sum, s) => sum + (s.trackingCoverage?.whatIsNotTracked?.length || 0), 0);

      const journeySummary = await callGeminiVision(
        systemPrompt,
        buildJourneySummaryPrompt({
          domain: new URL(url).hostname,
          businessAnalysis: report.businessAnalysis,
          persona,
          steps: journey.steps,
          totalEventsFound: totalEventsObserved,
          totalEventsMissing: totalGaps,
          existingImplementation: report.existingImplementation,
        }),
        null, // No screenshot needed for summary
        { maxTokens: 8192 }
      );

      journey.summary = journeySummary;
      report.journeys.push(journey);

      await journeyPage.close();
    }

    // ─── Step 3: Compute overall score ─────────────────────────
    const allScores = report.journeys
      .flatMap(j => j.steps.map(s => s.trackingScore))
      .filter(s => typeof s === "number");

    report.overallScore = allScores.length > 0
      ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
      : null;

    report.totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    report.completedAt = new Date().toISOString();

    await page.close();
  } catch (err) {
    report.error = err.message;
    console.error("[visual] Scan error:", err);
  } finally {
    await browser.close();
  }

  return report;
}
