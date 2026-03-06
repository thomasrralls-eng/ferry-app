/**
 * Lint rules test — verifies all rules catch what they should.
 * Run with: node packages/extension/tests/lint-rules.test.js
 */

const { lintEvent, lintSession } = require("../src/rules/index.js");

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${testName}`);
  } else {
    failed++;
    console.log(`  ✗ ${testName}`);
  }
}

function hasRule(findings, ruleId) {
  return findings.some(f => f.ruleId === ruleId);
}

function hasSeverity(findings, ruleId, severity) {
  return findings.some(f => f.ruleId === ruleId && f.severity === severity);
}

// ──────────────────────────────────────────
// INGESTION RULES
// ──────────────────────────────────────────
console.log("\n── Ingestion Rules ──");

assert(
  hasRule(lintEvent({ eventName: "Add To Cart", type: "event" }, {}), "event-name-has-spaces"),
  "Catches spaces in event name"
);

assert(
  hasRule(lintEvent({ eventName: "purchase!", type: "event" }, {}), "event-name-invalid-chars"),
  "Catches special chars in event name"
);

assert(
  hasRule(lintEvent({ eventName: "1_bad_start", type: "event" }, {}), "event-name-must-start-alpha"),
  "Catches event name starting with number"
);

assert(
  hasRule(lintEvent({ eventName: "_bad_start", type: "event" }, {}), "event-name-must-start-alpha"),
  "Catches event name starting with underscore"
);

assert(
  hasRule(lintEvent({ eventName: "a".repeat(41), type: "event" }, {}), "event-name-too-long"),
  "Catches event name over 40 chars"
);

assert(
  hasRule(lintEvent({ eventName: "session_start", type: "event" }, {}), "event-name-reserved"),
  "Catches reserved event name: session_start"
);

assert(
  hasRule(lintEvent({ eventName: "first_visit", type: "event" }, {}), "event-name-reserved"),
  "Catches reserved event name: first_visit"
);

assert(
  hasRule(lintEvent({ eventName: "google_custom_event", type: "event" }, {}), "event-name-reserved-prefix"),
  "Catches google_ prefix on event name"
);

assert(
  hasRule(lintEvent({ eventName: "firebase_thing", type: "event" }, {}), "event-name-reserved-prefix"),
  "Catches firebase_ prefix on event name"
);

assert(
  hasRule(lintEvent({ eventName: "test", type: "event", params: { "bad param": "val" } }, {}), "param-name-invalid"),
  "Catches spaces in parameter name"
);

assert(
  hasRule(lintEvent({ eventName: "test", type: "event", params: { "google_secret": "val" } }, {}), "param-name-reserved-prefix"),
  "Catches google_ prefix on parameter name"
);

assert(
  hasRule(lintEvent({ eventName: "test", type: "event", params: { ["x".repeat(41)]: "val" } }, {}), "param-name-too-long"),
  "Catches parameter name over 40 chars"
);

assert(
  hasRule(lintEvent({ eventName: "test", type: "event", params: { long_val: "x".repeat(101) } }, {}), "param-value-too-long"),
  "Catches parameter value over 100 chars"
);

// 26 params
const manyParams = {};
for (let i = 0; i < 26; i++) manyParams[`param_${i}`] = "val";
assert(
  hasRule(lintEvent({ eventName: "test", type: "event", params: manyParams }, {}), "too-many-params"),
  "Catches more than 25 params per event"
);

assert(
  hasRule(lintEvent({ eventName: "", type: "event" }, {}), "empty-event-name"),
  "Catches empty event name"
);


// ──────────────────────────────────────────
// NOT-SET RULES
// ──────────────────────────────────────────
console.log("\n── Not-Set Rules ──");

assert(
  hasRule(lintEvent({ eventName: "page_view", source: "dataLayer", type: "event", params: {} }, {}), "enhanced-measurement-duplicate"),
  "Catches duplicate enhanced measurement event: page_view"
);

assert(
  hasRule(lintEvent({ eventName: "scroll", source: "dataLayer", type: "event", params: {} }, {}), "enhanced-measurement-duplicate"),
  "Catches duplicate enhanced measurement event: scroll"
);

assert(
  !hasRule(lintEvent({ eventName: "page_view", source: "network", type: "event", params: {} }, {}), "enhanced-measurement-duplicate"),
  "Does NOT flag network-source page_view (that's the real one)"
);

assert(
  hasRule(lintEvent({ eventName: "page_view", type: "event", params: {} }, {}), "page-view-missing-page-location"),
  "Catches page_view without page_location"
);

assert(
  !hasRule(lintEvent({ eventName: "page_view", type: "event", params: { page_location: "https://example.com" } }, {}), "page-view-missing-page-location"),
  "Does NOT flag page_view with page_location"
);

assert(
  hasRule(lintEvent({ eventName: "custom_event", type: "event", params: { source: "google", medium: "cpc" } }, {}), "event-scoped-on-session-dimension"),
  "Catches session params on non-session event"
);

assert(
  !hasRule(lintEvent({ eventName: "session_start", type: "event", params: { source: "google" } }, {}), "event-scoped-on-session-dimension"),
  "Does NOT flag session params on session_start"
);

// Session-level: missing page_view
const sessionState1 = {};
lintEvent({ eventName: "session_start", type: "event" }, sessionState1);
assert(
  hasRule(lintEvent({ eventName: "custom_click", type: "event" }, sessionState1), "missing-page-view-in-session"),
  "Catches session without page_view"
);


// ──────────────────────────────────────────
// SCHEMA RULES
// ──────────────────────────────────────────
console.log("\n── Schema Rules ──");

assert(
  hasRule(lintEvent({ eventName: "purchase", type: "event", params: { value: 50.00, currency: "USD" } }, {}), "ecommerce-missing-items"),
  "Catches purchase without items array"
);

assert(
  hasRule(lintEvent({ eventName: "add_to_cart", type: "event", params: { items: [{ quantity: 1 }] } }, {}), "ecommerce-item-missing-id-or-name"),
  "Catches item missing both item_id and item_name"
);

assert(
  !hasRule(lintEvent({ eventName: "add_to_cart", type: "event", params: { items: [{ item_id: "SKU123" }] } }, {}), "ecommerce-item-missing-id-or-name"),
  "Does NOT flag item with item_id"
);

assert(
  hasRule(lintEvent({ eventName: "purchase", type: "event", params: { items: [{ item_id: "SKU1" }], value: 50, currency: "USD" } }, {}), "purchase-missing-transaction-id"),
  "Catches purchase without transaction_id"
);

assert(
  !hasRule(lintEvent({ eventName: "purchase", type: "event", params: { transaction_id: "T1", value: 50, currency: "USD", items: [{ item_id: "SKU1" }] } }, {}), "value-without-currency"),
  "Does NOT trigger value-without-currency when currency IS present"
);

assert(
  hasRule(lintEvent({ eventName: "add_to_cart", type: "event", params: { value: 25.00, items: [{ item_id: "SKU1" }] } }, {}), "value-without-currency"),
  "Catches value without currency"
);

assert(
  hasRule(lintEvent({ eventName: "purchase", type: "event", params: { value: 50, currency: "usd", transaction_id: "T1", items: [{ item_id: "SKU1" }] } }, {}), "currency-invalid-format"),
  "Catches lowercase currency code"
);

assert(
  hasRule(lintEvent({ eventName: "test", type: "event", params: { value: "$50.00" } }, {}), "value-not-numeric"),
  "Catches non-numeric value string"
);

assert(
  hasSeverity(lintEvent({ eventName: "test", type: "event", params: { value: "50" } }, {}), "value-not-numeric", "info"),
  "Info-level warning for string number value"
);

assert(
  hasRule(lintEvent({ eventName: "purchase", type: "event", params: { transaction_id: "T1", currency: "USD", items: [{ item_id: "SKU1" }] } }, {}), "purchase-missing-value"),
  "Catches purchase missing value"
);


// ──────────────────────────────────────────
// GOOGLE ADS RULES
// ──────────────────────────────────────────
console.log("\n── Google Ads Rules ──");

assert(
  hasRule(lintEvent({ eventName: "login", type: "event", params: { user_id: "user@example.com" } }, {}), "user-id-contains-pii"),
  "Catches email in user_id"
);

assert(
  hasRule(lintEvent({ eventName: "purchase", type: "event", params: { user_data: { email: "test@example.com" } } }, {}), "enhanced-conversions-unhashed-email"),
  "Catches unhashed email in enhanced conversions"
);

assert(
  hasRule(lintEvent({ eventName: "purchase", type: "event", params: { user_data: { phone: "+12125551234" } } }, {}), "enhanced-conversions-unhashed-phone"),
  "Catches unhashed phone in enhanced conversions"
);


// ──────────────────────────────────────────
// QUALITY RULES
// ──────────────────────────────────────────
console.log("\n── Quality Rules ──");

assert(
  hasRule(lintEvent({ eventName: "Add_To_Cart", type: "event" }, {}), "event-name-uppercase"),
  "Catches uppercase in event name"
);

// Rapid fire
const sessionState2 = {};
lintEvent({ eventName: "purchase", type: "event" }, sessionState2);
assert(
  hasRule(lintEvent({ eventName: "purchase", type: "event" }, sessionState2), "duplicate-event-rapid-fire"),
  "Catches rapid-fire duplicate event"
);

// Transaction ID reuse
const sessionState3 = {};
lintEvent({ eventName: "purchase", type: "event", params: { transaction_id: "ORDER-123", value: 50, currency: "USD", items: [{ item_id: "SKU1" }] } }, sessionState3);
assert(
  hasRule(lintEvent({ eventName: "purchase", type: "event", params: { transaction_id: "ORDER-123", value: 50, currency: "USD", items: [{ item_id: "SKU1" }] } }, sessionState3), "transaction-id-reused"),
  "Catches reused transaction_id"
);


// ──────────────────────────────────────────
// SESSION-LEVEL LINT
// ──────────────────────────────────────────
console.log("\n── Session Lint ──");

const { findings, summary } = lintSession([
  { eventName: "session_start", type: "event" },
  { eventName: "Add To Cart", type: "event", params: { value: 25 } },
  { eventName: "purchase", type: "event", params: { value: "$50", items: [] } },
]);

assert(summary.errors > 0, "Session lint finds errors");
assert(summary.warnings > 0, "Session lint finds warnings");
assert(findings.length > 0, "Session lint returns findings");

// ──────────────────────────────────────────
// Results
// ──────────────────────────────────────────
console.log(`\n════════════════════════════`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`════════════════════════════\n`);

process.exit(failed > 0 ? 1 : 0);
