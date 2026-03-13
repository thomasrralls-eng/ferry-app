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
// In a bundled build, this would import from /core
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

// GA4 Free (standard) limits
const LIMITS = {
  eventNameMaxLength: 40,
  paramNameMaxLength: 40,
  paramValueMaxLength: 100,
  maxParamsPerEvent: 25,
  maxItemsPerEvent: 200,
  userPropertyNameMaxLength: 24,
  userPropertyValueMaxLength: 36,
  maxDistinctEvents: 500,
  maxEventParamRegistrations: 50,        // custom dimensions per event
  maxUserProperties: 25,
};

// GA4 360 limits — where they differ from free
const LIMITS_360 = {
  ...LIMITS,
  paramValueMaxLength: 500,
  maxDistinctEvents: 2000,
  maxEventParamRegistrations: 125,
  maxUserProperties: 100,
};

/**
 * Detect GA4 property version (free vs 360) from available signals.
 *
 * Since there's no definitive client-side flag, we look for behavioral
 * hints that strongly correlate with 360 properties:
 *   - Server-side tagging endpoints (sst.* or custom /g/collect domains)
 *   - Cross-domain measurement (linked_domains in config)
 *   - Data streams with sub-property patterns
 *   - Debug mode query parameter patterns unique to 360
 *
 * Returns: { version: "free" | "360" | "unknown", hints: string[] }
 */
function detectGA4Version(events, networkHits = []) {
  const hints = [];
  const measurementIds = new Set();

  for (const evt of events) {
    // Collect measurement IDs from config events
    if (evt.type === "config" && evt.measurementId) {
      measurementIds.add(evt.measurementId);
    }

    if (evt.type === "config" && evt.params) {
      // Cross-domain linking (common with 360)
      if (evt.params.linked_domains || evt.params.linker) {
        hints.push("cross-domain linking configured (common with 360)");
      }
      // User ID tracking (common with 360 implementations)
      if (evt.params.user_id) {
        hints.push("user_id parameter in config (common with 360)");
      }
    }

    // Check event params for 360 indicators
    const params = evt.params || {};
    if (params.user_id) {
      hints.push("user_id set on event (common with 360)");
    }

    // More than 25 custom params suggests 360 (free tier limit is 25)
    const customParams = Object.keys(params).filter(
      k => !k.startsWith("_") && !["event_name", "send_to", "event_callback", "event_timeout",
        "non_interaction", "event_category", "event_label", "value", "currency",
        "transaction_id", "items", "user_id", "user_properties"].includes(k)
    );
    if (customParams.length > 25) {
      hints.push(`event with ${customParams.length} custom parameters (exceeds free limit of 25)`);
    }

    // dataLayer pushes referencing sub-properties or rollup IDs
    if (evt.payload) {
      const json = JSON.stringify(evt.payload);
      if (json.includes("subproperty") || json.includes("rollup_property")) {
        hints.push("sub-property or rollup property reference detected (360 only)");
      }
    }
  }

  // Multiple measurement IDs suggest sub-properties (360 feature)
  if (measurementIds.size > 1) {
    hints.push(`multiple measurement IDs detected: ${[...measurementIds].join(", ")} (360 sub-properties)`);
  }

  // Check network hits for enterprise signals
  for (const hit of networkHits) {
    const url = hit.url || hit;
    if (typeof url === "string") {
      try {
        const parsed = new URL(url);

        // Server-side tagging: /g/collect on a non-Google domain
        if (parsed.pathname.includes("/g/collect") &&
            !parsed.hostname.includes("google-analytics.com") &&
            !parsed.hostname.includes("analytics.google.com")) {
          hints.push(`server-side tagging endpoint detected (${parsed.hostname})`);
        }

        // Measurement Protocol endpoint (server-side event sending)
        if (parsed.pathname.includes("/mp/collect")) {
          hints.push("measurement protocol endpoint detected (common with 360)");
        }

        // Google Ads conversion tracking alongside GA4 (enterprise signal)
        if (parsed.hostname.includes("googleadservices.com") &&
            parsed.pathname.includes("/pagead/conversion")) {
          hints.push("Google Ads conversion tracking detected (enterprise setup)");
        }

        // Check collect hit query params for user ID
        if ((parsed.pathname.includes("/g/collect") || parsed.pathname.includes("/collect")) &&
            (parsed.searchParams.get("uid") || parsed.searchParams.get("_uip"))) {
          hints.push("user ID or IP override in collect hit (360 feature)");
        }
      } catch {}
    }
  }

  // Deduplicate hints (same signal from multiple events)
  const uniqueHints = [...new Set(hints)];

  // Lower threshold: even 1 enterprise signal is meaningful
  if (uniqueHints.length >= 2) return { version: "360", hints: uniqueHints };
  if (uniqueHints.length === 1) return { version: "360-likely", hints: uniqueHints };
  return { version: "free", hints: uniqueHints };
}

/**
 * Get the effective limits based on GA4 version.
 */
function getEffectiveLimits(ga4Version) {
  if (ga4Version === "360") return LIMITS_360;
  return LIMITS; // default to stricter free limits
}


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

defineRule("param-value-too-long", (event, sessionState) => {
  const params = getParams(event);
  if (!params) return [];
  const limits = getEffectiveLimits(sessionState?._ga4Version);
  const results = [];
  for (const [key, val] of Object.entries(params)) {
    if (typeof val === "string" && val.length > limits.paramValueMaxLength) {
      const is360 = sessionState?._ga4Version === "360";
      results.push(finding(
        "param-value-too-long", is360 ? "warning" : "warning", "limits",
        `Parameter "${key}" value exceeds ${limits.paramValueMaxLength} characters (${val.length})`,
        is360
          ? "GA4 360 truncates parameter values at 500 characters. Data beyond the limit is lost."
          : `Standard GA4 truncates parameter values at 100 characters (GA4 360 allows 500). Data beyond the limit is lost.`,
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
// CATEGORY: GTM
// Rules specific to Google Tag Manager configuration
// and common GTM implementation issues.
// ──────────────────────────────────────────────

/**
 * Detect multiple GTM containers on the same page.
 * Multiple containers increase page weight and can cause conflicting configurations.
 */
defineRule("gtm-multiple-containers", (event, sessionState) => {
  if (!sessionState) return [];

  // Track container IDs from gtm.js events (dataLayer marker) and network loads
  if (!sessionState.gtmContainerIds) sessionState.gtmContainerIds = new Set();

  // GTM pushes { event: "gtm.js" } when it loads
  const name = getEventName(event);

  // Check network hits for GTM container loads
  if (event.source === "network" || event.hitType === "gtm-container") {
    const url = event.url || "";
    const match = url.match(/[?&]id=(GTM-[A-Z0-9]+)/);
    if (match) {
      sessionState.gtmContainerIds.add(match[1]);
      if (sessionState.gtmContainerIds.size > 1) {
        return [finding(
          "gtm-multiple-containers", "warning", "gtm",
          `Multiple GTM containers detected: ${Array.from(sessionState.gtmContainerIds).join(", ")}`,
          "Running multiple GTM containers on the same page increases page load time, may cause duplicate event tracking, and makes debugging more difficult. Consider consolidating into a single container.",
          "https://support.google.com/tagmanager/answer/6103696"
        )];
      }
    }
  }

  // Also detect from dataLayer events with gtm.uniqueEventId patterns
  if (event.source === "dataLayer" && event.payload) {
    const containerId = event.payload["gtm.container"] || event.payload["gtm.containerId"];
    if (containerId) {
      sessionState.gtmContainerIds.add(containerId);
      if (sessionState.gtmContainerIds.size > 1) {
        return [finding(
          "gtm-multiple-containers", "warning", "gtm",
          `Multiple GTM containers detected: ${Array.from(sessionState.gtmContainerIds).join(", ")}`,
          "Running multiple GTM containers on the same page increases page load time, may cause duplicate event tracking, and makes debugging more difficult. Consider consolidating into a single container.",
          "https://support.google.com/tagmanager/answer/6103696"
        )];
      }
    }
  }

  return [];
});

/**
 * Detect if dataLayer is being used without prior initialization.
 * Best practice: window.dataLayer = [] before GTM snippet.
 */
defineRule("gtm-datalayer-before-gtm", (event, sessionState) => {
  if (!sessionState) return [];
  if (sessionState._gtmTimingChecked) return [];

  // Track the order of dataLayer init vs GTM load
  const name = getEventName(event);

  if (name === "gtm.js") {
    // GTM loaded — if we haven't seen any prior dataLayer pushes, that's fine
    // (GTM creates dataLayer itself). But flag it if we saw dataLayer items
    // AFTER gtm.js but before the container was ready.
    sessionState._gtmLoaded = true;
    sessionState._gtmLoadTime = event.time || new Date().toISOString();
  }

  // Check for dataLayer pushes that happen without gtm.start being present
  if (event.source === "dataLayer" && name === "gtm.load") {
    sessionState._gtmTimingChecked = true;
    // Check if there are dataLayer items pushed before gtm.js
    if (sessionState._dataLayerItemsBeforeGTM === 0 && sessionState._hasCustomPushes === false) {
      // Fine — no custom pushes needed before GTM
    }
  }

  return [];
});

/**
 * Detect if no GTM container is found on the page.
 * If we see GA4 events but no GTM container, the implementation might be
 * using gtag.js directly instead of GTM.
 */
defineRule("gtm-container-not-found", (event, sessionState) => {
  if (!sessionState) return [];
  if (sessionState._gtmContainerFound || sessionState._gtmContainerChecked) return [];

  const name = getEventName(event);

  if (name === "gtm.js" || name === "gtm.load") {
    sessionState._gtmContainerFound = true;
    return [];
  }

  // If we see gtag config/event calls but no GTM after several events, flag it
  if (!sessionState._eventCount) sessionState._eventCount = 0;
  sessionState._eventCount++;

  if (event.source === "gtag" && event.type === "config" && sessionState._eventCount > 3) {
    if (!sessionState._gtmContainerFound) {
      sessionState._gtmContainerChecked = true;
      return [finding(
        "gtm-container-not-found", "info", "gtm",
        "No GTM container detected — site appears to use gtag.js directly",
        "This site is using the gtag.js snippet directly instead of Google Tag Manager. GTM provides more flexibility for tag management, version control, and debugging. Consider migrating to GTM.",
        "https://support.google.com/tagmanager/answer/6103696"
      )];
    }
  }

  return [];
});

/**
 * Detect GTM preview/debug mode being active.
 */
defineRule("gtm-debug-mode-active", (event, sessionState) => {
  if (!sessionState) return [];
  if (sessionState._gtmDebugDetected) return [];

  const name = getEventName(event);

  // GTM debug mode fires a special event
  if (event.source === "dataLayer" && event.payload) {
    if (event.payload["gtm.uniqueEventId"] !== undefined && event.payload.event === "gtm.debug") {
      sessionState._gtmDebugDetected = true;
      return [finding(
        "gtm-debug-mode-active", "info", "gtm",
        "GTM Preview/Debug mode is active",
        "Tag Manager is currently running in preview mode. This is useful for testing but remember to publish changes and exit preview mode before leaving. Debug mode adds overhead to page load.",
        "https://support.google.com/tagmanager/answer/6107056"
      )];
    }
  }

  // Also detect from network hit to debug endpoint
  if (event.hitType === "gtm-container" || event.source === "network") {
    const url = event.url || "";
    if (url.includes("gtm_debug") || url.includes("gtm_preview")) {
      sessionState._gtmDebugDetected = true;
      return [finding(
        "gtm-debug-mode-active", "info", "gtm",
        "GTM Preview/Debug mode is active",
        "Tag Manager is currently running in preview mode. This is useful for testing but remember to publish changes and exit preview mode before leaving.",
        "https://support.google.com/tagmanager/answer/6107056"
      )];
    }
  }

  return [];
});

/**
 * Check for consent mode configuration.
 * Sites in regions requiring consent (EU, etc.) should configure consent mode.
 */
defineRule("gtm-consent-mode-missing", (event, sessionState) => {
  if (!sessionState) return [];
  if (sessionState._consentModeFound || sessionState._consentChecked) return [];

  // Consent mode is set via gtag("consent", "default", {...})
  if (event.source === "gtag" && event.type === "set") {
    if (event.params && (event.params.ad_storage !== undefined || event.params.analytics_storage !== undefined)) {
      sessionState._consentModeFound = true;
      return [];
    }
  }

  // Or via dataLayer push with consent_mode
  if (event.source === "dataLayer" && event.payload) {
    const p = event.payload;
    if (p.consent_mode || p["gtag.consent"] || p.ad_storage !== undefined || p.analytics_storage !== undefined) {
      sessionState._consentModeFound = true;
      return [];
    }
  }

  // Also check raw gtag consent calls
  if (event.source === "gtag" && event.raw && Array.isArray(event.raw)) {
    if (event.raw[0] === "consent") {
      sessionState._consentModeFound = true;
      return [];
    }
  }

  // After seeing enough events without consent config, flag it
  if (!sessionState._consentEventCount) sessionState._consentEventCount = 0;
  sessionState._consentEventCount++;

  if (sessionState._consentEventCount >= 8 && !sessionState._consentModeFound) {
    sessionState._consentChecked = true;
    return [finding(
      "gtm-consent-mode-missing", "warning", "gtm",
      "No consent mode configuration detected",
      "Google Consent Mode v2 is required for proper data collection in regions with privacy regulations (GDPR, etc.). Without consent mode, Google may limit data processing. Configure consent defaults before the GTM snippet loads.",
      "https://developers.google.com/tag-platform/security/guides/consent"
    )];
  }

  return [];
});

/**
 * Detect if GTM loaded but no page_view event was fired.
 * This usually means the GA4 Configuration tag or page_view trigger is misconfigured.
 */
defineRule("gtm-no-pageview-tag", (event, sessionState) => {
  if (!sessionState) return [];
  if (sessionState._pageViewFound || sessionState._pageViewChecked) return [];

  const name = getEventName(event);

  if (name === "page_view") {
    sessionState._pageViewFound = true;
    return [];
  }

  if (name === "gtm.js") {
    sessionState._gtmJsSeen = true;
  }

  // After GTM loads and we've seen several events without page_view, flag it
  if (!sessionState._pvEventCount) sessionState._pvEventCount = 0;
  sessionState._pvEventCount++;

  if (sessionState._gtmJsSeen && sessionState._pvEventCount >= 10 && !sessionState._pageViewFound) {
    sessionState._pageViewChecked = true;
    return [finding(
      "gtm-no-pageview-tag", "warning", "gtm",
      "GTM loaded but no page_view event detected",
      "The GA4 Configuration tag or page_view event tag may not be firing. Ensure you have a GA4 tag configured to fire on 'All Pages' or 'Page View' trigger in your GTM container.",
      "https://support.google.com/tagmanager/answer/9442095"
    )];
  }

  return [];
});

/**
 * Detect the same GTM container ID loaded more than once.
 * This is different from multiple containers — it's the same container loaded twice.
 */
defineRule("gtm-duplicate-container-id", (event, sessionState) => {
  if (!sessionState) return [];

  if (!sessionState._gtmLoadCounts) sessionState._gtmLoadCounts = {};

  // Detect from network loads
  if (event.hitType === "gtm-container" || (event.source === "network" && (event.url || "").includes("gtm.js"))) {
    const url = event.url || "";
    const match = url.match(/[?&]id=(GTM-[A-Z0-9]+)/);
    if (match) {
      const id = match[1];
      sessionState._gtmLoadCounts[id] = (sessionState._gtmLoadCounts[id] || 0) + 1;
      if (sessionState._gtmLoadCounts[id] === 2) {
        return [finding(
          "gtm-duplicate-container-id", "error", "gtm",
          `GTM container ${id} is loaded more than once`,
          "The same GTM container is being loaded multiple times on this page. This causes duplicate event firing, inflated analytics data, and slower page performance. Remove the duplicate GTM snippet.",
          "https://support.google.com/tagmanager/answer/6103696"
        )];
      }
    }
  }

  return [];
});

/**
 * Check for GTM noscript fallback.
 * The <noscript> iframe is recommended for users with JavaScript disabled.
 */
defineRule("gtm-noscript-missing", (event, sessionState) => {
  if (!sessionState) return [];
  // This rule works best when we can check the DOM.
  // We detect it via a synthetic event that the hook can push.
  // For now, this is a placeholder that triggers on GTM load.
  // The actual noscript detection requires DOM inspection which
  // the recorder can do via executeScript.
  return [];
});


// ──────────────────────────────────────────────
// GTM Hygiene rules
// ──────────────────────────────────────────────

/**
 * Detect inconsistent event naming conventions across custom events.
 * Fires after seeing 5+ custom events if naming patterns are mixed
 * (e.g. some camelCase, some snake_case, some with spaces).
 */
defineRule("gtm-event-naming-inconsistent", (event, sessionState) => {
  if (!sessionState) return [];
  if (sessionState._namingChecked) return [];

  if (!sessionState._customNames) sessionState._customNames = [];

  const name = getEventName(event);
  if (!name || name.startsWith("gtm.") || name === "page_view" || name === "session_start") return [];

  sessionState._customNames.push(name);

  if (sessionState._customNames.length >= 5) {
    sessionState._namingChecked = true;
    const names = sessionState._customNames;

    const hasSnake = names.some(n => /_/.test(n) && !/[A-Z]/.test(n));
    const hasCamel = names.some(n => /[a-z][A-Z]/.test(n));
    const hasSpaces = names.some(n => / /.test(n));
    const hasDashes = names.some(n => /-/.test(n));
    const styles = [hasSnake, hasCamel, hasSpaces, hasDashes].filter(Boolean).length;

    if (styles >= 2) {
      return [finding(
        "gtm-event-naming-inconsistent", "warning", "gtm",
        "Inconsistent event naming conventions detected",
        `Found mixed naming styles: ${names.slice(0, 6).join(", ")}. Pick one convention (GA4 recommends lowercase snake_case) and stick with it across all tags.`,
        "https://support.google.com/analytics/answer/13316687"
      )];
    }
  }

  return [];
});

/**
 * GTM loaded but only built-in events detected — no custom tracking.
 * This means GTM is installed but not actually configured to do anything useful.
 */
defineRule("gtm-no-custom-events", (event, sessionState) => {
  if (!sessionState) return [];
  if (sessionState._customEventsChecked) return [];

  if (!sessionState._gtmBuiltins) sessionState._gtmBuiltins = 0;
  if (!sessionState._customCount) sessionState._customCount = 0;

  const name = getEventName(event);
  if (!name) return [];

  if (name.startsWith("gtm.")) {
    sessionState._gtmBuiltins++;
  } else {
    sessionState._customCount++;
  }

  // After 15 total events, if zero custom events but GTM is firing built-ins
  const total = sessionState._gtmBuiltins + sessionState._customCount;
  if (total >= 15 && sessionState._gtmBuiltins >= 3 && sessionState._customCount === 0) {
    sessionState._customEventsChecked = true;
    return [finding(
      "gtm-no-custom-events", "warning", "gtm",
      "GTM is loaded but no custom events are being tracked",
      "Only GTM built-in events (gtm.js, gtm.dom, gtm.load) were detected. No custom event tracking is firing. Check that your tags have the correct triggers and that events are being pushed to the dataLayer.",
      "https://support.google.com/tagmanager/answer/7679219"
    )];
  }

  return [];
});

/**
 * Detect rapid duplicate event fires — same event name within 50ms.
 * Usually means duplicate tags or misconfigured triggers.
 */
defineRule("gtm-rapid-duplicate-fire", (event, sessionState) => {
  if (!sessionState) return [];

  if (!sessionState._eventTimestamps) sessionState._eventTimestamps = {};
  if (!sessionState._rapidDupsReported) sessionState._rapidDupsReported = new Set();

  const name = getEventName(event);
  if (!name || name.startsWith("gtm.")) return [];

  const now = event.time ? new Date(event.time).getTime() : Date.now();

  if (sessionState._eventTimestamps[name]) {
    const lastTime = sessionState._eventTimestamps[name];
    const delta = now - lastTime;

    if (delta >= 0 && delta < 50 && !sessionState._rapidDupsReported.has(name)) {
      sessionState._rapidDupsReported.add(name);
      return [finding(
        "gtm-rapid-duplicate-fire", "warning", "gtm",
        `"${name}" fired twice in ${delta}ms — likely a duplicate tag`,
        `The event "${name}" fired in rapid succession (${delta}ms apart). This usually means two tags are firing the same event, or a trigger is double-firing. Check GTM Preview mode to identify which tags are responsible.`,
        "https://support.google.com/tagmanager/answer/6107056"
      )];
    }
  }

  sessionState._eventTimestamps[name] = now;
  return [];
});

/**
 * Detect dataLayer.push() calls without an "event" key.
 * These won't trigger any GTM tags and are often mistakes.
 */
defineRule("gtm-datalayer-push-no-event", (event, sessionState) => {
  if (!sessionState) return [];
  if (sessionState._noEventPushReported) return [];

  if (event.source !== "dataLayer") return [];

  const payload = event.payload || {};
  const hasEventKey = "event" in payload;

  // Skip the initial GTM container load events
  if (payload["gtm.start"] || payload["gtm.uniqueEventId"] !== undefined) return [];

  if (!hasEventKey && Object.keys(payload).length > 0) {
    if (!sessionState._noEventPushCount) sessionState._noEventPushCount = 0;
    sessionState._noEventPushCount++;

    // Report after seeing 3 pushes without event keys
    if (sessionState._noEventPushCount >= 3) {
      sessionState._noEventPushReported = true;
      return [finding(
        "gtm-datalayer-push-no-event", "info", "gtm",
        `${sessionState._noEventPushCount} dataLayer pushes detected without an "event" key`,
        `dataLayer.push() calls without an "event" property won't trigger GTM tags. If you're setting variables for later use, this is fine. If you expect tags to fire, add an event name: dataLayer.push({ event: "my_event", ... })`,
        "https://developers.google.com/tag-platform/tag-manager/datalayer"
      )];
    }
  }

  return [];
});

/**
 * Detect slow GTM container load — gap between gtm.js and gtm.load > 5 seconds.
 * Indicates a bloated container or blocked resources.
 */
defineRule("gtm-container-load-slow", (event, sessionState) => {
  if (!sessionState) return [];
  if (sessionState._loadTimeChecked) return [];

  const name = getEventName(event);
  const now = event.time ? new Date(event.time).getTime() : Date.now();

  if (name === "gtm.js") {
    sessionState._gtmJsTime = now;
  }

  if (name === "gtm.load" && sessionState._gtmJsTime) {
    sessionState._loadTimeChecked = true;
    const loadTime = now - sessionState._gtmJsTime;

    if (loadTime > 5000) {
      const seconds = (loadTime / 1000).toFixed(1);
      return [finding(
        "gtm-container-load-slow", "warning", "gtm",
        `GTM container took ${seconds}s to fully load`,
        `The gap between gtm.js (container start) and gtm.load (all tags ready) was ${seconds} seconds. This may indicate a bloated container with too many tags, heavy custom HTML, or blocked third-party resources. Consider auditing unused tags and reducing custom JavaScript.`,
        "https://developers.google.com/tag-platform/tag-manager/web"
      )];
    }
  }

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
 * @param {Object} [options] - Optional config
 * @param {Array}  [options.networkHits] - Network hits for GA4 version detection
 * @param {string} [options.ga4Version] - Override: "free", "360", or "auto" (default)
 * @returns {Object} { findings: [...], summary: { errors, warnings, info }, ga4Version: {...} }
 */
function lintSession(events, options = {}) {
  const { networkHits = [], ga4Version: versionOverride } = options;

  // Detect GA4 version (or use override)
  let ga4VersionResult;
  if (versionOverride && versionOverride !== "auto") {
    ga4VersionResult = { version: versionOverride, hints: ["user override"] };
  } else {
    ga4VersionResult = detectGA4Version(events, networkHits);
  }

  const sessionState = {
    _ga4Version: ga4VersionResult.version,
    _ga4Limits: getEffectiveLimits(ga4VersionResult.version),
  };

  const allFindings = [];

  for (let i = 0; i < events.length; i++) {
    const eventFindings = lintEvent(events[i], sessionState);
    eventFindings.forEach(f => {
      f.eventIndex = i;
      allFindings.push(f);
    });
  }

  // Add GA4 version detection info finding if hints were found
  if (ga4VersionResult.hints.length > 0 && ga4VersionResult.version !== "free") {
    allFindings.push({
      ruleId: "ga4-version-detected",
      severity: "info",
      category: "quality",
      message: ga4VersionResult.version === "360"
        ? "GA4 360 property detected — using expanded limits"
        : "Possible GA4 360 property — some limits may be higher than shown",
      detail: `Signals: ${ga4VersionResult.hints.join("; ")}. ` +
        (ga4VersionResult.version === "unknown"
          ? "If this is a 360 property, parameter value limits increase from 100 to 500 characters, and you get more custom dimensions. Set your version in extension settings for precise checks."
          : "Limits applied: parameter values up to 500 chars, up to 125 event-scoped custom dimensions, up to 100 user properties."),
      docs: "https://support.google.com/analytics/answer/11202874",
    });
  }

  const summary = {
    errors: allFindings.filter(f => f.severity === "error").length,
    warnings: allFindings.filter(f => f.severity === "warning").length,
    info: allFindings.filter(f => f.severity === "info").length,
    total: allFindings.length,
  };

  return { findings: allFindings, summary, ga4Version: ga4VersionResult };
}

// Make available to panel.js (global scope in extension)
if (typeof window !== "undefined") {
  window.FairyLint = { lintEvent, lintSession, detectGA4Version, getEffectiveLimits, LIMITS, LIMITS_360 };
}

// Make available to Node.js / tests
if (typeof module !== "undefined" && module.exports) {
  module.exports = { lintEvent, lintSession, detectGA4Version, getEffectiveLimits, LIMITS, LIMITS_360, rules };
}
