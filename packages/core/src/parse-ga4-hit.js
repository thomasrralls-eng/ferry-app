/**
 * Parse GA4 /collect network requests into structured event objects.
 * Extracts event name, custom parameters (ep.*, epn.*), and page context.
 * Shared between the Chrome extension and cloud monitoring pipeline.
 */

function parseGa4Hit(url) {
  const u = new URL(url);
  const sp = u.searchParams;

  const event = sp.get("en");
  if (!event) return null;

  const params = {};
  for (const [k, v] of sp.entries()) {
    if (k.startsWith("ep.")) params[k.slice(3)] = v;
    if (k.startsWith("epn.")) params[k.slice(4)] = Number(v);
  }

  return {
    source: "network",
    time: new Date().toISOString(),
    event,
    params,
    page: {
      dl: sp.get("dl"),   // document location
      dr: sp.get("dr"),   // document referrer
      dt: sp.get("dt")    // document title
    },
    meta: {
      tid: sp.get("tid"),     // measurement ID
      cid: sp.get("cid"),     // client ID
      sid: sp.get("sid"),     // session ID
      sct: sp.get("sct"),     // session count
      seg: sp.get("seg"),     // session engaged
    }
  };
}

// Export for Node.js / bundler usage
if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseGa4Hit };
}
