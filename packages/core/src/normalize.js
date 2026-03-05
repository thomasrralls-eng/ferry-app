/**
 * Normalization logic for dataLayer pushes and gtag calls.
 * Converts raw dataLayer items into a consistent event structure.
 * Shared between the Chrome extension and cloud transform pipeline.
 */

function normalizeItem(item) {
  // Convert Arguments objects to arrays
  if (item && typeof item === "object" && Object.prototype.toString.call(item) === "[object Arguments]") {
    item = Array.from(item);
  }

  // gtag-style array push: gtag('event', 'purchase', { ... })
  if (Array.isArray(item)) {
    const [cmd, arg1, arg2] = item;

    if (cmd === "event") {
      return { source: "gtag", type: "event", eventName: arg1, params: arg2, raw: item };
    }
    if (cmd === "config") {
      return { source: "gtag", type: "config", measurementId: arg1, params: arg2, raw: item };
    }
    if (cmd === "set") {
      return { source: "gtag", type: "set", params: arg1, raw: item };
    }
    if (cmd === "js") {
      return { source: "gtag", type: "js", date: arg1, raw: item };
    }
    return { source: "gtag", type: "unknown", raw: item };
  }

  // Plain object push: dataLayer.push({ event: 'purchase', ... })
  if (item && typeof item === "object") {
    return { source: "dataLayer", type: "object", eventName: item.event || null, payload: item };
  }

  // Fallback
  return { source: "unknown", payload: item };
}

// Export for Node.js / bundler usage
if (typeof module !== "undefined" && module.exports) {
  module.exports = { normalizeItem };
}
