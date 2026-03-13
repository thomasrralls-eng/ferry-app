/**
 * gtm.js — Google Tag Manager API v2 integration
 *
 * All calls impersonate the client's service account. The SA must have:
 *   - Tag Manager read-only access (Viewer role on the container)
 *   GCP role: roles/tagmanager.readonly
 *
 * Key functions:
 *   getGTMContainerSummary()  — tags, triggers, variables, published version
 *   getGTMTags()              — full tag list with types and firing rules
 *   testGTMAccess()           — quick connectivity check
 */

import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";

const GTM_SCOPES = ["https://www.googleapis.com/auth/tagmanager.readonly"];

function authFromSA(saJson) {
  return new GoogleAuth({
    credentials: JSON.parse(saJson),
    scopes: GTM_SCOPES,
  });
}

/**
 * Find the GTM account + container path from a container ID like "GTM-XXXXXX".
 * GTM API requires the full resource path: accounts/{accountId}/containers/{containerId}
 *
 * We list all accounts accessible by the SA and search for the matching container.
 */
async function resolveContainerPath(tagmanager, gtmContainerId) {
  // List accounts
  const accountsRes = await tagmanager.accounts.list();
  const accounts = accountsRes.data.account || [];

  for (const account of accounts) {
    const containersRes = await tagmanager.accounts.containers.list({
      parent: account.path,
    });
    const containers = containersRes.data.container || [];
    const match = containers.find((c) => c.publicId === gtmContainerId);
    if (match) return match.path; // e.g. "accounts/1234/containers/5678"
  }

  throw new Error(`GTM container ${gtmContainerId} not found in any accessible account`);
}

/**
 * Fetch a high-level summary of the GTM container.
 *
 * Returns:
 * {
 *   containerId: string,         // "GTM-XXXXXX"
 *   containerPath: string,       // "accounts/.../containers/..."
 *   publishedVersion: { versionId, name, description, fingerprint },
 *   tagCount: number,
 *   triggerCount: number,
 *   variableCount: number,
 *   tagsByType: { "UA": 3, "GA4 Configuration": 1, ... },
 *   ga4ConfigTags: [{ name, measurementId }],
 *   customHtmlTags: number,
 * }
 */
export async function getGTMContainerSummary(gtmContainerId, saJson) {
  const auth = authFromSA(saJson);
  const tagmanager = google.tagmanager({ version: "v2", auth });

  const containerPath = await resolveContainerPath(tagmanager, gtmContainerId);

  // Fetch tags, triggers, variables, and published version in parallel
  const [tagsRes, triggersRes, variablesRes, versionsRes] = await Promise.all([
    tagmanager.accounts.containers.workspaces.tags
      .list({ parent: `${containerPath}/workspaces/default` })
      .catch(() => ({ data: { tag: [] } })),
    tagmanager.accounts.containers.workspaces.triggers
      .list({ parent: `${containerPath}/workspaces/default` })
      .catch(() => ({ data: { trigger: [] } })),
    tagmanager.accounts.containers.workspaces.variables
      .list({ parent: `${containerPath}/workspaces/default` })
      .catch(() => ({ data: { variable: [] } })),
    tagmanager.accounts.containers.versions
      .live({ parent: containerPath })
      .catch(() => ({ data: null })),
  ]);

  const tags = tagsRes.data.tag || [];
  const triggers = triggersRes.data.trigger || [];
  const variables = variablesRes.data.variable || [];
  const liveVersion = versionsRes.data;

  // Build type summary
  const tagsByType = {};
  const ga4ConfigTags = [];
  let customHtmlCount = 0;

  for (const tag of tags) {
    const type = tag.type || "UNKNOWN";
    tagsByType[type] = (tagsByType[type] || 0) + 1;

    if (type === "gaawc") {
      // GA4 Configuration tag — extract measurement ID
      const mid = tag.parameter?.find((p) => p.key === "measurementId")?.value;
      if (mid) ga4ConfigTags.push({ name: tag.name, measurementId: mid });
    }

    if (type === "html") customHtmlCount++;
  }

  const publishedVersion = liveVersion
    ? {
        versionId: liveVersion.containerVersionId,
        name: liveVersion.name,
        description: liveVersion.description,
        fingerprint: liveVersion.fingerprint,
      }
    : null;

  return {
    containerId: gtmContainerId,
    containerPath,
    publishedVersion,
    tagCount: tags.length,
    triggerCount: triggers.length,
    variableCount: variables.length,
    tagsByType,
    ga4ConfigTags,
    customHtmlTags: customHtmlCount,
  };
}

/**
 * Fetch the full list of tags with their names, types, and trigger counts.
 *
 * Returns: [{ name, type, firingTriggerId[], paused }]
 */
export async function getGTMTags(gtmContainerId, saJson) {
  const auth = authFromSA(saJson);
  const tagmanager = google.tagmanager({ version: "v2", auth });

  const containerPath = await resolveContainerPath(tagmanager, gtmContainerId);

  const res = await tagmanager.accounts.containers.workspaces.tags.list({
    parent: `${containerPath}/workspaces/default`,
  });

  return (res.data.tag || []).map((tag) => ({
    name: tag.name,
    type: tag.type,
    paused: !!tag.paused,
    firingTriggerCount: (tag.firingTriggerId || []).length,
    blockingTriggerCount: (tag.blockingTriggerId || []).length,
  }));
}

/**
 * Quick connectivity test.
 */
export async function testGTMAccess(gtmContainerId, saJson) {
  try {
    const auth = authFromSA(saJson);
    const tagmanager = google.tagmanager({ version: "v2", auth });
    await resolveContainerPath(tagmanager, gtmContainerId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
