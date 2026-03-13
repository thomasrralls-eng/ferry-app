/**
 * db.js — Firestore client and domain agent CRUD
 *
 * Collections:
 *   /users/{sub}                         — Google user identity
 *   /domains/{domainId}                  — Domain agent configuration
 *   /domains/{domainId}/analyses/{id}    — Historical enriched analyses
 */

import { Firestore, FieldValue } from "@google-cloud/firestore";
import crypto from "crypto";

const db = new Firestore({
  // Uses ADC locally, metadata server on Cloud Run
  databaseId: "(default)",
});

// ─── Users ────────────────────────────────────────────────────────────────────

/**
 * Upsert a user record from their Google OAuth payload.
 * Called on every authenticated request to keep email fresh.
 */
export async function upsertUser(sub, email) {
  const ref = db.collection("users").doc(sub);
  await ref.set(
    {
      sub,
      email,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function getUser(sub) {
  const doc = await db.collection("users").doc(sub).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

// ─── Domain agents ────────────────────────────────────────────────────────────

/**
 * Domain agent document shape:
 * {
 *   ownerSub: string,
 *   hostname: string,          // "acmecorp.com"
 *   displayName: string,
 *   ga4PropertyId: string,     // numeric property ID, e.g. "123456789"
 *   gtmContainerId: string,    // e.g. "GTM-XXXXXX"
 *   bqProjectId: string|null,
 *   bqDataset: string|null,    // e.g. "analytics_123456789"
 *   saKeySecretId: string|null,// Secret Manager secret name
 *   saKeyEmail: string|null,   // SA email for display
 *   ga4Connected: boolean,
 *   gtmConnected: boolean,
 *   bqConnected: boolean,
 *   agentContext: {            // Per-domain context for the fairy slave + master
 *     businessType: string|null,           // "ecommerce", "b2b-saas", etc.
 *     businessDescription: string|null,    // free-text brief for the agent
 *     keyEvents: string[],                 // critical GA4 event names
 *     funnelStages: string[],              // ordered funnel stage labels
 *     notes: string|null,                  // analyst notes (migration state, quirks)
 *   }|null,
 *   createdAt: Timestamp,
 *   updatedAt: Timestamp,
 * }
 */

export async function createDomain(ownerSub, { hostname, displayName }) {
  const domainId = crypto.randomBytes(8).toString("hex");
  const ref = db.collection("domains").doc(domainId);

  const data = {
    ownerSub,
    hostname: hostname.toLowerCase().trim(),
    displayName: displayName || hostname,
    ga4PropertyId: null,
    gtmContainerId: null,
    bqProjectId: null,
    bqDataset: null,
    saKeySecretId: null,
    saKeyEmail: null,
    ga4Connected: false,
    gtmConnected: false,
    bqConnected: false,
    agentContext: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await ref.set(data);
  return { domainId, ...data };
}

export async function getDomain(domainId) {
  const doc = await db.collection("domains").doc(domainId).get();
  if (!doc.exists) return null;
  return { domainId: doc.id, ...doc.data() };
}

export async function listDomains(ownerSub) {
  const snap = await db
    .collection("domains")
    .where("ownerSub", "==", ownerSub)
    .orderBy("createdAt", "desc")
    .get();

  return snap.docs.map((d) => ({ domainId: d.id, ...d.data() }));
}

export async function updateDomainConfig(domainId, ownerSub, updates) {
  const ref = db.collection("domains").doc(domainId);
  const doc = await ref.get();

  if (!doc.exists) throw new Error("Domain not found");
  if (doc.data().ownerSub !== ownerSub) throw new Error("Not authorized");

  // agentContext is stored as a full sub-object (replace entire context on update)
  const allowed = ["ga4PropertyId", "gtmContainerId", "bqProjectId", "bqDataset", "displayName", "agentContext"];
  const safeUpdates = {};
  for (const key of allowed) {
    if (key in updates) safeUpdates[key] = updates[key] ?? null;
  }

  safeUpdates.updatedAt = FieldValue.serverTimestamp();
  await ref.update(safeUpdates);
  return { domainId, ...safeUpdates };
}

export async function updateDomainSA(domainId, ownerSub, { saKeySecretId, saKeyEmail }) {
  const ref = db.collection("domains").doc(domainId);
  const doc = await ref.get();

  if (!doc.exists) throw new Error("Domain not found");
  if (doc.data().ownerSub !== ownerSub) throw new Error("Not authorized");

  await ref.update({
    saKeySecretId,
    saKeyEmail,
    ga4Connected: false,
    gtmConnected: false,
    bqConnected: false,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function updateDomainConnectionStatus(domainId, { ga4Connected, gtmConnected, bqConnected }) {
  await db.collection("domains").doc(domainId).update({
    ...(ga4Connected !== undefined && { ga4Connected }),
    ...(gtmConnected !== undefined && { gtmConnected }),
    ...(bqConnected !== undefined && { bqConnected }),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function deleteDomain(domainId, ownerSub) {
  const ref = db.collection("domains").doc(domainId);
  const doc = await ref.get();

  if (!doc.exists) throw new Error("Domain not found");
  if (doc.data().ownerSub !== ownerSub) throw new Error("Not authorized");

  await ref.delete();
}

// ─── Analyses ─────────────────────────────────────────────────────────────────

export async function saveAnalysis(domainId, { crawlSummary, ga4Snapshot, gtmSnapshot, bqSnapshot, aiAnalysis }) {
  const analysisId = crypto.randomBytes(8).toString("hex");
  const ref = db
    .collection("domains")
    .doc(domainId)
    .collection("analyses")
    .doc(analysisId);

  await ref.set({
    crawlSummary: crawlSummary || null,
    ga4Snapshot: ga4Snapshot || null,
    gtmSnapshot: gtmSnapshot || null,
    bqSnapshot: bqSnapshot || null,
    aiAnalysis: aiAnalysis || null,
    createdAt: FieldValue.serverTimestamp(),
  });

  // Update domain's lastAnalyzedAt
  await db.collection("domains").doc(domainId).update({
    lastAnalyzedAt: FieldValue.serverTimestamp(),
  });

  return analysisId;
}

export async function listAnalyses(domainId, limit = 10) {
  const snap = await db
    .collection("domains")
    .doc(domainId)
    .collection("analyses")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return snap.docs.map((d) => ({ analysisId: d.id, ...d.data() }));
}
