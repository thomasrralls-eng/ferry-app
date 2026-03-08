/**
 * server.js — gd ferry scraper API
 *
 * Cloud Run HTTP service that exposes the scraper as a REST API.
 *
 * Endpoints:
 *   POST /scan/recon   — Quick recon scan (~5 pages, <60s)
 *   POST /scan/full    — Full scan (recon + deep crawl + report)
 *   POST /analyze      — Run AI analysis on previously collected scan data
 *   GET  /health       — Health check
 *
 * Query params:
 *   ?analyze=true      — Automatically run AI analysis after scan
 */

import express from "express";
import { reconScan, scanSite } from "@ferry/scraper";
import { analyzeReconScan, analyzeFullScan } from "./agent.js";
import { visualScan } from "./visual-agent.js";

const app = express();
app.use(express.json({ limit: "5mb" }));

const PORT = process.env.PORT || 8080;

// ─── Health check ───────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "ferry-scraper", version: "0.2.0", agent: "gemini-2.0-flash" });
});

// ─── Recon scan (quick) ─────────────────────────────────────────
app.post("/scan/recon", async (req, res) => {
  const { url, analyze = false } = req.body;

  if (!url) {
    return res.status(400).json({ error: "Missing required field: url" });
  }

  try {
    const startTime = Date.now();
    console.log(`[recon] Starting scan: ${url}`);

    const report = await reconScan(url);

    const scanDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[recon] Scan complete: ${url} (${scanDuration}s)`);

    // Run AI analysis if requested
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
  const { url, maxPages = 50, analyze = false } = req.body;

  if (!url) {
    return res.status(400).json({ error: "Missing required field: url" });
  }

  const pageLimit = Math.min(maxPages, 200);

  try {
    const startTime = Date.now();
    console.log(`[full] Starting scan: ${url} (max ${pageLimit} pages)`);

    const report = await scanSite(url, { maxPages: pageLimit });

    const scanDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[full] Scan complete: ${url} — ${scanDuration}s`);

    // Run AI analysis if requested
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
// Accepts a previously collected scan report and runs AI analysis.
// Useful for re-analyzing without re-crawling.
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
  const { url, maxSteps = 12, maxPersonas = 2, includeScreenshots = false } = req.body;

  if (!url) {
    return res.status(400).json({ error: "Missing required field: url" });
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

// ─── Start server ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`gd ferry scraper API v0.3.0 listening on port ${PORT}`);
  console.log(`AI agent: Gemini 2.0 Flash via Vertex AI`);
  console.log(`Endpoints: /scan/recon, /scan/full, /scan/visual, /analyze, /health`);
});
