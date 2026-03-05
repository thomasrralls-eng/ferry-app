/**
 * Safe structured cloning with configurable limits.
 * Handles circular refs, DOM nodes, depth limits, key budgets.
 * Shared between the Chrome extension and cloud transform pipeline.
 */

const DEFAULT_LIMITS = {
  maxDepth: 6,
  maxKeys: 200,
  maxArray: 200
};

function describeNode(node) {
  try {
    if (!node || !node.nodeType) return "[Node]";
    const tag = node.tagName ? node.tagName.toLowerCase() : "";
    const id = node.id ? `#${node.id}` : "";
    const cls =
      node.classList && node.classList.length
        ? "." + Array.from(node.classList).slice(0, 3).join(".")
        : "";
    const href =
      typeof node.getAttribute === "function" && node.getAttribute("href")
        ? ` href="${node.getAttribute("href")}"`
        : "";
    return `<${tag}${id}${cls}${href}>`;
  } catch {
    return "[Node]";
  }
}

function safeClone(value, opts = DEFAULT_LIMITS, state) {
  if (!state) {
    state = { seen: new WeakSet(), keysUsed: 0 };
  }
  const { maxDepth, maxKeys, maxArray } = opts;

  function budgetCheck() {
    return state.keysUsed >= maxKeys;
  }

  function cloneInner(v, depth) {
    const t = typeof v;
    if (v == null || t === "string" || t === "number" || t === "boolean") return v;
    if (depth > maxDepth) return "[MaxDepth]";
    if (t === "bigint") return v.toString();
    if (t === "symbol") return v.toString();
    if (t === "function") return "[Function]";

    try {
      if (typeof Node !== "undefined" && v instanceof Node) {
        return describeNode(v);
      }
    } catch {}

    if (v instanceof Date) return v.toISOString();
    if (v instanceof Error) {
      return { name: v.name, message: v.message, stack: v.stack };
    }

    if (Array.isArray(v)) {
      if (budgetCheck()) return "[MaxKeys]";
      const len = Math.min(v.length, maxArray);
      const out = new Array(len);
      for (let i = 0; i < len; i++) {
        out[i] = cloneInner(v[i], depth + 1);
      }
      if (v.length > maxArray) out.push(`[TruncatedArray:${v.length}]`);
      return out;
    }

    if (t === "object") {
      if (state.seen.has(v)) return "[Circular]";
      state.seen.add(v);
      if (budgetCheck()) return "[MaxKeys]";
      const out = {};
      const keys = Object.keys(v);
      for (let i = 0; i < keys.length; i++) {
        if (budgetCheck()) {
          out.__truncated__ = `[TruncatedKeys:${keys.length}]`;
          break;
        }
        const k = keys[i];
        state.keysUsed += 1;
        try {
          out[k] = cloneInner(v[k], depth + 1);
        } catch (e) {
          out[k] = `[Unclonable: ${e?.name || "Error"}]`;
        }
      }
      return out;
    }

    try {
      return String(v);
    } catch {
      return "[Unclonable]";
    }
  }

  return cloneInner(value, 0);
}

// Export for Node.js / bundler usage
if (typeof module !== "undefined" && module.exports) {
  module.exports = { safeClone, DEFAULT_LIMITS };
}
