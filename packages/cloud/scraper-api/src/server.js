/**
 * server.js — gd ferry scraper API
 *
 * Cloud Run HTTP service that exposes the scraper as a REST API.
 *
 * Endpoints:
 *   POST /scan/recon   — Quick recon scan (~5 pages, <60s)
 *   POST /scan/full    — Full scan (recon + deep crawl + report)
 *   GET  /health       — Health check
 */

import express from "express";
import { reconScan } from "@ferry/scraper";
import { scanSite } from "@ferry/scraper";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

// ─── Health check ───────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "ferry-scraper", version: "0.1.0" });
});

// ─── Recon scan (quick) ─────────────────────────────────────────
app.post("/scan/recon", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "Missing required field: url" });
  }

  try {
    const startTime = Date.now();
    console.log(`[recon] Starting scan: ${url}`);

    const report = await reconScan(url);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[recon] Complete: ${url} (${duration}s)`);

    res.json({
      success: true,
      scanType: "recon",
      duration: `${duration}s`,
      report,
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
  const { url, maxPages = 50 } = req.body;

  if (!url) {
    return res.status(400).json({ error: "Missing required field: url" });
  }

  // Cloud Run has a 60-min max timeout; set a reasonable default
  const pageLimit = Math.min(maxPages, 200);

  try {
    const startTime = Date.now();
    console.log(`[full] Starting scan: ${url} (max ${pageLimit} pages)`);

    const report = await scanSite(url, { maxPages: pageLimit });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[full] Complete: ${url} — ${duration}s`);

    res.json({
      success: true,
      scanType: "full",
      duration: `${duration}s`,
      report,
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

// ─── Start server ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`gd ferry scraper API listening on port ${PORT}`);
});
