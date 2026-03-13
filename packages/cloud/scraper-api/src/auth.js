/**
 * auth.js — Google OAuth token verification
 *
 * Validates Bearer tokens sent by the Chrome extension via
 * chrome.identity.getAuthToken(). Tokens are access tokens (not id tokens),
 * so we validate by calling Google's tokeninfo endpoint.
 *
 * Extracted payload shape: { sub, email, email_verified }
 */

import { OAuth2Client } from "google-auth-library";

const oauthClient = new OAuth2Client();

// In-memory token cache to avoid hammering tokeninfo on every request
// Cache entries expire after 4 minutes (tokens typically last 60 min)
const tokenCache = new Map(); // token -> { payload, expiresAt }
const CACHE_TTL_MS = 4 * 60 * 1000;

/**
 * Verify a Google OAuth access token and return the user's identity.
 *
 * chrome.identity.getAuthToken() returns an access token (not an ID token),
 * so we validate it via Google's tokeninfo endpoint rather than verifyIdToken().
 *
 * @param {string} accessToken
 * @returns {{ sub: string, email: string, email_verified: boolean }}
 * @throws if the token is invalid or expired
 */
export async function verifyToken(accessToken) {
  // Check cache first
  const cached = tokenCache.get(accessToken);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.payload;
  }

  // Call Google's tokeninfo endpoint
  const res = await fetch(
    `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
  );

  if (!res.ok) {
    throw new Error("Invalid or expired access token");
  }

  const info = await res.json();

  if (info.error) {
    throw new Error(`Token validation failed: ${info.error_description || info.error}`);
  }

  const payload = {
    sub: info.sub || info.user_id,
    email: info.email,
    email_verified: info.email_verified === "true" || info.email_verified === true,
  };

  if (!payload.sub) {
    throw new Error("Token payload missing user identifier (sub)");
  }

  // Cache result
  tokenCache.set(accessToken, { payload, expiresAt: Date.now() + CACHE_TTL_MS });

  return payload;
}

/**
 * Express middleware — extracts and verifies the Bearer token.
 * Attaches the verified user payload to req.user.
 *
 * Usage: router.use(authMiddleware)
 */
export async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header. Expected: Bearer <token>" });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: "Empty bearer token" });
  }

  try {
    req.user = await verifyToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }
}

// Periodically clean expired cache entries
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of tokenCache) {
    if (now >= entry.expiresAt) tokenCache.delete(token);
  }
}, 5 * 60 * 1000);
