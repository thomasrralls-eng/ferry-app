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
import { generateTestPersona, matchFieldToPersona, isFinalSubmit } from "./test-persona.js";

const VERTEX_API_BASE = "https://us-central1-aiplatform.googleapis.com/v1";
const MODEL = "gemini-2.0-flash-001";
const MAX_JOURNEY_STEPS = 12;

// Realistic Chrome UA — we declare ourselves as a bot via X-Robot-Info header
// and robots.txt compliance, but use a real UA to get the actual user experience
const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

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
 * Includes retry logic and safety filter handling.
 */
async function callGeminiVision(systemPrompt, textPrompt, screenshotBuffer, options = {}) {
  const { maxTokens = 4096, temperature = 0.3, retries = 2 } = options;

  const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "ferry-prod";
  const location = process.env.GCP_REGION || "us-central1";

  const endpoint = `${VERTEX_API_BASE}/projects/${projectId}/locations/${location}/publishers/google/models/${MODEL}:generateContent`;

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
    // Relaxed safety settings for analyzing diverse websites
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
    ],
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const token = await getAccessToken();
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000), // 60s timeout per Gemini call
      });

      if (!res.ok) {
        const errText = await res.text();
        // Retry on 429 (rate limit) or 503 (overloaded)
        if ((res.status === 429 || res.status === 503) && attempt < retries) {
          console.warn(`[visual] Gemini ${res.status}, retrying in ${(attempt + 1) * 2}s...`);
          await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
          continue;
        }
        throw new Error(`Vertex AI Vision error (${res.status}): ${errText}`);
      }

      const data = await res.json();

      // Check for safety filter blocks
      const candidate = data.candidates?.[0];
      if (candidate?.finishReason === "SAFETY") {
        console.warn("[visual] Gemini blocked response due to safety filters");
        return {
          _blocked: true,
          pageAnalysis: { pageType: "blocked-by-safety-filter", funnelPosition: "unknown" },
          analyticsAssessment: { trackingScore: 0, eventsObserved: [], trackingCoverage: {}, issues: [] },
          nextAction: { action: "navigate", target: "/", reasoning: "Safety filter blocked this page, moving on" },
        };
      }

      const text = candidate?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Empty response from Gemini Vision");

      try {
        return JSON.parse(text);
      } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        throw new Error("Could not parse vision response as JSON");
      }
    } catch (err) {
      if (attempt < retries && (err.name === "TimeoutError" || err.message.includes("ECONNRESET"))) {
        console.warn(`[visual] Gemini timeout/reset, retrying (${attempt + 1}/${retries})...`);
        await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Capture the current page state: screenshot, dataLayer events, network hits.
 * Captures from both main frame AND child frames (iframes).
 */
async function capturePageState(page) {
  const screenshot = await page.screenshot({
    type: "png",
    fullPage: false,
    encoding: "binary",
  });

  // Capture dataLayer events — with per-step reset via __ferryStepMarker
  const dataLayerState = await page.evaluate(() => {
    const events = window.__ferryEvents || [];
    const dl = window.dataLayer || [];
    const marker = window.__ferryStepMarker || 0;
    const stepEvents = events.slice(marker);
    // Update marker for next step
    window.__ferryStepMarker = events.length;
    return {
      ferryEvents: JSON.parse(JSON.stringify(stepEvents.slice(-30))),
      allTimeEventCount: events.length,
      dataLayerLength: dl.length,
      dataLayerRecent: JSON.parse(JSON.stringify(dl.slice(-10))),
    };
  }).catch(() => ({ ferryEvents: [], allTimeEventCount: 0, dataLayerLength: 0, dataLayerRecent: [] }));

  // Capture analytics presence — check multiple TMS vendors
  const analyticsStack = await page.evaluate(() => {
    return {
      // Google
      hasGtm: !!document.querySelector('script[src*="googletagmanager.com/gtm.js"]'),
      hasGtagJs: !!document.querySelector('script[src*="googletagmanager.com/gtag/js"]'),
      hasGa4: typeof gtag === "function" || !!document.querySelector('script[src*="google-analytics.com"]'),
      // Other TMS/CDPs
      hasSegment: typeof analytics !== "undefined" && typeof analytics.track === "function",
      hasTealium: typeof utag !== "undefined",
      hasAdobe: typeof s !== "undefined" && typeof s.tl === "function",
      // Pixels
      hasFbPixel: typeof fbq === "function",
      hasTikTok: typeof ttq !== "undefined",
      hasLinkedIn: !!document.querySelector('script[src*="snap.licdn.com"]'),
      // Consent
      hasOneTrust: !!document.querySelector('[class*="onetrust"]') || typeof OneTrust !== "undefined",
      hasCookiebot: typeof Cookiebot !== "undefined",
    };
  }).catch(() => ({ hasGtm: false, hasGtagJs: false, hasGa4: false }));

  // Check for content in iframes (forms, widgets, etc.)
  const iframeData = await page.evaluate(() => {
    const iframes = document.querySelectorAll("iframe");
    const data = [];
    for (const iframe of iframes) {
      try {
        const src = iframe.src || "";
        const isAnalytics = src.includes("google") || src.includes("facebook") || src.includes("doubleclick");
        const isForm = iframe.offsetWidth > 200 && iframe.offsetHeight > 200;
        if (isForm || isAnalytics) {
          data.push({
            src: src.slice(0, 200),
            width: iframe.offsetWidth,
            height: iframe.offsetHeight,
            isVisible: iframe.offsetParent !== null,
          });
        }
      } catch {}
    }
    return data;
  }).catch(() => []);

  return { screenshot, dataLayerState, analyticsStack, iframeData };
}

/**
 * Build detailed event data for the prompt.
 * Shows full event payloads so the agent can analyze parameters,
 * naming conventions, and custom schemas — not just event names.
 */
function buildEventDetail(dataLayerState, networkHits, analyticsStack, iframeData) {
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
    const cleaned = JSON.parse(JSON.stringify(evt, (key, val) => {
      if (typeof val === "string" && val.length > 200) return val.slice(0, 200) + "...";
      return val;
    }));
    meaningfulEvents.push(cleaned);
  }

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
    eventDetail += `CAPTURED EVENTS THIS STEP (${meaningfulEvents.length} meaningful, ${noiseCount.total} GTM noise filtered, ${dataLayerState.allTimeEventCount} total across journey):\n`;
    const eventsToShow = meaningfulEvents.slice(0, 15);
    eventDetail += JSON.stringify(eventsToShow, null, 2);

    if (rawDlEvents.length > 0) {
      eventDetail += `\n\nRAW DATALAYER ENTRIES (most recent):\n`;
      eventDetail += JSON.stringify(rawDlEvents.slice(0, 10), null, 2);
    }
  } else {
    eventDetail = `No meaningful events detected this step (${noiseCount.total} GTM internal events filtered).`;
  }

  // Add TMS detection
  const tmsDetected = [];
  if (analyticsStack.hasGtm) tmsDetected.push("GTM");
  if (analyticsStack.hasSegment) tmsDetected.push("Segment");
  if (analyticsStack.hasTealium) tmsDetected.push("Tealium");
  if (analyticsStack.hasAdobe) tmsDetected.push("Adobe Analytics");
  if (analyticsStack.hasFbPixel) tmsDetected.push("Meta Pixel");
  if (analyticsStack.hasTikTok) tmsDetected.push("TikTok Pixel");
  if (tmsDetected.length > 0) {
    eventDetail += `\n\nTAG MANAGEMENT SYSTEMS DETECTED: ${tmsDetected.join(", ")}`;
  }

  // Add iframe info
  if (iframeData && iframeData.length > 0) {
    eventDetail += `\n\nIFRAMES ON PAGE (${iframeData.length}):`;
    for (const iframe of iframeData) {
      eventDetail += `\n  - ${iframe.src} (${iframe.width}x${iframe.height}, visible: ${iframe.isVisible})`;
    }
    eventDetail += "\nNote: Events inside iframes may not be captured. If a form lives in an iframe, the tracking assessment should note this limitation.";
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
 * Auto-dismiss cookie consent banners.
 * Tries common banner patterns and clicks accept/dismiss.
 */
async function dismissCookieBanners(page) {
  try {
    const dismissed = await page.evaluate(() => {
      const dismissTexts = [
        "accept all", "accept cookies", "accept", "agree", "got it",
        "i agree", "ok", "okay", "allow all", "allow cookies",
        "consent", "i understand", "dismiss", "close",
      ];
      const lower = (s) => (s || "").trim().toLowerCase();

      // Try common selectors first
      const selectors = [
        "[id*='cookie'] button", "[class*='cookie'] button",
        "[id*='consent'] button", "[class*='consent'] button",
        "[id*='onetrust'] button", "[class*='onetrust'] button",
        "[id*='gdpr'] button", "[class*='gdpr'] button",
        "[id*='privacy'] button", "[class*='privacy'] button",
        "[class*='banner'] button", "[role='dialog'] button",
        "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
        ".cc-btn.cc-dismiss", ".cc-accept",
      ];

      for (const sel of selectors) {
        const buttons = document.querySelectorAll(sel);
        for (const btn of buttons) {
          const text = lower(btn.textContent);
          if (dismissTexts.some(t => text.includes(t))) {
            btn.click();
            return `clicked: "${btn.textContent.trim()}"`;
          }
        }
      }

      // Fallback: any button/link with accept-like text
      const allButtons = document.querySelectorAll("button, a[role='button'], [class*='btn']");
      for (const btn of allButtons) {
        const text = lower(btn.textContent);
        if (text.length < 30 && dismissTexts.some(t => text.includes(t))) {
          btn.click();
          return `fallback clicked: "${btn.textContent.trim()}"`;
        }
      }

      return null;
    });

    if (dismissed) {
      console.log(`[visual] Cookie banner dismissed: ${dismissed}`);
      await new Promise(r => setTimeout(r, 1000));
    }
  } catch {
    // Ignore — banner dismissal is best-effort
  }
}

/**
 * Execute an action chosen by the agent.
 * Uses Puppeteer's native click (real mouse events) when possible,
 * falling back to synthetic clicks only as last resort.
 */
async function executeAction(page, action, { persona = null, stepContext = {} } = {}) {
  const { action: actionType, target } = action;

  try {
    switch (actionType) {
      case "click": {
        // ── Submission guard: NEVER click final submit buttons ──
        if (isFinalSubmit(target, { stepsCompleted: stepContext?.stepsCompleted || 0 })) {
          console.log(`[visual] BLOCKED final submit click: "${target}" — agent must not submit forms`);
          return false;
        }

        // Strategy: find element coordinates, then use Puppeteer's native click
        // This fires "trusted" events that work with modern frameworks
        const elementBox = await page.evaluate((targetText) => {
          const lower = targetText.toLowerCase().trim();

          function findBestClick(elements) {
            let best = null;
            let bestLen = Infinity;
            for (const el of elements) {
              const text = (el.textContent || el.value || el.getAttribute("aria-label") || "").trim().toLowerCase();
              if ((text.includes(lower) || lower.includes(text)) && text.length > 0) {
                // Check visibility more carefully — offsetParent is null for position:fixed
                const rect = el.getBoundingClientRect();
                const isVisible = rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0;
                if (isVisible && text.length < bestLen) {
                  best = el;
                  bestLen = text.length;
                }
              }
            }
            if (!best) return null;
            const rect = best.getBoundingClientRect();
            return {
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
              text: best.textContent.trim().slice(0, 50),
            };
          }

          const selectors = "a, button, [role='button'], input[type='submit'], [onclick], [class*='btn'], [class*='cta'], [tabindex]";
          const elements = document.querySelectorAll(selectors);
          const match = findBestClick(elements);
          if (match) return match;

          // Fallback: href match
          const links = document.querySelectorAll("a[href]");
          for (const link of links) {
            const href = link.href.toLowerCase();
            const text = link.textContent.trim().toLowerCase();
            if (text.includes(lower) || href.includes(lower)) {
              const rect = link.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, text: link.textContent.trim().slice(0, 50) };
              }
            }
          }
          return null;
        }, target);

        if (!elementBox) {
          console.warn(`[visual] Could not find clickable element: "${target}"`);
          return false;
        }

        // Use Puppeteer's native click — fires trusted events
        await page.mouse.click(elementBox.x, elementBox.y);
        console.log(`[visual] Clicked "${elementBox.text}" at (${Math.round(elementBox.x)}, ${Math.round(elementBox.y)})`);

        // Wait for navigation or network settle
        await Promise.race([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }),
          page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {}),
          new Promise(r => setTimeout(r, 5000)),
        ]).catch(() => {});

        return true;
      }

      case "navigate": {
        try {
          const targetUrl = new URL(target, page.url()).href;
          await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
          await dismissCookieBanners(page);
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
        // Persona-aware form filling: detect what field we're looking at
        // and pull the right value from the test persona.
        // The agent may pass a field description (e.g. "email address")
        // OR a literal value (e.g. "john@test.com") as target.

        // Find the target input and its metadata for persona matching
        const inputInfo = await page.evaluate((targetHint) => {
          const lower = targetHint.toLowerCase();
          const inputs = document.querySelectorAll("input:not([type='hidden']):not([type='submit']):not([type='radio']):not([type='checkbox']), textarea");

          let matched = null;
          let fallback = null;

          for (const input of inputs) {
            const rect = input.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0 || rect.top >= window.innerHeight) continue;

            const fieldInfo = {
              name: input.name || "",
              label: input.labels?.[0]?.textContent?.trim() || "",
              placeholder: input.placeholder || "",
              type: input.type || "",
              id: input.id || "",
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
            };

            // Check if this input matches the target hint
            const combined = `${fieldInfo.name} ${fieldInfo.label} ${fieldInfo.placeholder} ${fieldInfo.id}`.toLowerCase();
            if (combined.includes(lower) || lower.includes(fieldInfo.name.toLowerCase()) ||
                lower.includes(fieldInfo.label.toLowerCase().slice(0, 15))) {
              matched = fieldInfo;
              break;
            }

            // Track first visible empty input as fallback
            if (!fallback && !input.value) {
              fallback = fieldInfo;
            }
          }

          return matched || fallback || null;
        }, target);

        if (!inputInfo) return false;

        // Use persona to determine what value to type
        let valueToType = target; // Default: use agent's target text as literal value
        if (persona) {
          const personaValue = matchFieldToPersona(inputInfo, persona);
          if (personaValue) {
            valueToType = personaValue;
            console.log(`[visual] Persona match: field "${inputInfo.label || inputInfo.name || inputInfo.placeholder}" → "${valueToType}"`);
          }
        }

        // Click to focus, clear existing content, then type
        await page.mouse.click(inputInfo.x, inputInfo.y);
        // Select all + delete to clear existing content
        await page.keyboard.down("Control");
        await page.keyboard.press("a");
        await page.keyboard.up("Control");
        await page.keyboard.press("Backspace");
        await page.keyboard.type(valueToType, { delay: 30 });
        console.log(`[visual] Typed "${valueToType}" into "${inputInfo.label || inputInfo.name || inputInfo.placeholder}"`);
        return true;
      }

      case "select": {
        // Select an option from a dropdown, radio button, or clickable option.
        // Uses Puppeteer's native mouse click for reliability with modern frameworks.

        // First, try to find the element and get its coordinates
        const selectResult = await page.evaluate((targetText) => {
          const lower = targetText.toLowerCase().trim();

          function findSmallestMatch(elements) {
            let best = null;
            let bestLen = Infinity;
            for (const el of elements) {
              const text = el.textContent?.trim().toLowerCase() || "";
              if (text.includes(lower) && text.length < bestLen) {
                // Use getBoundingClientRect instead of offsetParent for visibility
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  best = { el, rect, text };
                  bestLen = text.length;
                }
              }
            }
            return best;
          }

          // 1. Native <select> / <option> — must use synthetic (Puppeteer can't click inside selects)
          const selects = document.querySelectorAll("select");
          for (const sel of selects) {
            for (const opt of sel.options) {
              if (opt.text.toLowerCase().includes(lower) || opt.value.toLowerCase().includes(lower)) {
                sel.value = opt.value;
                sel.dispatchEvent(new Event("change", { bubbles: true }));
                sel.dispatchEvent(new Event("input", { bubbles: true }));
                return { method: "select-option", synthetic: true };
              }
            }
          }

          // 2. Radio buttons / checkboxes — find by value or label, return coords
          // DO NOT check offsetParent — styled radio inputs are often visually hidden
          const inputs = document.querySelectorAll("input[type='radio'], input[type='checkbox']");
          for (const input of inputs) {
            const matchByValue = input.value.toLowerCase().includes(lower);
            const label = input.labels?.[0] || input.closest("label") || (input.id && document.querySelector(`label[for="${input.id}"]`));
            const matchByLabel = label && label.textContent.toLowerCase().includes(lower);

            if (matchByValue || matchByLabel) {
              // For hidden inputs, click the label instead
              const clickTarget = label || input;
              const rect = clickTarget.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return {
                  method: matchByValue ? "input-value" : "label-input",
                  x: rect.x + rect.width / 2,
                  y: rect.y + rect.height / 2,
                  text: clickTarget.textContent?.trim().slice(0, 50),
                };
              }
              // If label is also hidden, try the parent container
              const parent = (label || input).closest("[class]");
              if (parent) {
                const pRect = parent.getBoundingClientRect();
                if (pRect.width > 0 && pRect.height > 0) {
                  return {
                    method: "parent-of-input",
                    x: pRect.x + pRect.width / 2,
                    y: pRect.y + pRect.height / 2,
                    text: parent.textContent?.trim().slice(0, 50),
                  };
                }
              }
            }
          }

          // 3. Labels without associated inputs
          const labels = document.querySelectorAll("label");
          for (const label of labels) {
            if (label.textContent.toLowerCase().includes(lower)) {
              const rect = label.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return { method: "label", x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, text: label.textContent.trim().slice(0, 50) };
              }
            }
          }

          // 4. ARIA roles
          const roleEls = document.querySelectorAll(
            "[role='option'], [role='radio'], [role='menuitem'], [role='listbox'] *, [role='radiogroup'] *, [data-value], [data-option]"
          );
          const roleMatch = findSmallestMatch(roleEls);
          if (roleMatch) {
            return { method: "aria-role", x: roleMatch.rect.x + roleMatch.rect.width / 2, y: roleMatch.rect.y + roleMatch.rect.height / 2, text: roleMatch.text.slice(0, 50) };
          }

          // 5. Class-based patterns
          const classEls = document.querySelectorAll(
            ".option, .choice, .card, .tile, .pill, " +
            "[class*='option'], [class*='select'], [class*='choice'], [class*='radio'], " +
            "[class*='card'], [class*='tile'], [class*='btn-group'] *, [class*='toggle'] *"
          );
          const classMatch = findSmallestMatch(classEls);
          if (classMatch) {
            return { method: "class-pattern", x: classMatch.rect.x + classMatch.rect.width / 2, y: classMatch.rect.y + classMatch.rect.height / 2, text: classMatch.text.slice(0, 50) };
          }

          // 6. Text-match fallback: smallest element with text
          const allElements = document.querySelectorAll("div, span, a, button, li, p, td, th, label");
          const textMatch = findSmallestMatch(allElements);
          if (textMatch) {
            return { method: "text-match", x: textMatch.rect.x + textMatch.rect.width / 2, y: textMatch.rect.y + textMatch.rect.height / 2, text: textMatch.text.slice(0, 50) };
          }

          return null;
        }, target);

        if (!selectResult) {
          console.warn(`[visual] Could not find selectable element: "${target}"`);
          return false;
        }

        if (selectResult.synthetic) {
          console.log(`[visual] Selected via ${selectResult.method}: "${target}"`);
        } else {
          // Use Puppeteer's native click for real mouse events
          await page.mouse.click(selectResult.x, selectResult.y);
          console.log(`[visual] Selected via ${selectResult.method}: "${selectResult.text}" at (${Math.round(selectResult.x)}, ${Math.round(selectResult.y)})`);
        }

        // Wait for potential auto-advance or UI update
        await Promise.race([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }),
          page.waitForNetworkIdle({ timeout: 3000 }).catch(() => {}),
          new Promise(r => setTimeout(r, 3000)),
        ]).catch(() => {});

        return true;
      }

      case "back": {
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
        return true;
      }

      case "fillForm": {
        // Fill ALL visible form fields at once using persona data.
        // The agent can use this to quickly fill multi-field forms.
        if (!persona) {
          console.warn("[visual] fillForm action requires a persona");
          return false;
        }

        const fields = await page.evaluate(() => {
          const inputs = document.querySelectorAll(
            "input:not([type='hidden']):not([type='submit']):not([type='radio']):not([type='checkbox']), textarea, select"
          );
          const result = [];
          for (const input of inputs) {
            const rect = input.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0 || rect.top >= window.innerHeight) continue;
            result.push({
              name: input.name || "",
              label: input.labels?.[0]?.textContent?.trim() || "",
              placeholder: input.placeholder || "",
              type: input.type || input.tagName.toLowerCase(),
              id: input.id || "",
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
              tagName: input.tagName.toLowerCase(),
              hasValue: !!input.value,
            });
          }
          return result;
        });

        let filled = 0;
        for (const field of fields) {
          if (field.hasValue) continue; // Skip pre-filled fields

          const value = matchFieldToPersona(field, persona);
          if (!value) continue;

          if (field.tagName === "select") {
            // For selects, set value via evaluate
            await page.evaluate(({ fieldId, fieldName, val }) => {
              const sel = fieldId ? document.getElementById(fieldId) : document.querySelector(`select[name="${fieldName}"]`);
              if (sel) {
                // Try exact match first, then partial
                for (const opt of sel.options) {
                  if (opt.value.toLowerCase().includes(val.toLowerCase()) || opt.text.toLowerCase().includes(val.toLowerCase())) {
                    sel.value = opt.value;
                    sel.dispatchEvent(new Event("change", { bubbles: true }));
                    break;
                  }
                }
              }
            }, { fieldId: field.id, fieldName: field.name, val: value });
          } else {
            // For text inputs: click, clear, type
            await page.mouse.click(field.x, field.y);
            await page.keyboard.down("Control");
            await page.keyboard.press("a");
            await page.keyboard.up("Control");
            await page.keyboard.press("Backspace");
            await page.keyboard.type(value, { delay: 20 });
          }
          filled++;
          console.log(`[visual] Filled "${field.label || field.name || field.placeholder}" → "${value}"`);
        }

        console.log(`[visual] fillForm: filled ${filled} of ${fields.length} fields`);
        return filled > 0;
      }

      case "complete": {
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
 * Set up a page for scanning — event hooks, network capture, dialog handling.
 */
async function setupPage(browser, url, networkHitsArr) {
  const page = await browser.newPage();
  await page.setUserAgent(CHROME_UA);
  await page.setExtraHTTPHeaders({ "X-Bot-Info": "gdfairy/1.0 (+https://www.gdfairy.com/bot)" });
  await page.setViewport({ width: 1440, height: 900 });

  // ── Stealth patches — hide headless Chrome fingerprints ──────
  await page.evaluateOnNewDocument(() => {
    // 1. Remove navigator.webdriver flag (the #1 detection signal)
    Object.defineProperty(navigator, "webdriver", { get: () => false });

    // 2. Fake plugins (headless Chrome has 0 plugins)
    Object.defineProperty(navigator, "plugins", {
      get: () => {
        const arr = [
          { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format" },
          { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
          { name: "Native Client", filename: "internal-nacl-plugin", description: "" },
        ];
        arr.item = (i) => arr[i];
        arr.namedItem = (n) => arr.find(p => p.name === n);
        arr.refresh = () => {};
        return arr;
      },
    });

    // 3. Fake languages (headless sometimes has empty)
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });

    // 4. Fix chrome.runtime (exists in real Chrome, missing in headless)
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) window.chrome.runtime = { connect: () => {}, sendMessage: () => {} };

    // 5. Fake permissions query (headless returns "prompt" for notifications)
    const origQuery = window.Permissions?.prototype?.query;
    if (origQuery) {
      window.Permissions.prototype.query = function (params) {
        if (params.name === "notifications") {
          return Promise.resolve({ state: "denied", onchange: null });
        }
        return origQuery.call(this, params);
      };
    }

    // 6. WebGL vendor/renderer (headless has "Google Inc." / "Google SwiftShader")
    const getParameterProto = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param) {
      if (param === 37445) return "Intel Inc."; // UNMASKED_VENDOR_WEBGL
      if (param === 37446) return "Intel Iris OpenGL Engine"; // UNMASKED_RENDERER_WEBGL
      return getParameterProto.call(this, param);
    };
  });

  // Handle dialogs (alert, confirm, prompt) — auto-dismiss
  page.on("dialog", async (dialog) => {
    console.log(`[visual] Dialog detected (${dialog.type()}): "${dialog.message().slice(0, 100)}"`);
    await dialog.dismiss().catch(() => {});
  });

  // Network capture
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const reqUrl = req.url();
    if (reqUrl.includes("/g/collect") || reqUrl.includes("/collect?") || reqUrl.includes("/mp/collect")) {
      networkHitsArr.push({ url: reqUrl, hitType: "ga4-collect", timestamp: new Date().toISOString() });
    }
    if (reqUrl.includes("googleadservices.com/pagead/conversion")) {
      networkHitsArr.push({ url: reqUrl, hitType: "google-ads", timestamp: new Date().toISOString() });
    }
    if (reqUrl.includes("facebook.com/tr") || reqUrl.includes("connect.facebook.net")) {
      networkHitsArr.push({ url: reqUrl, hitType: "meta-pixel", timestamp: new Date().toISOString() });
    }
    req.continue();
  });

  // Inject event capture hook BEFORE page loads
  await page.evaluateOnNewDocument(() => {
    window.__ferryEvents = [];
    window.__ferryStepMarker = 0;

    // Hook dataLayer.push
    window.dataLayer = window.dataLayer || [];
    const dl = window.dataLayer;
    const origPush = dl.push.bind(dl);
    dl.push = function (...args) {
      args.forEach(item => {
        try {
          const clone = JSON.parse(JSON.stringify(item));
          window.__ferryEvents.push(clone);
        } catch {}
      });
      return origPush(...args);
    };

    // Also watch for dataLayer being reassigned (some sites do this)
    let _dl = window.dataLayer;
    try {
      Object.defineProperty(window, "dataLayer", {
        get() { return _dl; },
        set(newVal) {
          if (Array.isArray(newVal)) {
            // Preserve our hook on the new array
            const origNewPush = newVal.push.bind(newVal);
            newVal.push = function (...args) {
              args.forEach(item => {
                try {
                  const clone = JSON.parse(JSON.stringify(item));
                  window.__ferryEvents.push(clone);
                } catch {}
              });
              return origNewPush(...args);
            };
          }
          _dl = newVal;
        },
        configurable: true,
      });
    } catch {}

    // Hook Segment analytics.track if it appears
    const origDescriptor = Object.getOwnPropertyDescriptor(window, "analytics");
    if (!origDescriptor) {
      let _analytics;
      Object.defineProperty(window, "analytics", {
        get() { return _analytics; },
        set(val) {
          if (val && typeof val.track === "function") {
            const origTrack = val.track.bind(val);
            val.track = function (name, props, ...rest) {
              try {
                window.__ferryEvents.push({ source: "segment", eventName: name, properties: JSON.parse(JSON.stringify(props || {})) });
              } catch {}
              return origTrack(name, props, ...rest);
            };
          }
          _analytics = val;
        },
        configurable: true,
      });
    }
  });

  return page;
}

/**
 * Validate a URL is safe to scan.
 */
function validateUrl(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`Invalid protocol: ${parsed.protocol}. Only http/https allowed.`);
    }
    // Block internal/private IPs
    const hostname = parsed.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname.startsWith("192.168.") || hostname.startsWith("10.") || hostname.startsWith("172.")) {
      throw new Error("Cannot scan internal/private addresses");
    }
    return parsed.href;
  } catch (err) {
    if (err.message.includes("Invalid URL")) {
      throw new Error(`Invalid URL: ${url}`);
    }
    throw err;
  }
}

/**
 * Run a full visual analytics scan.
 */
export async function visualScan(url, options = {}) {
  const { maxSteps = MAX_JOURNEY_STEPS, maxPersonas = 2, onProgress } = options;

  // Validate URL
  const safeUrl = validateUrl(url);

  const puppeteer = await import("puppeteer");
  const browser = await puppeteer.default.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1440,900",
      // Anti-detection flags
      "--disable-blink-features=AutomationControlled",
      "--disable-features=TranslateUI",
      "--disable-default-apps",
      "--disable-hang-monitor",
      "--disable-popup-blocking",
    ],
    defaultViewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"], // Remove "Chrome is being controlled by automated test software" bar
  });

  const startTime = Date.now();
  const systemPrompt = buildVisualSystemPrompt();
  const report = {
    url: safeUrl,
    startedAt: new Date().toISOString(),
    businessAnalysis: null,
    journeys: [],
    overallScore: null,
    screenshots: [],
  };

  const progress = (phase, data) => {
    if (onProgress) onProgress({ phase, ...data });
    console.log(`[visual] ${phase}: ${JSON.stringify(data).slice(0, 200)}`);
  };

  try {
    // ─── Step 1: Land on homepage, research the domain ─────────
    progress("research", { message: "Analyzing homepage..." });

    const networkHits = [];
    const page = await setupPage(browser, safeUrl, networkHits);

    // Use domcontentloaded + manual wait — networkidle2 times out on heavy sites
    await page.goto(safeUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    // Wait for JS-heavy sites to render (analytics tags, SPAs, etc.)
    await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));

    // Dismiss cookie banners before analyzing
    await dismissCookieBanners(page);
    await new Promise(r => setTimeout(r, 1000));

    const homeState = await capturePageState(page);
    const homeData = buildEventDetail(homeState.dataLayerState, networkHits, homeState.analyticsStack, homeState.iframeData);

    report.screenshots.push({
      url: safeUrl,
      step: 0,
      phase: "research",
      base64: homeState.screenshot.toString("base64"),
    });

    const domainResearch = await callGeminiVision(
      systemPrompt,
      buildDomainResearchPrompt(safeUrl, homeData),
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

      // Generate a synthetic test persona for form filling
      const testPersona = generateTestPersona();
      persona._testPersona = testPersona;
      console.log(`[visual] Generated test persona: ${testPersona.fullName} (${testPersona.email})`);

      const journey = {
        persona,
        steps: [],
        startedAt: new Date().toISOString(),
        completed: false,
      };

      const journeyNetworkHits = [];
      const journeyPage = await setupPage(browser, safeUrl, journeyNetworkHits);

      await journeyPage.goto(safeUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
      await journeyPage.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));
      await dismissCookieBanners(journeyPage);

      let nextAction = domainResearch.journeyPlan?.nextAction;
      let lastUrl = "";
      let sameUrlCount = 0;
      let consecutiveFailures = 0;
      let lastFailedAction = null;

      for (let step = 0; step < maxSteps; step++) {
        const stepStartHits = journeyNetworkHits.length;

        // Track if we're stuck on the same page
        const currentUrl = journeyPage.url();
        if (currentUrl === lastUrl) {
          sameUrlCount++;
        } else {
          sameUrlCount = 0;
          consecutiveFailures = 0;
          lastFailedAction = null;
        }
        lastUrl = currentUrl;

        // If stuck for too long, try fallback CTA (lowered threshold — trigger faster)
        if (sameUrlCount >= 2 && consecutiveFailures >= 2) {
          progress("stuck", { step: step + 1, message: "Stuck — trying fallback CTA click" });
          const fallbackBox = await journeyPage.evaluate(() => {
            const ctas = document.querySelectorAll(
              "a.btn, a.button, button.btn, button.cta, " +
              "[class*='cta'], [class*='primary'], [class*='main-btn'], " +
              "a[class*='button'], button[type='submit'], [class*='compare']"
            );
            for (const cta of ctas) {
              const rect = cta.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0 && cta.textContent.trim().length > 0 && cta.textContent.trim().length < 50) {
                return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, text: cta.textContent.trim() };
              }
            }
            return null;
          }).catch(() => null);

          if (fallbackBox) {
            await journeyPage.mouse.click(fallbackBox.x, fallbackBox.y);
            console.log(`[visual] Fallback CTA clicked: "${fallbackBox.text}" at (${Math.round(fallbackBox.x)}, ${Math.round(fallbackBox.y)})`);
            await Promise.race([
              journeyPage.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }),
              new Promise(r => setTimeout(r, 3000)),
            ]).catch(() => {});
            await new Promise(r => setTimeout(r, 2000));
          }
        }

        // Capture current state
        const state = await capturePageState(journeyPage);
        const postUrl = journeyPage.url();
        const hitsSinceLastStep = journeyNetworkHits.slice(stepStartHits);
        const pageData = buildEventDetail(state.dataLayerState, hitsSinceLastStep, state.analyticsStack, state.iframeData);

        report.screenshots.push({
          url: postUrl,
          step: step + 1,
          persona: persona.name,
          base64: state.screenshot.toString("base64"),
        });

        // Execute pending action from previous step
        if (nextAction && step > 0) {
          progress("action", { step: step + 1, action: nextAction.action, target: nextAction.target });

          // Capture a DOM fingerprint BEFORE the action to detect no-ops
          const preActionFingerprint = await journeyPage.evaluate(() => {
            // Quick fingerprint: URL + body text length + visible form state + scroll position
            const forms = [...document.querySelectorAll("input:checked, select")].map(el => el.value || el.checked).join(",");
            return `${document.title}|${document.body?.innerText?.length || 0}|${forms}|${window.scrollY}`;
          }).catch(() => "");

          const success = await executeAction(journeyPage, nextAction, {
            persona: journey.persona._testPersona,
            stepContext: { stepsCompleted: step },
          });

          await new Promise(r => setTimeout(r, 2000));

          // Check if the page actually changed (URL or DOM fingerprint)
          const postActionUrl = journeyPage.url();
          const postActionFingerprint = await journeyPage.evaluate(() => {
            const forms = [...document.querySelectorAll("input:checked, select")].map(el => el.value || el.checked).join(",");
            return `${document.title}|${document.body?.innerText?.length || 0}|${forms}|${window.scrollY}`;
          }).catch(() => "");

          const urlChanged = postActionUrl !== postUrl;
          const pageChanged = postActionFingerprint !== preActionFingerprint;
          const actionWorked = success && (urlChanged || pageChanged);

          if (!actionWorked) {
            consecutiveFailures++;
            lastFailedAction = `${nextAction.action}: "${nextAction.target}"`;
            const reason = !success ? "element not found" : "page did not change after action";
            progress("action", { step: step + 1, message: `Action ineffective (${reason}), attempt ${consecutiveFailures}` });
          } else {
            consecutiveFailures = 0;
            lastFailedAction = null;
          }

          if (urlChanged) {
            sameUrlCount = 0;
            consecutiveFailures = 0;
            lastFailedAction = null;
            lastUrl = postActionUrl;
          }
        }

        // Build stuck context
        let stuckContext = "";
        if (consecutiveFailures >= 1 && lastFailedAction) {
          stuckContext = `\n\nACTION FAILURE NOTICE: Your previous action (${lastFailedAction}) FAILED — the element could not be found or interacted with. You have failed ${consecutiveFailures} time(s) on this page. DO NOT suggest the same action again. Try a DIFFERENT approach:\n- Try "click" instead of "select" (or vice versa)\n- Use a different element text (e.g., the CTA button text like "Compare Rates" or "Get Started")\n- Try "scroll" to reveal hidden elements below the fold\n- Try "navigate" to go to a specific URL path directly\n- Try "back" to go back and take a different path`;
        }

        // Analyze this page
        const analysisUrl = journeyPage.url();
        const pageContext = {
          url: analysisUrl,
          stepNumber: step + 1,
          totalSteps: maxSteps,
          currentPersona: persona,
          previousPages: journey.steps,
          eventDetail: pageData.eventDetail + stuckContext,
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

        // Record step
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

        nextAction = pageAnalysis.nextAction;
        if (!nextAction || nextAction.action === "complete") {
          journey.completed = true;
          progress("journey", { message: `Journey complete: ${persona.name}`, steps: step + 1 });
          break;
        }

        // Safety: check total time — leave room for summary
        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed > 600) { // 10 min safety limit
          progress("timeout", { message: "Approaching time limit, wrapping up journey" });
          journey.completed = false;
          break;
        }
      }

      // Generate journey summary
      const totalEventsObserved = journey.steps.reduce((sum, s) => sum + (s.eventsObserved?.length || 0), 0);
      const totalGaps = journey.steps.reduce((sum, s) => sum + (s.trackingCoverage?.whatIsNotTracked?.length || 0), 0);

      const journeySummary = await callGeminiVision(
        systemPrompt,
        buildJourneySummaryPrompt({
          domain: new URL(safeUrl).hostname,
          businessAnalysis: report.businessAnalysis,
          persona,
          steps: journey.steps,
          totalEventsFound: totalEventsObserved,
          totalEventsMissing: totalGaps,
          existingImplementation: report.existingImplementation,
        }),
        null,
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
