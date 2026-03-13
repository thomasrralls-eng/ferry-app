/**
 * secrets.js — Google Cloud Secret Manager integration
 *
 * Stores per-domain service account JSON keys securely.
 * Secret naming convention: ferry-domain-{domainId}-sa-key
 *
 * We always write a new version on update (Secret Manager is append-only)
 * and always read the "latest" version alias.
 */

import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const client = new SecretManagerServiceClient();

const PROJECT_ID = process.env.GCP_PROJECT_ID
  || process.env.GOOGLE_CLOUD_PROJECT
  || "ferry-prod";

function secretName(domainId) {
  return `ferry-domain-${domainId}-sa-key`;
}

function secretPath(domainId) {
  return `projects/${PROJECT_ID}/secrets/${secretName(domainId)}`;
}

function secretVersionPath(domainId, version = "latest") {
  return `${secretPath(domainId)}/versions/${version}`;
}

/**
 * Store (or update) a service account JSON key for a domain.
 * Creates the secret if it doesn't exist, then adds a new version.
 *
 * @param {string} domainId
 * @param {string} saJsonString — raw JSON string of the service account key
 * @returns {string} the secret resource name (for storing in Firestore)
 */
export async function storeSAKey(domainId, saJsonString) {
  const name = secretName(domainId);
  const parent = `projects/${PROJECT_ID}`;

  // Try to create the secret; ignore "already exists" error
  try {
    await client.createSecret({
      parent,
      secretId: name,
      secret: {
        replication: { automatic: {} },
        labels: { "ferry-domain": domainId },
      },
    });
  } catch (err) {
    if (!err.message.includes("already exists")) throw err;
  }

  // Add a new version with the SA JSON payload
  await client.addSecretVersion({
    parent: secretPath(domainId),
    payload: { data: Buffer.from(saJsonString, "utf-8") },
  });

  return name;
}

/**
 * Retrieve the latest service account JSON string for a domain.
 *
 * @param {string} domainId
 * @returns {string} raw JSON string
 * @throws if the secret doesn't exist or access is denied
 */
export async function getSAKey(domainId) {
  const [version] = await client.accessSecretVersion({
    name: secretVersionPath(domainId, "latest"),
  });

  return version.payload.data.toString("utf-8");
}

/**
 * Delete all versions of a domain's SA key secret.
 * Called when a user removes their service account.
 */
export async function deleteSAKey(domainId) {
  try {
    await client.deleteSecret({ name: secretPath(domainId) });
  } catch (err) {
    // Ignore "not found" — may not have been created yet
    if (!err.message.includes("not found")) throw err;
  }
}

/**
 * Validate that a service account JSON string is structurally valid
 * before storing it.
 *
 * @param {string} saJsonString
 * @returns {{ email: string }} the service account email on success
 * @throws if the JSON is invalid or missing required fields
 */
export function validateSAJson(saJsonString) {
  let parsed;
  try {
    parsed = JSON.parse(saJsonString);
  } catch {
    throw new Error("Service account key is not valid JSON");
  }

  const required = ["type", "project_id", "private_key", "client_email"];
  for (const field of required) {
    if (!parsed[field]) {
      throw new Error(`Service account key is missing required field: ${field}`);
    }
  }

  if (parsed.type !== "service_account") {
    throw new Error(`Key type must be "service_account", got "${parsed.type}"`);
  }

  return { email: parsed.client_email, projectId: parsed.project_id };
}
