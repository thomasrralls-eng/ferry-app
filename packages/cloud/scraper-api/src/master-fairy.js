/**
 * master-fairy.js — The Fairy Master: cross-domain learning aggregation
 *
 * The gd fairy network learns from every domain it analyzes. As more client
 * sites are processed, the master extracts common patterns by business type
 * and feeds those learnings back into every slave fairy's Gemini prompts.
 *
 * Architecture:
 *   Fairy Slave (per-domain agent) → saves analyses → Firestore
 *   Fairy Master                   → reads ALL analyses → extracts patterns
 *   Next analysis                  → master context injected into Gemini system prompt
 *
 * Firestore collections:
 *   /masterLearnings/{businessType}
 *     businessType:    string              — "ecommerce", "b2b-saas", etc.
 *     patterns:        Array<Pattern>      — common issues ordered by frequency
 *     domainCount:     number
 *     analysisCount:   number
 *     lastUpdatedAt:   Timestamp
 *
 *   Pattern shape:
 *     { pattern, frequency, count, severity, recommendation }
 */

import { Firestore, FieldValue } from "@google-cloud/firestore";

const db = new Firestore({ databaseId: "(default)" });

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Get master learnings for a specific business type.
 * Returns null if no learnings exist yet or on error (non-fatal).
 *
 * @param {string|null} businessType
 * @returns {Promise<Object|null>}
 */
export async function getMasterContext(businessType) {
  if (!businessType) return null;

  const key = businessType.toLowerCase().trim();
  try {
    const doc = await db.collection("masterLearnings").doc(key).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  } catch (err) {
    console.warn("[master-fairy] getMasterContext failed:", err.message);
    return null;
  }
}

/**
 * List all master learning documents.
 * @returns {Promise<Object[]>}
 */
export async function listMasterLearnings() {
  try {
    const snap = await db
      .collection("masterLearnings")
      .orderBy("analysisCount", "desc")
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("[master-fairy] listMasterLearnings failed:", err.message);
    return [];
  }
}

// ─── Aggregate ────────────────────────────────────────────────────────────────

/**
 * Aggregate analyses across ALL domain agents and extract common patterns
 * grouped by business type. Writes results to /masterLearnings/{businessType}.
 *
 * Strategy:
 *   1. Load all domain documents
 *   2. Group by agentContext.businessType
 *   3. For each group, fetch the N most recent analyses per domain
 *   4. Parse structured findings from each Gemini response
 *   5. Count frequency: how often does this pattern appear across all analyses?
 *   6. Write the top patterns back to Firestore
 *
 * @param {Object} options
 * @param {number} options.analysesPerDomain  — max analyses to read per domain (default 10)
 * @param {number} options.minFrequency       — min fraction (0–1) for inclusion (default 0.1)
 * @returns {Promise<{ summary: Object, duration: string }>}
 */
export async function aggregateLearnings({
  analysesPerDomain = 10,
  minFrequency = 0.1,
} = {}) {
  console.log("[master-fairy] Starting aggregation...");
  const startTime = Date.now();

  // 1. Load all domain documents
  const domainsSnap = await db.collection("domains").get();
  const domains = domainsSnap.docs.map((d) => ({ domainId: d.id, ...d.data() }));
  console.log(`[master-fairy] ${domains.length} total domains`);

  // 2. Group by business type
  const byType = new Map();
  for (const domain of domains) {
    const type = (domain.agentContext?.businessType || "other").toLowerCase().trim();
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(domain);
  }

  const summary = {};

  // 3. Process each business type
  for (const [businessType, typeDomains] of byType) {
    console.log(
      `[master-fairy] Processing "${businessType}" (${typeDomains.length} domains)`
    );

    // patternKey → { pattern, count, severity, recommendations: Set }
    const patternMap = new Map();
    let totalAnalyses = 0;

    // 4. Load recent analyses for each domain
    for (const domain of typeDomains) {
      try {
        const analysesSnap = await db
          .collection("domains")
          .doc(domain.domainId)
          .collection("analyses")
          .orderBy("createdAt", "desc")
          .limit(analysesPerDomain)
          .get();

        for (const analysisDoc of analysesSnap.docs) {
          totalAnalyses++;
          const analysisData = analysisDoc.data();
          const findings = extractFindings(analysisData.aiAnalysis);

          for (const finding of findings) {
            const raw = finding.title || finding.issue || finding.description || "";
            const key = normalizePatternKey(raw);
            if (!key) continue;

            if (!patternMap.has(key)) {
              patternMap.set(key, {
                pattern: key,
                count: 0,
                severity: finding.severity || "warning",
                recommendations: new Set(),
              });
            }
            const entry = patternMap.get(key);
            entry.count++;
            const rec = finding.recommendation || finding.fix;
            if (rec) entry.recommendations.add(rec);
          }
        }
      } catch (err) {
        console.warn(
          `[master-fairy] Skipped domain ${domain.domainId}: ${err.message}`
        );
      }
    }

    // 5. Calculate frequencies, filter, sort, trim to top 20
    const patterns = [];
    for (const [, entry] of patternMap) {
      const frequency = totalAnalyses > 0 ? entry.count / totalAnalyses : 0;
      if (frequency >= minFrequency) {
        patterns.push({
          pattern: entry.pattern,
          frequency: Math.round(frequency * 100) / 100,
          count: entry.count,
          severity: entry.severity,
          recommendation: [...entry.recommendations][0] || null,
        });
      }
    }
    patterns.sort((a, b) => b.frequency - a.frequency);
    const topPatterns = patterns.slice(0, 20);

    // 6. Persist to Firestore
    if (topPatterns.length > 0 || totalAnalyses > 0) {
      await db.collection("masterLearnings").doc(businessType).set({
        businessType,
        patterns: topPatterns,
        domainCount: typeDomains.length,
        analysisCount: totalAnalyses,
        lastUpdatedAt: FieldValue.serverTimestamp(),
      });
    }

    summary[businessType] = {
      domains: typeDomains.length,
      analyses: totalAnalyses,
      patterns: topPatterns.length,
    };
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[master-fairy] Aggregation complete in ${duration}s`, summary);
  return { summary, duration: `${duration}s` };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract an array of structured findings from a saved Gemini analysis response.
 * Handles the various shapes that the agent.js responses can have.
 *
 * @param {Object|null} aiAnalysis — saved in Firestore from a previous /analyze call
 * @returns {Array<{ title?, issue?, description?, severity?, recommendation?, fix? }>}
 */
function extractFindings(aiAnalysis) {
  if (!aiAnalysis) return [];

  // Unwrap the outer wrapper from analyzeFullScan / analyzeWithDomainContext
  const analysis = aiAnalysis.analysis || aiAnalysis;
  const findings = [];

  // Primary schema: errorTriage.realIssues
  if (Array.isArray(analysis.errorTriage?.realIssues)) {
    findings.push(
      ...analysis.errorTriage.realIssues.map((i) => ({
        title: i.issue,
        severity: i.severity || "warning",
        recommendation: i.fix,
      }))
    );
  }

  // Missing tracking as a finding
  if (Array.isArray(analysis.missingTracking)) {
    findings.push(
      ...analysis.missingTracking.map((t) => ({
        title: `Missing ${t.eventName} tracking`,
        severity:
          t.priority === "critical"
            ? "error"
            : t.priority === "high"
            ? "warning"
            : "info",
        recommendation: t.implementation,
      }))
    );
  }

  // Generic arrays from other schemas
  if (Array.isArray(analysis.findings)) findings.push(...analysis.findings);
  if (Array.isArray(analysis.issues)) findings.push(...analysis.issues);

  return findings.filter((f) => f && (f.title || f.issue || f.description));
}

/**
 * Normalize a finding text into a canonical key by stripping specifics
 * (URLs, tag IDs, numbers) so similar issues cluster together.
 *
 * e.g. "Missing purchase event on /checkout/confirm-1234" →
 *      "missing purchase event on /checkout/confirm-<n>"
 *
 * @param {string} text
 * @returns {string|null}
 */
function normalizePatternKey(text) {
  if (!text || typeof text !== "string") return null;
  return text
    .toLowerCase()
    .replace(/https?:\/\/[^\s]+/g, "<url>")       // strip full URLs
    .replace(/\bgtm-[a-z0-9]+\b/gi, "<gtm-id>")  // strip GTM container IDs
    .replace(/\bg-[a-z0-9-]+\b/gi, "<ga4-id>")   // strip GA4 measurement IDs
    .replace(/\b[0-9]{6,}\b/g, "<id>")            // strip long numeric IDs
    .replace(/['"]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);                                // cap key length
}
