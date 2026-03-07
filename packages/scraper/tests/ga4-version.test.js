import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { readFileSync } from "fs";
import vm from "vm";

// Load the CJS rules module via vm (extension has "type": "module" but rules uses module.exports)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rulesPath = resolve(__dirname, "..", "..", "extension", "src", "rules", "index.js");

let detectGA4Version;
try {
  const code = readFileSync(rulesPath, "utf8");
  const sandbox = {
    module: { exports: {} }, exports: {}, console,
    setTimeout, URL, Set, Map, Array, Object, Math, RegExp, JSON, String, Number, Date, Error, TypeError, Promise,
  };
  vm.runInNewContext(code, sandbox, { filename: rulesPath, timeout: 5000 });
  detectGA4Version = sandbox.module.exports.detectGA4Version;
  if (!detectGA4Version) throw new Error("detectGA4Version not found in exports");
} catch (err) {
  console.error("Could not load rules:", err.message);
  process.exit(1);
}

describe("detectGA4Version", () => {
  it("returns free when no signals found", () => {
    const result = detectGA4Version([{ type: "event", eventName: "page_view", params: {} }], []);
    assert.equal(result.version, "free");
    assert.equal(result.hints.length, 0);
  });

  it("detects cross-domain linking as 360 signal", () => {
    const result = detectGA4Version([
      { type: "config", params: { linked_domains: ["other.com"] } },
    ], []);
    assert.ok(result.version === "360" || result.version === "360-likely");
    assert.ok(result.hints.length >= 1);
  });

  it("detects user_id in config as 360 signal", () => {
    const result = detectGA4Version([
      { type: "config", params: { user_id: "user-12345" } },
    ], []);
    assert.ok(result.version === "360" || result.version === "360-likely");
  });

  it("detects user_id in event params as 360 signal", () => {
    const result = detectGA4Version([
      { type: "event", params: { user_id: "u123", event_name: "purchase" } },
    ], []);
    assert.ok(result.version === "360" || result.version === "360-likely");
  });

  it("detects multiple measurement IDs as 360 signal", () => {
    const result = detectGA4Version([
      { type: "config", measurementId: "G-ABC123", params: {} },
      { type: "config", measurementId: "G-DEF456", params: {} },
    ], []);
    assert.ok(result.version === "360" || result.version === "360-likely");
    assert.ok(result.hints.some(h => h.includes("multiple measurement IDs")));
  });

  it("detects server-side tagging endpoint", () => {
    const result = detectGA4Version([], [
      { url: "https://sst.example.com/g/collect?v=2&tid=G-123" },
    ]);
    assert.ok(result.version === "360" || result.version === "360-likely");
    assert.ok(result.hints.some(h => h.includes("server-side tagging")));
  });

  it("detects measurement protocol endpoint", () => {
    const result = detectGA4Version([], [
      { url: "https://analytics.googleapis.com/mp/collect?api_secret=abc" },
    ]);
    assert.ok(result.version === "360" || result.version === "360-likely");
    assert.ok(result.hints.some(h => h.includes("measurement protocol")));
  });

  it("detects Google Ads conversion alongside GA4", () => {
    const result = detectGA4Version([], [
      { url: "https://www.googleadservices.com/pagead/conversion/123456/?value=50" },
    ]);
    assert.ok(result.version === "360" || result.version === "360-likely");
    assert.ok(result.hints.some(h => h.includes("Google Ads")));
  });

  it("returns 360 with 2+ signals", () => {
    const result = detectGA4Version(
      [
        { type: "config", params: { user_id: "u123", linked_domains: ["other.com"] } },
      ],
      []
    );
    assert.equal(result.version, "360");
    assert.ok(result.hints.length >= 2);
  });

  it("detects sub-property references in payload", () => {
    const result = detectGA4Version([
      { type: "event", params: {}, payload: { subproperty: "G-SUB123" } },
    ], []);
    assert.ok(result.version === "360" || result.version === "360-likely");
    assert.ok(result.hints.some(h => h.includes("sub-property")));
  });

  it("deduplicates hints from multiple events", () => {
    const result = detectGA4Version([
      { type: "event", params: { user_id: "u1" } },
      { type: "event", params: { user_id: "u1" } },
      { type: "event", params: { user_id: "u1" } },
    ], []);
    // Should only have one user_id hint, not three
    const userIdHints = result.hints.filter(h => h.includes("user_id"));
    assert.equal(userIdHints.length, 1);
  });
});
