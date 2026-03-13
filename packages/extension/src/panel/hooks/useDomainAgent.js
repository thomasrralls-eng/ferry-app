/**
 * useDomainAgent.js — Domain agent API hook
 *
 * Handles:
 *   1. Google OAuth via chrome.identity.getAuthToken()
 *   2. Token storage in chrome.storage.local (with TTL)
 *   3. All CRUD operations against the Ferry backend /domains API
 *   4. analyzeWithAgent() — sends a crawl report to the backend for enriched analysis
 *
 * Exposed state:
 *   { user, domains, activeDomainId, loading, error,
 *     signIn, signOut, setActiveDomainId,
 *     createDomain, updateDomainConfig, deleteDomain,
 *     uploadServiceAccount, removeServiceAccount, testConnection,
 *     analyzeWithAgent }
 */

import { useState, useEffect, useCallback, useRef } from "react";

// ── Config ────────────────────────────────────────────────────────────────────

// Change to your Cloud Run URL when deployed
const API_BASE = process.env.VITE_FAIRY_API_URL
  || "https://fairy-api-PLACEHOLDER.run.app";

const STORAGE_KEY = "fairy_domain_agent";

// ── Token helpers ─────────────────────────────────────────────────────────────

async function getStoredSession() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (data) => {
      resolve(data[STORAGE_KEY] || null);
    });
  });
}

async function saveSession(session) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: session }, resolve);
  });
}

async function clearSession() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(STORAGE_KEY, resolve);
  });
}

/**
 * Get a valid access token. Uses cached token if still valid,
 * otherwise requests a new one via chrome.identity.getAuthToken.
 *
 * @param {boolean} interactive — if true, shows the OAuth consent screen
 */
async function getAccessToken(interactive = false) {
  // Check cached token (valid for 50 min to be safe; tokens last 60 min)
  const session = await getStoredSession();
  if (session?.token && session?.expiresAt && Date.now() < session.expiresAt) {
    return session.token;
  }

  // Request a new token
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!token) {
        reject(new Error("No token returned from chrome.identity"));
        return;
      }
      resolve(token);
    });
  });
}

// ── API client ────────────────────────────────────────────────────────────────

async function apiFetch(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  return data;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useDomainAgent() {
  const [user, setUser] = useState(null);
  const [domains, setDomains] = useState([]);
  const [activeDomainId, setActiveDomainId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const tokenRef = useRef(null);

  // ── Restore session on mount ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const session = await getStoredSession();
      if (!session?.token) return;

      // Try to silently refresh
      try {
        const token = await getAccessToken(false);
        tokenRef.current = token;
        setUser(session.user);
        setActiveDomainId(session.activeDomainId || null);
        await refreshDomains(token);
      } catch {
        // Token expired and can't silently refresh — stay signed out
        await clearSession();
      }
    })();
  }, []);

  // ── Internal: refresh domain list ────────────────────────────────────────
  const refreshDomains = useCallback(async (token) => {
    try {
      const data = await apiFetch("/domains", { token });
      setDomains(data.domains || []);
    } catch (err) {
      console.warn("[useDomainAgent] refresh domains failed:", err.message);
    }
  }, []);

  // ── signIn ────────────────────────────────────────────────────────────────
  const signIn = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken(true);
      tokenRef.current = token;

      // Fetch user info from Google
      const userInfo = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json());

      const sessionUser = {
        sub: userInfo.sub,
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
      };

      setUser(sessionUser);

      // Persist session (token expires in ~60 min)
      await saveSession({
        token,
        expiresAt: Date.now() + 55 * 60 * 1000,
        user: sessionUser,
        activeDomainId,
      });

      await refreshDomains(token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [activeDomainId, refreshDomains]);

  // ── signOut ───────────────────────────────────────────────────────────────
  const signOut = useCallback(async () => {
    // Revoke the cached token
    if (tokenRef.current) {
      chrome.identity.removeCachedAuthToken({ token: tokenRef.current }, () => {});
    }
    tokenRef.current = null;
    setUser(null);
    setDomains([]);
    setActiveDomainId(null);
    await clearSession();
  }, []);

  // ── Helper: get token (throws if not signed in) ───────────────────────────
  const requireToken = useCallback(async () => {
    let token = tokenRef.current;
    if (!token) {
      token = await getAccessToken(false).catch(() => null);
      if (!token) throw new Error("Not signed in");
      tokenRef.current = token;
    }
    return token;
  }, []);

  // ── createDomain ──────────────────────────────────────────────────────────
  const createDomain = useCallback(async ({ hostname, displayName }) => {
    const token = await requireToken();
    setLoading(true);
    try {
      const data = await apiFetch("/domains", {
        method: "POST",
        body: { hostname, displayName },
        token,
      });
      await refreshDomains(token);
      return data.domain;
    } finally {
      setLoading(false);
    }
  }, [requireToken, refreshDomains]);

  // ── updateDomainConfig ────────────────────────────────────────────────────
  const updateDomainConfig = useCallback(async (domainId, config) => {
    const token = await requireToken();
    setLoading(true);
    try {
      await apiFetch(`/domains/${domainId}/config`, {
        method: "PATCH",
        body: config,
        token,
      });
      await refreshDomains(token);
    } finally {
      setLoading(false);
    }
  }, [requireToken, refreshDomains]);

  // ── deleteDomain ──────────────────────────────────────────────────────────
  const deleteDomainAgent = useCallback(async (domainId) => {
    const token = await requireToken();
    await apiFetch(`/domains/${domainId}`, { method: "DELETE", token });
    if (activeDomainId === domainId) setActiveDomainId(null);
    await refreshDomains(token);
  }, [requireToken, activeDomainId, refreshDomains]);

  // ── uploadServiceAccount ──────────────────────────────────────────────────
  const uploadServiceAccount = useCallback(async (domainId, serviceAccountJson) => {
    const token = await requireToken();
    setLoading(true);
    try {
      const data = await apiFetch(`/domains/${domainId}/service-account`, {
        method: "POST",
        body: { serviceAccountJson },
        token,
      });
      await refreshDomains(token);
      return data;
    } finally {
      setLoading(false);
    }
  }, [requireToken, refreshDomains]);

  // ── removeServiceAccount ──────────────────────────────────────────────────
  const removeServiceAccount = useCallback(async (domainId) => {
    const token = await requireToken();
    await apiFetch(`/domains/${domainId}/service-account`, { method: "DELETE", token });
    await refreshDomains(token);
  }, [requireToken, refreshDomains]);

  // ── testConnection ────────────────────────────────────────────────────────
  const testConnection = useCallback(async (domainId) => {
    const token = await requireToken();
    setLoading(true);
    try {
      const data = await apiFetch(`/domains/${domainId}/test-connection`, {
        method: "POST",
        token,
      });
      await refreshDomains(token);
      return data.connections;
    } finally {
      setLoading(false);
    }
  }, [requireToken, refreshDomains]);

  // ── analyzeWithAgent ──────────────────────────────────────────────────────
  /**
   * Send a completed crawl report to the backend for enriched analysis.
   * Returns the enriched analysis object, or null if not configured / fails.
   *
   * @param {Object} crawlReport — from useFairyCrawler
   * @param {string} mode — "ga4" | "gtm"
   */
  const analyzeWithAgent = useCallback(async (crawlReport, mode = "ga4") => {
    if (!activeDomainId) return null;

    let token;
    try {
      token = await requireToken();
    } catch {
      return null; // Not signed in — silently skip
    }

    try {
      const data = await apiFetch(`/domains/${activeDomainId}/analyze`, {
        method: "POST",
        body: { crawlReport, mode },
        token,
      });
      return {
        ga4Snapshot: data.ga4Snapshot,
        gtmSnapshot: data.gtmSnapshot,
        bqSnapshot: data.bqSnapshot,
        aiAnalysis: data.aiAnalysis,
        analysisId: data.analysisId,
      };
    } catch (err) {
      console.warn("[useDomainAgent] analyzeWithAgent failed:", err.message);
      return null;
    }
  }, [activeDomainId, requireToken]);

  // ── Persist activeDomainId changes ────────────────────────────────────────
  const handleSetActiveDomainId = useCallback(async (id) => {
    setActiveDomainId(id);
    const session = await getStoredSession();
    if (session) {
      await saveSession({ ...session, activeDomainId: id });
    }
  }, []);

  // ── Active domain object ──────────────────────────────────────────────────
  const activeDomain = domains.find((d) => d.domainId === activeDomainId) || null;

  return {
    // State
    user,
    domains,
    activeDomainId,
    activeDomain,
    loading,
    error,
    // Auth
    signIn,
    signOut,
    // Domain management
    setActiveDomainId: handleSetActiveDomainId,
    createDomain,
    updateDomainConfig,
    deleteDomain: deleteDomainAgent,
    // Service account
    uploadServiceAccount,
    removeServiceAccount,
    testConnection,
    // Analysis
    analyzeWithAgent,
  };
}
