/**
 * Lint rules test — verifies all rules catch what they should.
 * Run with: node --test packages/extension/tests/lint-rules.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { readFileSync } from "fs";
import vm from "vm";

// Load the CJS rules module via vm (extension has "type": "module" but rules uses module.exports)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rulesPath = resolve(__dirname, "..", "src", "rules", "index.js");

let lintEvent, lintSession;
try {
  const code = readFileSync(rulesPath, "utf8");
  const sandbox = {
    module: { exports: {} }, exports: {}, console,
    setTimeout, URL, Set, Map, Array, Object, Math, RegExp, JSON, String, Number, Date, Error, TypeError, Promise,
  };
  vm.runInNewContext(code, sandbox, { filename: rulesPath, timeout: 5000 });
  lintEvent = sandbox.module.exports.lintEvent;
  lintSession = sandbox.module.exports.lintSession;
  if (!lintEvent || !lintSession) throw new Error("lintEvent or lintSession not found in exports");
} catch (err) {
  console.error("Could not load rules:", err.message);
  process.exit(1);
}

function hasRule(findings, ruleId) {
  return findings.some(f => f.ruleId === ruleId);
}

function hasSeverity(findings, ruleId, severity) {
  return findings.some(f => f.ruleId === ruleId && f.severity === severity);
}

describe("Ingestion Rules", () => {
  it("catches spaces in event name", () => {
    assert.ok(hasRule(lintEvent({ eventName: "Add To Cart", type: "event" }, {}), "event-name-has-spaces"));
  });

  it("catches special chars in event name", () => {
    assert.ok(hasRule(lintEvent({ eventName: "purchase!", type: "event" }, {}), "event-name-invalid-chars"));
  });

  it("catches event name starting with number", () => {
    assert.ok(hasRule(lintEvent({ eventName: "1_bad_start", type: "event" }, {}), "event-name-must-start-alpha"));
  });

  it("catches event name starting with underscore", () => {
    assert.ok(hasRule(lintEvent({ eventName: "_bad_start", type: "event" }, {}), "event-name-must-start-alpha"));
  });

  it("catches event name over 40 chars", () => {
    assert.ok(hasRule(lintEvent({ eventName: "a".repeat(41), type: "event" }, {}), "event-name-too-long"));
  });

  it("catches reserved event name: session_start", () => {
    assert.ok(hasRule(lintEvent({ eventName: "session_start", type: "event" }, {}), "event-name-reserved"));
  });

  it("catches reserved event name: first_visit", () => {
    assert.ok(hasRule(lintEvent({ eventName: "first_visit", type: "event" }, {}), "event-name-reserved"));
  });

  it("catches google_ prefix on event name", () => {
    assert.ok(hasRule(lintEvent({ eventName: "google_custom_event", type: "event" }, {}), "event-name-reserved-prefix"));
  });

  it("catches firebase_ prefix on event name", () => {
    assert.ok(hasRule(lintEvent({ eventName: "firebase_thing", type: "event" }, {}), "event-name-reserved-prefix"));
  });

  it("catches spaces in parameter name", () => {
    assert.ok(hasRule(lintEvent({ eventName: "test", type: "event", params: { "bad param": "val" } }, {}), "param-name-invalid"));
  });

  it("catches google_ prefix on parameter name", () => {
    assert.ok(hasRule(lintEvent({ eventName: "test", type: "event", params: { "google_secret": "val" } }, {}), "param-name-reserved-prefix"));
  });

  it("catches parameter name over 40 chars", () => {
    assert.ok(hasRule(lintEvent({ eventName: "test", type: "event", params: { ["x".repeat(41)]: "val" } }, {}), "param-name-too-long"));
  });

  it("catches parameter value over 100 chars", () => {
    assert.ok(hasRule(lintEvent({ eventName: "test", type: "event", params: { long_val: "x".repeat(101) } }, {}), "param-value-too-long"));
  });

  it("catches more than 25 params per event", () => {
    const manyParams = {};
    for (let i = 0; i < 26; i++) manyParams[`param_${i}`] = "val";
    assert.ok(hasRule(lintEvent({ eventName: "test", type: "event", params: manyParams }, {}), "too-many-params"));
  });

  it("catches empty event name", () => {
    assert.ok(hasRule(lintEvent({ eventName: "", type: "event" }, {}), "empty-event-name"));
  });
});

describe("Not-Set Rules", () => {
  it("catches duplicate enhanced measurement event: page_view", () => {
    assert.ok(hasRule(lintEvent({ eventName: "page_view", source: "dataLayer", type: "event", params: {} }, {}), "enhanced-measurement-duplicate"));
  });

  it("catches duplicate enhanced measurement event: scroll", () => {
    assert.ok(hasRule(lintEvent({ eventName: "scroll", source: "dataLayer", type: "event", params: {} }, {}), "enhanced-measurement-duplicate"));
  });

  it("does NOT flag network-source page_view", () => {
    assert.ok(!hasRule(lintEvent({ eventName: "page_view", source: "network", type: "event", params: {} }, {}), "enhanced-measurement-duplicate"));
  });

  it("catches page_view without page_location", () => {
    assert.ok(hasRule(lintEvent({ eventName: "page_view", type: "event", params: {} }, {}), "page-view-missing-page-location"));
  });

  it("does NOT flag page_view with page_location", () => {
    assert.ok(!hasRule(lintEvent({ eventName: "page_view", type: "event", params: { page_location: "https://example.com" } }, {}), "page-view-missing-page-location"));
  });

  it("catches session params on non-session event", () => {
    assert.ok(hasRule(lintEvent({ eventName: "custom_event", type: "event", params: { source: "google", medium: "cpc" } }, {}), "event-scoped-on-session-dimension"));
  });

  it("does NOT flag session params on session_start", () => {
    assert.ok(!hasRule(lintEvent({ eventName: "session_start", type: "event", params: { source: "google" } }, {}), "event-scoped-on-session-dimension"));
  });

  it("catches session without page_view", () => {
    const sessionState = {};
    lintEvent({ eventName: "session_start", type: "event" }, sessionState);
    assert.ok(hasRule(lintEvent({ eventName: "custom_click", type: "event" }, sessionState), "missing-page-view-in-session"));
  });
});

describe("Schema Rules", () => {
  it("catches purchase without items array", () => {
    assert.ok(hasRule(lintEvent({ eventName: "purchase", type: "event", params: { value: 50.00, currency: "USD" } }, {}), "ecommerce-missing-items"));
  });

  it("catches item missing both item_id and item_name", () => {
    assert.ok(hasRule(lintEvent({ eventName: "add_to_cart", type: "event", params: { items: [{ quantity: 1 }] } }, {}), "ecommerce-item-missing-id-or-name"));
  });

  it("does NOT flag item with item_id", () => {
    assert.ok(!hasRule(lintEvent({ eventName: "add_to_cart", type: "event", params: { items: [{ item_id: "SKU123" }] } }, {}), "ecommerce-item-missing-id-or-name"));
  });

  it("catches purchase without transaction_id", () => {
    assert.ok(hasRule(lintEvent({ eventName: "purchase", type: "event", params: { items: [{ item_id: "SKU1" }], value: 50, currency: "USD" } }, {}), "purchase-missing-transaction-id"));
  });

  it("does NOT trigger value-without-currency when currency IS present", () => {
    assert.ok(!hasRule(lintEvent({ eventName: "purchase", type: "event", params: { transaction_id: "T1", value: 50, currency: "USD", items: [{ item_id: "SKU1" }] } }, {}), "value-without-currency"));
  });

  it("catches value without currency", () => {
    assert.ok(hasRule(lintEvent({ eventName: "add_to_cart", type: "event", params: { value: 25.00, items: [{ item_id: "SKU1" }] } }, {}), "value-without-currency"));
  });

  it("catches lowercase currency code", () => {
    assert.ok(hasRule(lintEvent({ eventName: "purchase", type: "event", params: { value: 50, currency: "usd", transaction_id: "T1", items: [{ item_id: "SKU1" }] } }, {}), "currency-invalid-format"));
  });

  it("catches non-numeric value string", () => {
    assert.ok(hasRule(lintEvent({ eventName: "test", type: "event", params: { value: "$50.00" } }, {}), "value-not-numeric"));
  });

  it("info-level warning for string number value", () => {
    assert.ok(hasSeverity(lintEvent({ eventName: "test", type: "event", params: { value: "50" } }, {}), "value-not-numeric", "info"));
  });

  it("catches purchase missing value", () => {
    assert.ok(hasRule(lintEvent({ eventName: "purchase", type: "event", params: { transaction_id: "T1", currency: "USD", items: [{ item_id: "SKU1" }] } }, {}), "purchase-missing-value"));
  });
});

describe("Google Ads Rules", () => {
  it("catches email in user_id", () => {
    assert.ok(hasRule(lintEvent({ eventName: "login", type: "event", params: { user_id: "user@example.com" } }, {}), "user-id-contains-pii"));
  });

  it("catches unhashed email in enhanced conversions", () => {
    assert.ok(hasRule(lintEvent({ eventName: "purchase", type: "event", params: { user_data: { email: "test@example.com" } } }, {}), "enhanced-conversions-unhashed-email"));
  });

  it("catches unhashed phone in enhanced conversions", () => {
    assert.ok(hasRule(lintEvent({ eventName: "purchase", type: "event", params: { user_data: { phone: "+12125551234" } } }, {}), "enhanced-conversions-unhashed-phone"));
  });
});

describe("Quality Rules", () => {
  it("catches uppercase in event name", () => {
    assert.ok(hasRule(lintEvent({ eventName: "Add_To_Cart", type: "event" }, {}), "event-name-uppercase"));
  });

  it("catches rapid-fire duplicate event", () => {
    const sessionState = {};
    lintEvent({ eventName: "purchase", type: "event" }, sessionState);
    assert.ok(hasRule(lintEvent({ eventName: "purchase", type: "event" }, sessionState), "duplicate-event-rapid-fire"));
  });

  it("catches reused transaction_id", () => {
    const sessionState = {};
    lintEvent({ eventName: "purchase", type: "event", params: { transaction_id: "ORDER-123", value: 50, currency: "USD", items: [{ item_id: "SKU1" }] } }, sessionState);
    assert.ok(hasRule(lintEvent({ eventName: "purchase", type: "event", params: { transaction_id: "ORDER-123", value: 50, currency: "USD", items: [{ item_id: "SKU1" }] } }, sessionState), "transaction-id-reused"));
  });
});

describe("Session Lint", () => {
  it("returns findings with errors and warnings", () => {
    const { findings, summary } = lintSession([
      { eventName: "session_start", type: "event" },
      { eventName: "Add To Cart", type: "event", params: { value: 25 } },
      { eventName: "purchase", type: "event", params: { value: "$50", items: [] } },
    ]);
    assert.ok(summary.errors > 0, "Session lint finds errors");
    assert.ok(summary.warnings > 0, "Session lint finds warnings");
    assert.ok(findings.length > 0, "Session lint returns findings");
  });
});
