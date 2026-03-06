/**
 * Ferry Lint Rules Engine
 *
 * Analyzes dataLayer events and GA4 network hits against Google's
 * documented requirements, limits, and best practices.
 *
 * Each rule returns an array of findings (possibly empty).
 * A finding = { ruleId, severity, category, message, detail, docs }
 *
 * Severities:
 *   "error"   — data will be rejected, silently dropped, or corrupted
 *   "warning" — data will cause (not set), bad reporting, or suboptimal behavior
 *   "info"    — best practice suggestion
 *
 * Categories:
 *   "ingestion"  — data never makes it into GA4/Google Ads
 *   "not-set"    — data gets in but produces (not set) values in reports
 *   "schema"     — violates recommended event schemas
 *   "limits"     — exceeds documented collection limits
 *   "google-ads" — Google Ads conversion tracking issues
 *   "quality"    — general data quality / best practice
 */

// ──────────────────────────────────────────────
// Schema data (inlined for extension context — no require())
// In a bundled build, this would import from @ferry/core
// ──────────────────────────────────────────────

const RESERVED_EVENT_NAMES = new Set([
  "ad_activeview", "ad_click", "ad_exposure", "ad_impression", "ad_query",
  "adunit_exposure", "app_clear_data", "app_exception", "app_install",
  "app_remove", "app_store_refund", "app_store_subscription_cancel",
  "app_store_subscription_convert", "app_store_subscription_renew",
  "app_update", "app_upgrade", "dynamic_link_app_open",
  "dynamic_link_app_update", "dynamic_link_first_open", "error",
  "firebase_campaign", "firebase_in_app_message_action",
  "firebase_in_app_message_dismiss", "firebase_in_app_message_impression",
  "first_open", "first_visit", "in_app_purchase", "notification_dismiss",
  "notification_foreground", "notification_open", "notification_receive",
  "notification_send", "os_update", "screen_view", "session_start",
  "user_engagement",
]);

const ENHANCED_MEASUREMENT_EVENTS = new Set([
  "page_view", "scroll", "click", "view_search_results",
  "video_start", "video_progress", "video_complete",
  "file_download", "form_start", "form_submit",
]);

const RESERVED_PARAM_PREFIXES = ["google_", "firebase_", "ga_"];

const ECOMMERCE_EVENTS_REQUIRING_ITEMS = new Set([
  "view_item_list", "select_item", "view_item", "add_to_cart",
  "remove_from_cart", "view_cart", "begin_checkout",
  "add_shipping_info", "add_payment_info", "purchase", "refund",
]);

const PURCHASE_LIKE_EVENTS = new Set(["purchase", "refund"]);

const VALUE_EVENTS = new Set([
  "purchase", "refund", "add_to_cart", "remove_from_cart",
  "begin_checkout", "add_shipping_info", "add_payment_info",
  "view_item", "view_cart", "view_item_list", "generate_lead",
]);

const VALID_CURRENCY_CODES = new Set([
  "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "CNY", "SEK", "NZD",
  "MXN", "SGD", "HKD", "NOK", "KRW", "TRY", "RUB", "INR", "BRL", "ZAR",
  "DKK", "PLN", "TWD", "THB", "IDR", "HUF", "CZK", "ILS", "CLP", "PHP",
  "AED", "COP", "SAR", "MYR", "RON", "ARS", "BGN", "HRK", "PEN", "PKR",
  "EGP", "NGN", "UAH", "VND", "BDT", "QAR", "KWD", "OMR", "BHD", "JOD",
]);

const LIMITS = {
  eventNameMaxLength: 40,
  paramNameMaxLength: 40,
  paramValueMaxLength: 100,
  maxParamsPerEvent: 25,
  maxItemsPerEvent: 200,
  userPropertyNameMaxLength: 24,
  userPropertyValueMaxLength: 36,
};


// ──────────────────────────────────────────────
// Rule definitions
// ──────────────────────────────────────────────

const rules = [];

// Helper to register a rule
function defineRule(id, fn) {
  fn.ruleId = id;
  rules.push(fn);
}

// Helper to build a finding
function finding(ruleId, severity, category, message, detail, docs) {
  return { ruleId, severity, category, message, detail: detail || "", docs: docs || "" };
}


// ═══════════════════════════════════════════════
// CATEGORY: INGESTION — data never makes it in
// ═══════════════════════════════════════════════

defineRule("event-name-invalid-chars", (event) => {
  const name = getEventName(event);
  if (!name) return [];
  if (/[^a-zA-Z0-9_]/.test(name)) {
    return [finding(
      "event-name-invalid-chars", "error", "ingestion",
      `Event name "${name}" contains invalid characters`,
      "Event names can only contain letters, numbers, and underscores. This event will be silently rejected by GA4.",
      "https://support.google.com/analytics/answer/13316687"
    )];
  }
  return [];
});

defineRule("event-name-must-start-alpha", (event) => {
  const name = getEventName(event);
  if (!name) return [];
  if (/^[^a-zA-Z]/.test(name)) {
    return [finding(
      "event-name-must-start-alpha", "error", "ingestion",
      `Event name "${name}" must start with a letter`,
      "Event names starting with numbers or underscores are rejected. Use a letter as the first character.",
      "https://support.google.com/analytics/answer/13316687"
    )];
  }
  return [];
});

defineRule("event-name-too-long", (event) => {
  const name = getEventName(event);
  if (!name) return [];
  if (name.length > LIMITS.eventNameMaxLength) {
    return [finding(
      "event-name-too-long", "error", "ingestion",
      `Event name "${name}" exceeds 40 characters (${name.length})`,
      "GA4 silently truncates or drops event names longer than 40 characters.",
      "https://support.google.com/analytics/answer/13316687"
    )];
  }
  return [];
});

defineRule("event-name-reserved", (event) => {
  const name = getEventName(event);
  if (!name) return [];
  if (RESERVED_EVENT_NAMES.has(name)) {
    return [finding(
      "event-name-reserved", "error", "ingestion",
      `Event name "${name}" is reserved by GA4`,
      "Reserved event names are used internally by GA4 and cannot be sent as custom events. Sending them will corrupt your data or be silently dropped.",
      "https://support.google.com/analytics/answer/13316687"
    )];
  }
  return [];
});

defineRule("event-name-reserved-prefix", (event) => {
  const name = getEventName(event);
  if (!name) return [];
  for (const prefix of RESERVED_PARAM_PREFIXES) {
    if (name.startsWith(prefix)) {
      return [finding(
        "event-name-reserved-prefix", "error", "ingestion",
        `Event name "${name}" uses reserved prefix "${prefix}"`,
        `Event names starting with "${prefix}" are reserved by Google and will be rejected.`,
        "https://support.google.com/analytics/answer/13316687"
      )];
    }
  }
  return [];
});

defineRule("param-name-invalid", (event) => {
  const params = getParams(event);
  if (!params) return [];
  const results = [];
  for (const key of Object.keys(params)) {
    if (/[^a-zA-Z0-9_]/.test(key)) {
      results.push(finding(
        "param-name-invalid", "error", "ingestion",
        `Parameter "${key}" contains invalid characters`,
        "Parameter names can only contain letters, numbers, and underscores.",
        "https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference"
      ));
    }
    if (key.length > 0 && /^[^a-zA-Z]/.test(key)) {
      results.push(finding(
        "param-name-invalid", "error", "ingestion",
        `Parameter "${key}" must start with a letter`,
        "Parameter names starting with numbers or underscores are rejected.",
        "https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference"
      ));
    }
  }
  return results;
});

defineRule("param-name-reserved-prefix", (event) => {
  const params = getParams(event);
  if (!params) return [];
  const results = [];
  for (const key of Object.keys(params)) {
    for (const prefix of RESERVED_PARAM_PREFIXES) {
      if (key.startsWith(prefix)) {
        results.push(finding(
          "param-name-reserved-prefix", "error", "ingestion",
          `Parameter "${key}" uses reserved prefix "${prefix}"`,
          `Parameters starting with "${prefix}" are reserved and will be silently dropped.`,
          "https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference"
        ));
      }
    }
  }
  return results;
});

defineRule("param-name-too-long", (event) => {
  const params = getParams(event);
  if (!params) return [];
  const results = [];
  for (const key of Object.keys(params)) {
    if (key.length > LIMITS.paramNameMaxLength) {
      results.push(finding(
        "param-name-too-long", "error", "ingestion",
        `Parameter "${key}" exceeds 40 characters (${key.length})`,
        "Parameter names longer than 40 characters are silently dropped.",
        "https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference"
      ));
    }
  }
  return results;
});

defineRule("param-value-too-long", (event) => {
  const params = getParams(event);
  if (!params) return [];
  const results = [];
  for (const [key, val] of Object.entries(params)) {
    if (typeof val === "string" && val.length > LIMITS.paramValueMaxLength) {
      results.push(finding(
        "param-value-too-long", "warning", "limits",
        `Parameter "${key}" value exceeds 100 characters (${val.length})`,
        "Standard GA4 properties truncate parameter values at 100 characters. GA4 360 allows 500. Data beyond the limit is lost.",
        "https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference"
      ));
    }
  }
  return results;
});

defineRule("too-many-params", (event) => {
  const params = getParams(event);
  if (!params) return [];
  const count = Object.keys(params).length;
  if (count > LIMITS.maxParamsPerEvent) {
    return [finding(
      "too-many-params", "error", "limits",
      `Event has ${count} parameters (max 25)`,
      "GA4 accepts a maximum of 25 parameters per event. Extra parameters are silently dropped. Consolidate or remove low-value parameters.",
      "https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference"
    )];
  }
  return [];
});


// ═══════════════════════════════════════════════
// CATEGORY: NOT-SET — causes (not set) in reports
// ═══════════════════════════════════════════════

defineRule("enhanced-measurement-duplicate", (event) => {
  const name = getEventName(event);
  if (!name) return [];
  // Only flag if the source is custom (not from enhanced measurement itself)
  if (event.source === "network") return [];
  if (ENHANCED_MEASUREMENT_EVENTS.has(name)) {
    return [finding(
      "enhanced-measurement-duplicate", "warning", "not-set",
      `Event "${name}" duplicates an enhanced measurement event`,
      "If enhanced measurement is enabled, GA4 already fires this event automatically. Sending it again will double-count sessions, page views, or interactions, and can cause (not set) values when the duplicated event lacks parameters the auto-collected one normally includes.",
      "https://support.google.com/analytics/answer/9216061"
    )];
  }
  return [];
});

defineRule("page-view-missing-page-location", (event) => {
  const name = getEventName(event);
  if (name !== "page_view") return [];
  const params = getParams(event);
  if (!params) return [];
  if (!params.page_location && !params.page_path) {
    return [finding(
      "page-view-missing-page-location", "warning", "not-set",
      "page_view event missing page_location parameter",
      "Without page_location, the Landing Page dimension in GA4 reports will show (not set). The page_location parameter should contain the full URL of the page.",
      "https://support.google.com/analytics/answer/13504892"
    )];
  }
  return [];
});

defineRule("event-scoped-on-session-dimension", (event) => {
  // Detect when session-level attributes (source, medium, campaign)
  // are being set on individual events rather than session_start.
  // This is a heuristic — we flag when these appear on non-session events.
  const name = getEventName(event);
  if (!name) return [];
  const params = getParams(event);
  if (!params) return [];

  const SESSION_PARAMS = ["source", "medium", "campaign", "campaign_id", "term", "content"];
  const isSessionEvent = (name === "session_start" || name === "page_view");

  if (!isSessionEvent) {
    const found = SESSION_PARAMS.filter(p => params[p] !== undefined);
    if (found.length > 0) {
      return [finding(
        "event-scoped-on-session-dimension", "warning", "not-set",
        `Session-level params [${found.join(", ")}] sent on "${name}" event`,
        "Source, medium, and campaign are session-scoped dimensions. Setting them on individual events (not session_start or page_view) typically results in (not set) values in session-scoped reports, because GA4 only reads these from the session's first hit.",
        "https://support.google.com/analytics/answer/13504892"
      )];
    }
  }
  return [];
});

defineRule("missing-page-view-in-session", (event, sessionState) => {
  // This rule works at session level — it flags when session_start fires
  // but no page_view follows. We track this in sessionState.
  if (!sessionState) return [];
  const name = getEventName(event);
  if (name === "session_start") {
    sessionState.hasSessionStart = true;
    sessionState.hasPageView = false;
  }
  if (name === "page_view") {
    sessionState.hasPageView = true;
  }
  // Only fire when we see a non-page-view event after session_start
  // and no page_view has been seen yet
  if (sessionState.hasSessionStart && !sessionState.hasPageView &&
      name !== "session_start" && name !== "page_view") {
    return [finding(
      "missing-page-view-in-session", "warning", "not-set",
      "Session started without a page_view event",
      "When a session has session_start but no page_view, the Landing Page dimension shows (not set). Ensure your config tag fires on page load to generate a page_view event at the start of every session.",
      "https://support.google.com/analytics/answer/13504892"
    )];
  }
  return [];
});


// ═══════════════════════════════════════════════
// CATEGORY: SCHEMA — recommended event violations
// ═══════════════════════════════════════════════

defineRule("ecommerce-missing-items", (event) => {
  const name = getEventName(event);
  if (!name || !ECOMMERCE_EVENTS_REQUIRING_ITEMS.has(name)) return [];
  const params = getParams(event);
  if (!params) return [];
  if (!params.items || !Array.isArray(params.items) || params.items.length === 0) {
    return [finding(
      "ecommerce-missing-items", "error", "schema",
      `Ecommerce event "${name}" missing items array`,
      "All ecommerce events require a non-empty items array. Without it, the event is treated as a generic custom event and won't appear in ecommerce reports.",
      "https://developers.google.com/analytics/devguides/collection/ga4/ecommerce"
    )];
  }
  return [];
});

defineRule("ecommerce-item-missing-id-or-name", (event) => {
  const name = getEventName(event);
  if (!name || !ECOMMERCE_EVENTS_REQUIRING_ITEMS.has(name)) return [];
  const params = getParams(event);
  if (!params || !Array.isArray(params.items)) return [];
  const results = [];
  params.items.forEach((item, idx) => {
    if (!item.item_id && !item.item_name) {
      results.push(finding(
        "ecommerce-item-missing-id-or-name", "error", "schema",
        `Item[${idx}] in "${name}" missing both item_id and item_name`,
        "Every item must have at least item_id or item_name. Without either, the item is silently dropped from ecommerce reports.",
        "https://developers.google.com/analytics/devguides/collection/ga4/ecommerce"
      ));
    }
  });
  return results;
});

defineRule("purchase-missing-transaction-id", (event) => {
  const name = getEventName(event);
  if (!PURCHASE_LIKE_EVENTS.has(name)) return [];
  const params = getParams(event);
  if (!params) return [];
  if (!params.transaction_id) {
    return [finding(
      "purchase-missing-transaction-id", "error", "schema",
      `"${name}" event missing transaction_id`,
      "Purchase and refund events require a unique transaction_id. Without it, GA4 cannot deduplicate transactions — if the event fires twice, it counts as two purchases.",
      "https://developers.google.com/analytics/devguides/collection/ga4/ecommerce"
    )];
  }
  return [];
});

defineRule("value-without-currency", (event) => {
  const name = getEventName(event);
  const params = getParams(event);
  if (!params) return [];
  if (params.value !== undefined && !params.currency) {
    return [finding(
      "value-without-currency", "error", "schema",
      `Event "${name || "(unknown)"}" has value but no currency`,
      "When you send a value parameter, you must also send currency (ISO 4217 format, e.g. 'USD'). Without currency, GA4 ignores the value entirely — it shows as 0 in revenue reports.",
      "https://developers.google.com/analytics/devguides/collection/ga4/ecommerce"
    )];
  }
  return [];
});

defineRule("currency-invalid-format", (event) => {
  const params = getParams(event);
  if (!params || !params.currency) return [];
  const c = params.currency;
  if (typeof c !== "string" || c.length !== 3 || c !== c.toUpperCase()) {
    return [finding(
      "currency-invalid-format", "error", "schema",
      `Currency "${c}" is not a valid ISO 4217 code`,
      "Currency must be a 3-letter uppercase ISO 4217 code (e.g., 'USD', 'EUR', 'GBP'). Lowercase or misspelled codes cause GA4 to ignore the value parameter.",
      "https://developers.google.com/analytics/devguides/collection/ga4/ecommerce"
    )];
  }
  if (!VALID_CURRENCY_CODES.has(c)) {
    return [finding(
      "currency-invalid-format", "warning", "schema",
      `Currency "${c}" may not be a recognized ISO 4217 code`,
      "This currency code isn't in the common set. Verify it's a valid ISO 4217 code.",
      "https://developers.google.com/analytics/devguides/collection/ga4/ecommerce"
    )];
  }
  return [];
});

defineRule("value-not-numeric", (event) => {
  const params = getParams(event);
  if (!params || params.value === undefined) return [];
  const v = params.value;
  if (typeof v === "string") {
    const n = Number(v);
    if (isNaN(n)) {
      return [finding(
        "value-not-numeric", "error", "schema",
        `value parameter "${v}" is not a number`,
        "The value parameter must be a number (integer or decimal). String values like '$50.00' or '50 USD' are silently ignored.",
        "https://developers.google.com/analytics/devguides/collection/ga4/ecommerce"
      )];
    }
    return [finding(
      "value-not-numeric", "info", "quality",
      "value parameter sent as string instead of number",
      `The value "${v}" is a string but should be a number. GA4 may coerce it, but sending the correct type avoids edge cases.`,
      "https://developers.google.com/analytics/devguides/collection/ga4/ecommerce"
    )];
  }
  return [];
});

defineRule("purchase-missing-value", (event) => {
  const name = getEventName(event);
  if (name !== "purchase") return [];
  const params = getParams(event);
  if (!params) return [];
  if (params.value === undefined || params.value === null || params.value === "") {
    return [finding(
      "purchase-missing-value", "warning", "schema",
      "purchase event missing value parameter",
      "Without a value, this purchase won't contribute to revenue metrics in GA4 or be usable for ROAS calculations in Google Ads.",
      "https://developers.google.com/analytics/devguides/collection/ga4/ecommerce"
    )];
  }
  return [];
});

defineRule("ecommerce-items-too-many", (event) => {
  const params = getParams(event);
  if (!params || !Array.isArray(params.items)) return [];
  if (params.items.length > LIMITS.maxItemsPerEvent) {
    return [finding(
      "ecommerce-items-too-many", "warning", "limits",
      `items array has ${params.items.length} items (max 200)`,
      "GA4 supports up to 200 items per event. Items beyond this limit are dropped.",
      "https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference"
    )];
  }
  return [];
});


// ═══════════════════════════════════════════════
// CATEGORY: GOOGLE ADS — conversion tracking issues
// ═══════════════════════════════════════════════

defineRule("user-id-contains-pii", (event) => {
  const params = getParams(event);
  if (!params) return [];
  const userId = params.user_id;
  if (typeof userId === "string" && userId.includes("@")) {
    return [finding(
      "user-id-contains-pii", "error", "google-ads",
      "user_id appears to contain an email address",
      "user_id should be an opaque identifier, not raw PII like an email. Sending raw email addresses violates Google's terms of service. Hash with SHA-256 or use an internal user ID.",
      "https://developers.google.com/analytics/devguides/collection/ga4/user-id"
    )];
  }
  return [];
});

defineRule("enhanced-conversions-unhashed-email", (event) => {
  const params = getParams(event);
  if (!params) return [];
  // Check for email-like values in user_data or common enhanced conversion params
  const userData = params.user_data || params.userData || {};
  const email = userData.email || userData.email_address || params.email;
  if (typeof email === "string" && email.includes("@")) {
    return [finding(
      "enhanced-conversions-unhashed-email", "error", "google-ads",
      "Enhanced conversions email sent unhashed",
      "Email addresses for enhanced conversions must be normalized (lowercase, trimmed) and SHA-256 hashed before sending. Sending plaintext email violates Google's data policies and won't match correctly.",
      "https://support.google.com/google-ads/answer/13258081"
    )];
  }
  return [];
});

defineRule("enhanced-conversions-unhashed-phone", (event) => {
  const params = getParams(event);
  if (!params) return [];
  const userData = params.user_data || params.userData || {};
  const phone = userData.phone || userData.phone_number || params.phone;
  if (typeof phone === "string" && /^\+?\d[\d\s\-()]{6,}$/.test(phone)) {
    return [finding(
      "enhanced-conversions-unhashed-phone", "error", "google-ads",
      "Enhanced conversions phone number sent unhashed",
      "Phone numbers must be normalized to E.164 format (e.g., +12125551234) and SHA-256 hashed before sending for enhanced conversions.",
      "https://support.google.com/google-ads/answer/13258081"
    )];
  }
  return [];
});


// ═══════════════════════════════════════════════
// CATEGORY: QUALITY — general best practices
// ═══════════════════════════════════════════════

defineRule("event-name-uppercase", (event) => {
  const name = getEventName(event);
  if (!name) return [];
  if (name !== name.toLowerCase()) {
    return [finding(
      "event-name-uppercase", "warning", "quality",
      `Event name "${name}" contains uppercase letters`,
      "GA4 event names are case-sensitive. 'Add_To_Cart' and 'add_to_cart' are counted as different events. Google recommends using all lowercase with underscores (snake_case).",
      "https://support.google.com/analytics/answer/13316687"
    )];
  }
  return [];
});

defineRule("event-name-has-spaces", (event) => {
  const name = getEventName(event);
  if (!name) return [];
  if (name.includes(" ")) {
    return [finding(
      "event-name-has-spaces", "error", "ingestion",
      `Event name "${name}" contains spaces`,
      "Spaces are not allowed in GA4 event names. Use underscores instead (e.g., 'add_to_cart' not 'add to cart'). Events with spaces are rejected.",
      "https://support.google.com/analytics/answer/13316687"
    )];
  }
  return [];
});

defineRule("duplicate-event-rapid-fire", (event, sessionState) => {
  if (!sessionState) return [];
  const name = getEventName(event);
  if (!name) return [];
  const now = Date.now();
  if (!sessionState.lastEvents) sessionState.lastEvents = {};

  const last = sessionState.lastEvents[name];
  sessionState.lastEvents[name] = now;

  if (last && (now - last) < 200) {
    return [finding(
      "duplicate-event-rapid-fire", "warning", "quality",
      `Event "${name}" fired twice within 200ms`,
      "This event appears to be double-firing, likely from duplicate tags or a race condition. This inflates event counts and can double-count conversions. Check for duplicate GTM tags or multiple gtag() calls.",
      ""
    )];
  }
  return [];
});

defineRule("empty-event-name", (event) => {
  const name = getEventName(event);
  if (event.type === "event" && (!name || name.trim() === "")) {
    return [finding(
      "empty-event-name", "error", "ingestion",
      "Event fired with empty or missing event name",
      "Every GA4 event must have a non-empty name. This event will be silently dropped.",
      "https://support.google.com/analytics/answer/13316687"
    )];
  }
  return [];
});

defineRule("transaction-id-reused", (event, sessionState) => {
  if (!sessionState) return [];
  const name = getEventName(event);
  if (name !== "purchase") return [];
  const params = getParams(event);
  if (!params || !params.transaction_id) return [];

  if (!sessionState.transactionIds) sessionState.transactionIds = new Set();
  const tid = params.transaction_id;

  if (sessionState.transactionIds.has(tid)) {
    return [finding(
      "transaction-id-reused", "error", "schema",
      `Duplicate transaction_id "${tid}" detected`,
      "GA4 uses transaction_id to deduplicate purchases. If the same ID is sent again in the same session, one might be dropped. However, if sent across sessions (e.g., page refresh), it might double-count. Ensure transaction_id is unique per actual transaction.",
      "https://developers.google.com/analytics/devguides/collection/ga4/ecommerce"
    )];
  }
  sessionState.transactionIds.add(tid);
  return [];
});


// ──────────────────────────────────────────────
// Utility functions
// ──────────────────────────────────────────────

function getEventName(event) {
  // Handle both dataLayer events and normalized events
  if (event.eventName) return event.eventName;
  if (event.event) return event.event;
  if (event.payload && event.payload.event) return event.payload.event;
  if (event.type === "event" && event.args) return event.args[1];
  return null;
}

function getParams(event) {
  // Extract parameters from various event shapes
  if (event.params && typeof event.params === "object") return event.params;
  if (event.payload && typeof event.payload === "object") {
    // dataLayer push — the payload IS the params (minus "event")
    const p = { ...event.payload };
    delete p.event;
    return Object.keys(p).length > 0 ? p : null;
  }
  if (event.args && event.args[2] && typeof event.args[2] === "object") {
    return event.args[2];
  }
  return null;
}


// ──────────────────────────────────────────────
// Main lint function
// ──────────────────────────────────────────────

/**
 * Lint a single event against all rules.
 *
 * @param {Object} event - A normalized event from the dataLayer or network
 * @param {Object} sessionState - Mutable state object for cross-event rules
 *                                 (pass the same object for all events in a session)
 * @returns {Array} Array of finding objects
 */
function lintEvent(event, sessionState) {
  const findings = [];
  for (const rule of rules) {
    try {
      const results = rule(event, sessionState);
      if (results && results.length > 0) {
        findings.push(...results);
      }
    } catch (e) {
      // Never let a bad rule crash the extension
      console.warn(`[Ferry] Rule ${rule.ruleId} threw:`, e);
    }
  }
  return findings;
}

/**
 * Lint an array of events (e.g., a full recording session).
 *
 * @param {Array} events - Array of normalized events
 * @returns {Object} { findings: [...], summary: { errors, warnings, info } }
 */
function lintSession(events) {
  const sessionState = {};
  const allFindings = [];

  for (let i = 0; i < events.length; i++) {
    const eventFindings = lintEvent(events[i], sessionState);
    eventFindings.forEach(f => {
      f.eventIndex = i;
      allFindings.push(f);
    });
  }

  const summary = {
    errors: allFindings.filter(f => f.severity === "error").length,
    warnings: allFindings.filter(f => f.severity === "warning").length,
    info: allFindings.filter(f => f.severity === "info").length,
    total: allFindings.length,
  };

  return { findings: allFindings, summary };
}

// Make available to panel.js (global scope in extension)
if (typeof window !== "undefined") {
  window.FerryLint = { lintEvent, lintSession };
}

// Make available to Node.js / tests
if (typeof module !== "undefined" && module.exports) {
  module.exports = { lintEvent, lintSession, rules };
}
