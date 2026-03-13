/**
 * server.js — gd fairy scraper API
 *
 * Cloud Run HTTP service that exposes the scraper as a REST API.
 *
 * Endpoints:
 *   POST /scan/recon   — Quick recon scan (~5 pages, <60s)
 *   POST /scan/full    — Full scan (recon + deep crawl + report)
 *   POST /scan/visual  — AI-guided visual journey analysis
 *   POST /analyze      — Run AI analysis on previously collected scan data
 *   GET  /health       — Health check
 */

import express from "express";
import { reconScan, scanSite } from "@ferry/scraper";
import { analyzeReconScan, analyzeFullScan } from "./agent.js";
import { visualScan } from "./visual-agent.js";
import domainsRouter from "./domains-router.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

// ─── CORS — allow Chrome extension origins ────────────────────────────────────
app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  // Allow Chrome extension origins (chrome-extension://<id>) and localhost for dev
  if (origin.startsWith("chrome-extension://") || origin.startsWith("http://localhost")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const PORT = process.env.PORT || 8080;

// ─── Request tracking for basic rate limiting ────────────────────
const requestLog = new Map(); // ip -> { count, resetAt }
const RATE_LIMIT = 30; // requests per minute per IP
const RATE_WINDOW = 60_000;

function rateLimit(req, res, next) {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  const now = Date.now();
  const entry = requestLog.get(ip);

  if (!entry || now > entry.resetAt) {
    requestLog.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return next();
  }

  entry.count++;
  if (entry.count > RATE_LIMIT) {
    return res.status(429).json({ error: "Rate limit exceeded. Max 30 requests per minute." });
  }
  return next();
}

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of requestLog) {
    if (now > entry.resetAt) requestLog.delete(ip);
  }
}, 300_000);

// Apply rate limiting to scan endpoints
app.use("/scan", rateLimit);
app.use("/analyze", rateLimit);

// ─── Domain agent API ────────────────────────────────────────────
app.use("/domains", domainsRouter);

// ─── URL validation ──────────────────────────────────────────────
function validateUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const parsed = new URL(url.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    const h = parsed.hostname;
    if (h === "localhost" || h === "127.0.0.1" || h.startsWith("192.168.") || h.startsWith("10.") || h.startsWith("172.16.")) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

// ─── Health check ───────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "fairy-scraper", version: "0.4.0", agent: "gemini-2.0-flash" });
});

// ─── Recon scan (quick) ─────────────────────────────────────────
app.post("/scan/recon", async (req, res) => {
  const { url: rawUrl, analyze = false } = req.body;
  const url = validateUrl(rawUrl);

  if (!url) {
    return res.status(400).json({ error: "Missing or invalid URL. Must be a valid http/https URL." });
  }

  try {
    const startTime = Date.now();
    console.log(`[recon] Starting scan: ${url}`);

    const report = await reconScan(url);
    const scanDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[recon] Scan complete: ${url} (${scanDuration}s)`);

    let aiAnalysis = null;
    if (analyze) {
      aiAnalysis = await analyzeReconScan(report);
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);

    res.json({
      success: true,
      scanType: "recon",
      scanDuration: `${scanDuration}s`,
      totalDuration: `${totalDuration}s`,
      report,
      ...(aiAnalysis && { aiAnalysis }),
    });
  } catch (err) {
    console.error(`[recon] Error scanning ${url}:`, err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      scanType: "recon",
    });
  }
});

// ─── Full scan (recon + deep crawl + report) ────────────────────
app.post("/scan/full", async (req, res) => {
  const { url: rawUrl, maxPages = 50, analyze = false } = req.body;
  const url = validateUrl(rawUrl);

  if (!url) {
    return res.status(400).json({ error: "Missing or invalid URL. Must be a valid http/https URL." });
  }

  const pageLimit = Math.min(maxPages, 200);

  try {
    const startTime = Date.now();
    console.log(`[full] Starting scan: ${url} (max ${pageLimit} pages)`);

    const report = await scanSite(url, { maxPages: pageLimit });
    const scanDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[full] Scan complete: ${url} — ${scanDuration}s`);

    let aiAnalysis = null;
    if (analyze) {
      aiAnalysis = await analyzeFullScan(report);
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);

    res.json({
      success: true,
      scanType: "full",
      scanDuration: `${scanDuration}s`,
      totalDuration: `${totalDuration}s`,
      report,
      ...(aiAnalysis && { aiAnalysis }),
    });
  } catch (err) {
    console.error(`[full] Error scanning ${url}:`, err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      scanType: "full",
    });
  }
});

// ─── Standalone AI analysis ─────────────────────────────────────
app.post("/analyze", async (req, res) => {
  const { report, scanType = "recon" } = req.body;

  if (!report) {
    return res.status(400).json({ error: "Missing required field: report" });
  }

  try {
    const aiAnalysis = scanType === "full"
      ? await analyzeFullScan(report)
      : await analyzeReconScan(report);

    res.json({
      success: true,
      aiAnalysis,
    });
  } catch (err) {
    console.error(`[analyze] Error:`, err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// ─── Visual scan (AI-guided journey analysis) ──────────────────
app.post("/scan/visual", async (req, res) => {
  const { url: rawUrl, maxSteps = 12, maxPersonas = 2, includeScreenshots = false } = req.body;
  const url = validateUrl(rawUrl);

  if (!url) {
    return res.status(400).json({ error: "Missing or invalid URL. Must be a valid http/https URL." });
  }

  try {
    const startTime = Date.now();
    console.log(`[visual] Starting visual scan: ${url} (max ${maxSteps} steps, ${maxPersonas} personas)`);

    const report = await visualScan(url, {
      maxSteps: Math.min(maxSteps, 20),
      maxPersonas: Math.min(maxPersonas, 3),
    });

    // Strip screenshots from response unless requested (they're large)
    if (!includeScreenshots) {
      report.screenshotCount = report.screenshots?.length || 0;
      delete report.screenshots;
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[visual] Complete: ${url} — ${totalDuration}s`);

    res.json({
      success: true,
      scanType: "visual",
      totalDuration: `${totalDuration}s`,
      report,
    });
  } catch (err) {
    console.error(`[visual] Error scanning ${url}:`, err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      scanType: "visual",
    });
  }
});

// ─── 404 handler ────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Not found. Available endpoints: /scan/recon, /scan/full, /scan/visual, /analyze, /domains, /health" });
});

// ─── Global error handler ───────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("[server] Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ─── Start server ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`gd fairy scraper API v0.5.0 listening on port ${PORT}`);
  console.log(`AI agent: Gemini 2.0 Flash via Vertex AI`);
  console.log(`Endpoints: /scan/recon, /scan/full, /scan/visual, /analyze, /domains, /health`);
});
