/**
 * domains-router.js — REST API for domain agent management
 *
 * All routes require a valid Google OAuth Bearer token.
 * The authenticated user can only access their own domain agents.
 *
 * Routes:
 *   POST   /domains                       Create a domain agent
 *   GET    /domains                       List user's domain agents
 *   GET    /domains/:id                   Get a single domain agent
 *   PATCH  /domains/:id/config            Update GA4/GTM/BQ IDs
 *   POST   /domains/:id/service-account   Upload SA JSON key
 *   DELETE /domains/:id/service-account   Remove SA key
 *   POST   /domains/:id/test-connection   Validate SA against GA4/GTM/BQ
 *   POST   /domains/:id/analyze           Enriched analysis (crawl + GA4 + GTM + BQ)
 *   GET    /domains/:id/analyses          List past analyses
 */

import { Router } from "express";
import { authMiddleware, verifyToken } from "./auth.js";
import {
  upsertUser,
  createDomain,
  getDomain,
  listDomains,
  updateDomainConfig,
  updateDomainSA,
  updateDomainConnectionStatus,
  deleteDomain,
  saveAnalysis,
  listAnalyses,
} from "./db.js";
import { storeSAKey, getSAKey, deleteSAKey, validateSAJson } from "./secrets.js";
import { getGA4Snapshot, getGA4PropertyMeta, testGA4Access } from "./ga4.js";
import { getGTMContainerSummary, testGTMAccess } from "./gtm.js";
import { queryGA4Events, queryGA4ConversionDetails, testBQAccess } from "./bigquery.js";
import { analyzeFullScan } from "./agent.js";

const router = Router();

// All /domains routes require authentication
router.use(authMiddleware);

// ─── Upsert user on every authenticated request ───────────────────────────────
router.use(async (req, _res, next) => {
  try {
    await upsertUser(req.user.sub, req.user.email);
  } catch { /* non-fatal */ }
  next();
});

// ─── Helper: assert domain ownership ─────────────────────────────────────────
async function requireOwnedDomain(domainId, ownerSub, res) {
  const domain = await getDomain(domainId);
  if (!domain) {
    res.status(404).json({ error: "Domain agent not found" });
    return null;
  }
  if (domain.ownerSub !== ownerSub) {
    res.status(403).json({ error: "Not authorized to access this domain agent" });
    return null;
  }
  return domain;
}

// ─── POST /domains — Create domain agent ─────────────────────────────────────
router.post("/", async (req, res) => {
  const { hostname, displayName } = req.body;

  if (!hostname || typeof hostname !== "string") {
    return res.status(400).json({ error: "hostname is required" });
  }

  try {
    // Normalize: strip protocol and trailing slash
    const clean = hostname.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase().trim();
    if (!clean) return res.status(400).json({ error: "Invalid hostname" });

    const domain = await createDomain(req.user.sub, {
      hostname: clean,
      displayName: displayName || clean,
    });

    res.status(201).json({ success: true, domain });
  } catch (err) {
    console.error("[domains] create error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /domains — List domain agents ───────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const domains = await listDomains(req.user.sub);
    res.json({ success: true, domains });
  } catch (err) {
    console.error("[domains] list error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /domains/:id — Get single domain agent ───────────────────────────────
router.get("/:id", async (req, res) => {
  const domain = await requireOwnedDomain(req.params.id, req.user.sub, res);
  if (!domain) return;
  res.json({ success: true, domain });
});

// ─── PATCH /domains/:id/config — Update GA4/GTM/BQ IDs ──────────────────────
router.patch("/:id/config", async (req, res) => {
  const domain = await requireOwnedDomain(req.params.id, req.user.sub, res);
  if (!domain) return;

  try {
    const updated = await updateDomainConfig(req.params.id, req.user.sub, req.body);
    res.json({ success: true, updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── POST /domains/:id/service-account — Upload SA JSON key ──────────────────
router.post("/:id/service-account", async (req, res) => {
  const domain = await requireOwnedDomain(req.params.id, req.user.sub, res);
  if (!domain) return;

  const { serviceAccountJson } = req.body;
  if (!serviceAccountJson) {
    return res.status(400).json({ error: "serviceAccountJson is required" });
  }

  try {
    // Validate structure before storing
    const { email, projectId } = validateSAJson(serviceAccountJson);

    // Store in Secret Manager
    const secretId = await storeSAKey(req.params.id, serviceAccountJson);

    // Update domain record
    await updateDomainSA(req.params.id, req.user.sub, {
      saKeySecretId: secretId,
      saKeyEmail: email,
    });

    res.json({
      success: true,
      serviceAccount: { email, projectId, stored: true },
    });
  } catch (err) {
    console.error("[domains] SA upload error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ─── DELETE /domains/:id/service-account — Remove SA key ─────────────────────
router.delete("/:id/service-account", async (req, res) => {
  const domain = await requireOwnedDomain(req.params.id, req.user.sub, res);
  if (!domain) return;

  try {
    await deleteSAKey(req.params.id);
    await updateDomainSA(req.params.id, req.user.sub, {
      saKeySecretId: null,
      saKeyEmail: null,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /domains/:id/test-connection — Validate SA connectivity ─────────────
router.post("/:id/test-connection", async (req, res) => {
  const domain = await requireOwnedDomain(req.params.id, req.user.sub, res);
  if (!domain) return;

  if (!domain.saKeySecretId) {
    return res.status(400).json({ error: "No service account key uploaded yet" });
  }

  try {
    const saJson = await getSAKey(req.params.id);
    const results = { ga4: null, gtm: null, bq: null };

    // Run connection tests in parallel
    const tests = [];

    if (domain.ga4PropertyId) {
      tests.push(
        testGA4Access(domain.ga4PropertyId, saJson).then((r) => { results.ga4 = r; })
      );
    }
    if (domain.gtmContainerId) {
      tests.push(
        testGTMAccess(domain.gtmContainerId, saJson).then((r) => { results.gtm = r; })
      );
    }
    if (domain.bqProjectId && domain.bqDataset) {
      tests.push(
        testBQAccess(domain.bqProjectId, domain.bqDataset, saJson).then((r) => { results.bq = r; })
      );
    }

    await Promise.all(tests);

    // Persist connection status
    await updateDomainConnectionStatus(domain.domainId, {
      ga4Connected: results.ga4?.ok ?? domain.ga4Connected,
      gtmConnected: results.gtm?.ok ?? domain.gtmConnected,
      bqConnected: results.bq?.ok ?? domain.bqConnected,
    });

    res.json({ success: true, connections: results });
  } catch (err) {
    console.error("[domains] test-connection error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /domains/:id/analyze — Enriched analysis ────────────────────────────
router.post("/:id/analyze", async (req, res) => {
  const domain = await requireOwnedDomain(req.params.id, req.user.sub, res);
  if (!domain) return;

  const { crawlReport, mode = "ga4" } = req.body;

  try {
    const saJson = domain.saKeySecretId ? await getSAKey(req.params.id).catch(() => null) : null;

    // Collect GA4, GTM, BQ data in parallel (best-effort — failures don't block analysis)
    const [ga4Snapshot, ga4Meta, gtmSnapshot, bqSnapshot] = await Promise.all([
      domain.ga4Connected && saJson
        ? getGA4Snapshot(domain.ga4PropertyId, saJson).catch((e) => ({ error: e.message }))
        : null,
      domain.ga4Connected && saJson
        ? getGA4PropertyMeta(domain.ga4PropertyId, saJson).catch(() => null)
        : null,
      domain.gtmConnected && saJson
        ? getGTMContainerSummary(domain.gtmContainerId, saJson).catch((e) => ({ error: e.message }))
        : null,
      domain.bqConnected && saJson
        ? queryGA4Events(domain.bqProjectId, domain.bqDataset, saJson).catch((e) => ({ error: e.message }))
        : null,
    ]);

    // Build an enriched context for Gemini that layers in the live GA4/GTM/BQ data
    const enrichedReport = {
      ...crawlReport,
      connectedData: {
        ga4: ga4Snapshot
          ? { ...ga4Snapshot, propertyMeta: ga4Meta }
          : null,
        gtm: gtmSnapshot || null,
        bq: bqSnapshot || null,
        domain: {
          hostname: domain.hostname,
          ga4PropertyId: domain.ga4PropertyId,
          gtmContainerId: domain.gtmContainerId,
        },
      },
    };

    // Run Gemini analysis with the enriched context
    let aiAnalysis = null;
    try {
      aiAnalysis = await analyzeFullScan(enrichedReport);
    } catch (err) {
      console.warn("[domains] Gemini analysis failed:", err.message);
    }

    // Persist the analysis
    const crawlSummary = crawlReport
      ? {
          totalPages: crawlReport.pages?.length || 0,
          totalEvents: crawlReport.pages?.reduce((s, p) => s + (p.events?.length || 0), 0) || 0,
          startUrl: crawlReport.startUrl,
        }
      : null;

    const analysisId = await saveAnalysis(domain.domainId, {
      crawlSummary,
      ga4Snapshot,
      gtmSnapshot,
      bqSnapshot,
      aiAnalysis,
    });

    res.json({
      success: true,
      analysisId,
      ga4Snapshot,
      gtmSnapshot,
      bqSnapshot,
      aiAnalysis,
    });
  } catch (err) {
    console.error("[domains] analyze error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /domains/:id/analyses — List past analyses ──────────────────────────
router.get("/:id/analyses", async (req, res) => {
  const domain = await requireOwnedDomain(req.params.id, req.user.sub, res);
  if (!domain) return;

  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const analyses = await listAnalyses(req.params.id, limit);
    res.json({ success: true, analyses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /domains/:id — Delete domain agent ────────────────────────────────
router.delete("/:id", async (req, res) => {
  const domain = await requireOwnedDomain(req.params.id, req.user.sub, res);
  if (!domain) return;

  try {
    // Clean up SA key from Secret Manager first
    if (domain.saKeySecretId) {
      await deleteSAKey(req.params.id).catch(() => {});
    }
    await deleteDomain(req.params.id, req.user.sub);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
