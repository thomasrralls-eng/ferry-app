/**
 * agent.js — Vertex AI Gemini integration for the gd fairy AI agent.
 *
 * Calls Gemini 2.0 Flash to analyze scan results and produce
 * actionable GA4/GTM recommendations.
 */

import { GoogleAuth } from "google-auth-library";
import { buildSystemPrompt, buildAnalysisPrompt, buildFullAnalysisPrompt } from "./agent-prompt.js";

const VERTEX_API_BASE = "https://us-central1-aiplatform.googleapis.com/v1";
const MODEL = "gemini-2.0-flash-001";

// Reusable auth client — handles metadata server, ADC, service accounts automatically
const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

/**
 * Get an access token using Google's official auth library.
 * Automatically discovers credentials (metadata server on Cloud Run,
 * application default credentials locally).
 */
async function getAccessToken() {
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token;
}

/**
 * Call Gemini via the Vertex AI REST API.
 *
 * @param {string} systemPrompt - System instructions
 * @param {string} userPrompt - User message with scan data
 * @param {Object} [options]
 * @param {number} [options.maxTokens=4096]
 * @param {number} [options.temperature=0.2]
 * @returns {Promise<string>} Raw text response from Gemini
 */
async function callGemini(systemPrompt, userPrompt, options = {}) {
  const { maxTokens = 4096, temperature = 0.2 } = options;

  const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "fairy-prod";
  const location = process.env.GCP_REGION || "us-central1";
  const token = await getAccessToken();

  const endpoint = `${VERTEX_API_BASE}/projects/${projectId}/locations/${location}/publishers/google/models/${MODEL}:generateContent`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
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
    throw new Error(`Vertex AI API error (${res.status}): ${errText}`);
  }

  const data = await res.json();

  // Extract the text from Gemini's response
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Empty response from Gemini");
  }

  return text;
}

/**
 * Parse Gemini's JSON response, handling potential formatting issues.
 *
 * @param {string} text - Raw response text
 * @returns {Object} Parsed analysis
 */
function parseAgentResponse(text) {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // Sometimes Gemini wraps JSON in markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }

    // Try to find JSON object in the text
    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      return JSON.parse(braceMatch[0]);
    }

    throw new Error("Could not parse agent response as JSON");
  }
}

/**
 * Analyze a recon scan report using the AI agent.
 *
 * @param {Object} scanReport - Raw recon scan report
 * @returns {Promise<Object>} AI analysis with recommendations
 */
export async function analyzeReconScan(scanReport) {
  const startTime = Date.now();

  try {
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildAnalysisPrompt(scanReport);

    console.log("[agent] Sending recon data to Gemini for analysis...");

    const responseText = await callGemini(systemPrompt, userPrompt);
    const analysis = parseAgentResponse(responseText);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[agent] Analysis complete (${duration}s)`);

    return {
      success: true,
      analysis,
      model: MODEL,
      duration: `${duration}s`,
    };
  } catch (err) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[agent] Error (${duration}s):`, err.message);

    return {
      success: false,
      error: err.message,
      model: MODEL,
      duration: `${duration}s`,
    };
  }
}

/**
 * Analyze a full deep-crawl report using the AI agent.
 *
 * @param {Object} fullReport - Full scan report
 * @returns {Promise<Object>} AI analysis with recommendations
 */
export async function analyzeFullScan(fullReport) {
  const startTime = Date.now();

  try {
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildFullAnalysisPrompt(fullReport);

    console.log("[agent] Sending full scan data to Gemini for analysis...");

    const responseText = await callGemini(systemPrompt, userPrompt, {
      maxTokens: 8192, // More room for deeper analysis
    });
    const analysis = parseAgentResponse(responseText);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[agent] Full analysis complete (${duration}s)`);

    return {
      success: true,
      analysis,
      model: MODEL,
      duration: `${duration}s`,
    };
  } catch (err) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[agent] Error (${duration}s):`, err.message);

    return {
      success: false,
      error: err.message,
      model: MODEL,
      duration: `${duration}s`,
    };
  }
}
