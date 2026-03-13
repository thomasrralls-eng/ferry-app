/**
 * Ferry Analysis Agent
 *
 * Takes the raw output of a recording or crawl session (events, network hits,
 * findings) and produces an actionable, prioritized report — not just a list
 * of warnings, but a "here's what to fix first and how" experience.
 *
 * The agent:
 *   1. Groups related findings into themes (ecommerce, naming, consent, etc.)
 *   2. Scores each group by business impact
 *   3. Generates specific fix suggestions with code snippets where possible
 *   4. Produces an overall health score (0–100)
 *   5. Returns a ranked list of action items
 */

// ──────────────────────────────────────────────
// Theme definitions
// ──────────────────────────────────────────────

const THEMES = {
  "data-loss": {
    label: "Data Loss",
    icon: "critical",
    description: "Events or parameters being silently dropped by GA4",
    impactWeight: 10,
    ruleIds: [
      "event-name-invalid-chars", "event-name-must-start-alpha",
      "event-name-too-long", "event-name-reserved", "event-name-reserved-prefix",
      "event-name-has-spaces", "empty-event-name",
      "param-name-invalid", "param-name-reserved-prefix", "param-name-too-long",
      "too-many-params",
    ],
  },
  "ecommerce": {
    label: "Ecommerce & Revenue",
    icon: "revenue",
    description: "Issues affecting purchase tracking and revenue reporting",
    impactWeight: 9,
    ruleIds: [
      "ecommerce-missing-items", "ecommerce-item-missing-id-or-name",
      "purchase-missing-transaction-id", "purchase-missing-value",
      "value-without-currency", "currency-invalid-format", "value-not-numeric",
      "ecommerce-items-too-many", "transaction-id-reused",
    ],
  },
  "pii-compliance": {
    label: "Privacy & Compliance",
    icon: "shield",
    description: "PII exposure, consent mode, and policy violations",
    impactWeight: 9,
    ruleIds: [
      "user-id-contains-pii", "enhanced-conversions-unhashed-email",
      "enhanced-conversions-unhashed-phone", "gtm-consent-mode-missing",
    ],
  },
  "not-set": {
    label: "(not set) Dimensions",
    icon: "warning",
    description: "Configuration issues causing (not set) values in GA4 reports",
    impactWeight: 7,
    ruleIds: [
      "enhanced-measurement-duplicate", "page-view-missing-page-location",
      "event-scoped-on-session-dimension", "missing-page-view-in-session",
    ],
  },
  "gtm-config": {
    label: "GTM Configuration",
    icon: "config",
    description: "Google Tag Manager setup and container issues",
    impactWeight: 6,
    ruleIds: [
      "gtm-multiple-containers", "gtm-duplicate-container-id",
      "gtm-no-pageview-tag", "gtm-container-not-found",
      "gtm-debug-mode-active", "gtm-datalayer-before-gtm",
      "gtm-noscript-missing",
    ],
  },
  "naming-quality": {
    label: "Naming & Best Practices",
    icon: "quality",
    description: "Event naming conventions and data quality improvements",
    impactWeight: 4,
    ruleIds: [
      "event-name-uppercase", "duplicate-event-rapid-fire",
      "param-value-too-long", "ga4-version-detected",
    ],
  },
  "gtm-hygiene": {
    label: "GTM Hygiene",
    icon: "quality",
    description: "Tag naming, trigger timing, event structure, and container health",
    impactWeight: 3,
    ruleIds: [
      "gtm-event-naming-inconsistent", "gtm-no-custom-events",
      "gtm-rapid-duplicate-fire", "gtm-datalayer-push-no-event",
      "gtm-container-load-slow",
    ],
  },
};

// ──────────────────────────────────────────────
// Risk classification
// ──────────────────────────────────────────────
//
// Each fix is classified by risk of implementation:
//
//   "safe"   — No risk. Fixing this starts capturing data that's currently
//              being lost. Nothing existing breaks. (e.g., rename an event
//              that GA4 is silently dropping — you gain data, lose nothing)
//
//   "low"    — Very low risk. Adds new data or fixes a format issue.
//              Existing reporting is unaffected. (e.g., add missing
//              transaction_id, add currency parameter)
//
//   "medium" — Moderate risk. Changes something that IS currently being
//              captured, so GA4 reports will show a discontinuity.
//              (e.g., rename an event that's being tracked — old name
//              stops, new name starts, historical comparison breaks)
//              Requires GTM/GA4 access to do safely.
//
//   "high"   — High risk. Structural change that affects multiple tags,
//              triggers, or audiences. Needs careful planning, staging,
//              and ideally GTM version control. (e.g., consolidate
//              containers, restructure consent mode, remove duplicate tags)
//              Requires GTM/GA4 access + expertise.
//
// The "tier" field maps to the product tier:
//   "free"   — Can be acted on with just the extension's guidance
//   "pro"    — Needs GTM/GA4 API access (paid subscription)
// ──────────────────────────────────────────────

const RISK_METADATA = {
  // ── SAFE: data currently being lost, fixing only gains ──
  "event-name-invalid-chars":       { risk: "safe",   effort: "quick",  tier: "free", rationale: "This event is being silently dropped. Renaming it will start capturing data with zero impact on existing reports." },
  "event-name-must-start-alpha":    { risk: "safe",   effort: "quick",  tier: "free", rationale: "GA4 rejects this event. Fixing the name starts data collection — nothing existing breaks." },
  "event-name-too-long":            { risk: "safe",   effort: "quick",  tier: "free", rationale: "GA4 drops or truncates this. A shorter name means data actually gets collected." },
  "event-name-reserved":            { risk: "safe",   effort: "quick",  tier: "free", rationale: "Reserved names are silently dropped. Renaming captures data you're currently losing." },
  "event-name-reserved-prefix":     { risk: "safe",   effort: "quick",  tier: "free", rationale: "This prefix causes GA4 to reject the event. Removing it starts data capture." },
  "event-name-has-spaces":          { risk: "safe",   effort: "quick",  tier: "free", rationale: "Events with spaces are rejected. Replace with underscores to start collecting." },
  "empty-event-name":               { risk: "safe",   effort: "quick",  tier: "free", rationale: "No event name means GA4 drops this entirely. Adding a name captures the data." },
  "param-name-invalid":             { risk: "safe",   effort: "quick",  tier: "free", rationale: "Invalid parameter names are silently dropped. Fixing the name starts capturing the data." },
  "param-name-reserved-prefix":     { risk: "safe",   effort: "quick",  tier: "free", rationale: "Reserved prefixes cause silent drops. Renaming recovers lost parameter data." },
  "param-name-too-long":            { risk: "safe",   effort: "quick",  tier: "free", rationale: "Parameters over 40 chars are dropped. Shortening captures them." },

  // ── LOW: adds missing data, doesn't change existing ──
  "ecommerce-missing-items":        { risk: "low",    effort: "medium", tier: "free", rationale: "Adding the items array enables ecommerce reports without affecting other tracked events." },
  "ecommerce-item-missing-id-or-name": { risk: "low", effort: "medium", tier: "free", rationale: "Adding identifiers to items populates ecommerce dimensions — no downside." },
  "purchase-missing-transaction-id": { risk: "low",   effort: "medium", tier: "free", rationale: "Adding a transaction_id prevents double-counting and enables deduplication." },
  "purchase-missing-value":         { risk: "low",    effort: "quick",  tier: "free", rationale: "Adding value + currency enables revenue reporting. No existing data is changed." },
  "value-without-currency":         { risk: "low",    effort: "quick",  tier: "free", rationale: "GA4 ignores value without currency. Adding currency makes revenue count." },
  "currency-invalid-format":        { risk: "low",    effort: "quick",  tier: "free", rationale: "Fixing the currency code format makes existing value data count in reports." },
  "value-not-numeric":              { risk: "low",    effort: "quick",  tier: "free", rationale: "Switching from string to number ensures GA4 processes the value correctly." },
  "too-many-params":                { risk: "low",    effort: "medium", tier: "free", rationale: "Extra parameters are dropped silently. Reducing to 25 captures more signal." },
  "ecommerce-items-too-many":       { risk: "low",    effort: "medium", tier: "free", rationale: "Items beyond 200 are dropped. Paginating or trimming captures them all." },
  "page-view-missing-page-location": { risk: "low",   effort: "quick",  tier: "free", rationale: "Adding page_location fixes (not set) in Landing Page reports." },
  "missing-page-view-in-session":   { risk: "low",    effort: "medium", tier: "free", rationale: "Ensuring page_view fires fixes session attribution with no downside." },
  "gtm-no-pageview-tag":            { risk: "low",    effort: "medium", tier: "pro",  rationale: "Adding a GA4 Config tag in GTM starts page tracking. Requires GTM access." },
  "gtm-debug-mode-active":          { risk: "low",    effort: "quick",  tier: "free", rationale: "Just exit preview mode — no configuration changes needed." },

  // ── MEDIUM: changes existing tracked data or behavior ──
  "event-name-uppercase":           { risk: "medium", effort: "medium", tier: "pro",  rationale: "Renaming active events creates a data discontinuity. Historical data keeps the old name; new data gets the new name. Plan a clean cutover." },
  "enhanced-measurement-duplicate": { risk: "medium", effort: "medium", tier: "pro",  rationale: "Removing the duplicate tag changes event counts in reports. Verify which version has the right parameters before removing one." },
  "event-scoped-on-session-dimension": { risk: "medium", effort: "medium", tier: "pro", rationale: "Moving parameters to session-level events changes how GA4 attributes sessions. Test in GTM preview first." },
  "duplicate-event-rapid-fire":     { risk: "medium", effort: "medium", tier: "pro",  rationale: "Removing a duplicate tag will halve event counts for this event. Verify which tag is the correct one." },
  "transaction-id-reused":          { risk: "medium", effort: "medium", tier: "pro",  rationale: "Adding deduplication logic changes purchase counts if duplicates were being counted. Verify revenue impact." },
  "param-value-too-long":           { risk: "medium", effort: "medium", tier: "free", rationale: "Truncating values may lose meaningful data. Consider restructuring rather than blindly cutting." },
  "gtm-container-not-found":        { risk: "medium", effort: "large",  tier: "pro",  rationale: "Migrating from gtag.js to GTM is a significant project. Plan carefully and test thoroughly." },

  // ── HIGH: structural changes, multiple dependencies ──
  "user-id-contains-pii":           { risk: "high",   effort: "large",  tier: "pro",  rationale: "Changing user_id format affects User Explorer, audiences, and any systems using the ID for joins. Coordinate with your data team." },
  "enhanced-conversions-unhashed-email": { risk: "high", effort: "large", tier: "pro", rationale: "Changing the hashing approach affects Enhanced Conversions match rates. Test with Google's validation tools." },
  "enhanced-conversions-unhashed-phone": { risk: "high", effort: "large", tier: "pro", rationale: "Phone normalization changes affect match rates. Test thoroughly." },
  "gtm-consent-mode-missing":       { risk: "high",   effort: "large",  tier: "pro",  rationale: "Consent mode changes affect all data collection. Misconfiguration can block all tracking. Stage carefully." },
  "gtm-multiple-containers":        { risk: "high",   effort: "large",  tier: "pro",  rationale: "Consolidating containers requires migrating all tags, triggers, and variables. Major project." },
  "gtm-duplicate-container-id":     { risk: "high",   effort: "medium", tier: "pro",  rationale: "Removing the duplicate snippet changes event volumes. Identify the correct one first." },
  "gtm-datalayer-before-gtm":       { risk: "high",   effort: "large",  tier: "pro",  rationale: "Changing dataLayer initialization order can break tag sequencing." },
  "gtm-noscript-missing":           { risk: "low",    effort: "quick",  tier: "free", rationale: "Adding the noscript fallback has no impact on JavaScript users." },
  "ga4-version-detected":            { risk: "safe",   effort: "quick",  tier: "free", rationale: "Informational — confirms which GA4 version is active so limits are applied correctly." },
};


// ──────────────────────────────────────────────
// Conversational labels
// ──────────────────────────────────────────────
//
// These turn dry rule IDs into human-friendly group headings.
//
// Template vars:
//   {{n}}     = number of UNIQUE entity names that need fixing
//   {{total}} = total times the issue occurred (across all occurrences)
//
// The key insight: the user needs to fix {{n}} things, not {{total}} things.
// {{total}} is useful context ("rejected 34 times") but shouldn't be the
// primary number — that overstates the work.

const CONVERSATIONAL_LABELS = {
  "event-name-invalid-chars":       { singular: "1 event has an invalid name and was rejected by GA4 {{total}} time{{s}}",            plural: "{{n}} events have invalid names, and their data was rejected by GA4 {{total}} times" },
  "event-name-must-start-alpha":    { singular: "1 event name starts with a non-letter character and was rejected {{total}} time{{s}}", plural: "{{n}} event names start with non-letter characters, rejected {{total}} times total" },
  "event-name-too-long":            { singular: "1 event name is over 40 characters and was dropped {{total}} time{{s}}",             plural: "{{n}} event names are over 40 characters, dropped {{total}} times total" },
  "event-name-reserved":            { singular: "1 event uses a reserved name — rejected by GA4 {{total}} time{{s}}",                 plural: "{{n}} events use reserved names — rejected by GA4 {{total}} times total" },
  "event-name-reserved-prefix":     { singular: "1 event uses a reserved prefix — rejected {{total}} time{{s}}",                      plural: "{{n}} events use reserved prefixes — rejected {{total}} times total" },
  "event-name-has-spaces":          { singular: "1 event name has spaces — rejected by GA4 {{total}} time{{s}}",                      plural: "{{n}} event names have spaces — rejected by GA4 {{total}} times total" },
  "empty-event-name":               { singular: "1 event is firing with no name at all ({{total}} time{{s}})",                        plural: "{{n}} events are firing with no name at all ({{total}} times total)" },
  "param-name-invalid":             { singular: "1 parameter has an invalid name and was dropped {{total}} time{{s}}",                plural: "{{n}} parameters have invalid names, dropped {{total}} times total" },
  "param-name-reserved-prefix":     { singular: "1 parameter uses a reserved prefix — silently lost {{total}} time{{s}}",             plural: "{{n}} parameters use reserved prefixes — silently lost {{total}} times total" },
  "param-name-too-long":            { singular: "1 parameter name is over 40 characters — dropped {{total}} time{{s}}",               plural: "{{n}} parameter names are over 40 characters — dropped {{total}} times total" },
  "too-many-params":                { singular: "1 event sends more than 25 parameters — extras dropped {{total}} time{{s}}",         plural: "{{n}} events send more than 25 parameters — extras dropped {{total}} times total" },
  "ecommerce-missing-items":        { singular: "1 ecommerce event is missing its items array ({{total}} time{{s}})",                 plural: "{{n}} ecommerce events are missing their items arrays ({{total}} times total)" },
  "ecommerce-item-missing-id-or-name": { singular: "1 item is missing both item_id and item_name ({{total}} time{{s}})",              plural: "{{n}} items are missing both item_id and item_name ({{total}} times total)" },
  "purchase-missing-transaction-id": { singular: "1 purchase event has no transaction_id ({{total}} time{{s}})",                      plural: "{{n}} purchase events have no transaction_id ({{total}} times total)" },
  "purchase-missing-value":         { singular: "1 purchase event has no value — revenue not tracked ({{total}} time{{s}})",           plural: "{{n}} purchase events have no value — revenue not tracked ({{total}} times total)" },
  "value-without-currency":         { singular: "1 event sends a value without currency — GA4 ignores it ({{total}} time{{s}})",      plural: "{{n}} events send values without currency — GA4 ignores them ({{total}} times total)" },
  "currency-invalid-format":        { singular: "1 event has a malformed currency code ({{total}} time{{s}})",                        plural: "{{n}} events have malformed currency codes ({{total}} times total)" },
  "value-not-numeric":              { singular: "1 event sends value as a string instead of a number ({{total}} time{{s}})",           plural: "{{n}} events send value as strings instead of numbers ({{total}} times total)" },
  "transaction-id-reused":          { singular: "1 transaction ID is being reused — may double-count purchases",                      plural: "{{n}} transaction IDs are being reused — may double-count purchases" },
  "user-id-contains-pii":           { singular: "1 event sends a raw email as user_id — violates Google's TOS",                      plural: "{{n}} events send raw emails as user_id — violates Google's TOS" },
  "enhanced-conversions-unhashed-email": { singular: "1 unhashed email detected in enhanced conversions data",                        plural: "{{n}} unhashed emails detected in enhanced conversions data" },
  "enhanced-conversions-unhashed-phone": { singular: "1 unhashed phone number detected in enhanced conversions data",                 plural: "{{n}} unhashed phone numbers detected in enhanced conversions data" },
  "enhanced-measurement-duplicate": { singular: "1 event duplicates an enhanced measurement event ({{total}} time{{s}})",             plural: "{{n}} events duplicate enhanced measurement events ({{total}} times total)" },
  "page-view-missing-page-location": { singular: "A page_view is missing page_location — Landing Page shows (not set)",               plural: "{{n}} page_view events are missing page_location — Landing Page shows (not set)" },
  "missing-page-view-in-session":   { singular: "A session started without a page_view event",                                        plural: "{{n}} sessions started without a page_view event" },
  "event-scoped-on-session-dimension": { singular: "1 event sends session-level params on the wrong event type",                      plural: "{{n}} events send session-level params on the wrong event type" },
  "event-name-uppercase":           { singular: "1 event name uses uppercase — GA4 treats casing as different events",                plural: "{{n}} event names use uppercase — GA4 treats casing as different events" },
  "duplicate-event-rapid-fire":     { singular: "1 event is firing twice within 200ms — likely a duplicate tag",                      plural: "{{n}} events are firing twice within 200ms — likely duplicate tags" },
  "param-value-too-long":           { singular: "1 parameter value exceeds the character limit — will be truncated",                   plural: "{{n}} parameter values exceed the character limit — will be truncated" },
  "gtm-consent-mode-missing":       { singular: "No consent mode configuration detected",                                            plural: "No consent mode configuration detected" },
  "gtm-multiple-containers":        { singular: "Multiple GTM containers detected on the page",                                       plural: "Multiple GTM containers detected on the page" },
  "gtm-duplicate-container-id":     { singular: "A GTM container is being loaded twice",                                             plural: "{{n}} GTM containers are being loaded twice" },
  "gtm-no-pageview-tag":            { singular: "GTM loaded but no page_view event fired",                                           plural: "GTM loaded but no page_view event fired" },
  "gtm-debug-mode-active":          { singular: "GTM is in preview/debug mode",                                                      plural: "GTM is in preview/debug mode" },
  "gtm-container-not-found":        { singular: "No GTM container detected — site uses gtag.js directly",                            plural: "No GTM container detected — site uses gtag.js directly" },
  "gtm-datalayer-before-gtm":       { singular: "dataLayer initialization order may cause issues",                                    plural: "dataLayer initialization order may cause issues" },
  "gtm-noscript-missing":           { singular: "GTM noscript fallback is missing",                                                  plural: "GTM noscript fallback is missing" },
  "ga4-version-detected":            { singular: "GA4 property version detected — limits adjusted automatically",                    plural: "GA4 property version detected — limits adjusted automatically" },
};


/**
 * Extract a short entity name from a finding's message.
 * E.g. 'Event name "user-sign-up" contains invalid characters' → 'user-sign-up'
 *      'Parameter "ga_custom" uses reserved prefix "ga_"' → 'ga_custom'
 */
function extractEntityName(finding) {
  const msg = finding.message || "";
  // Try to match the first quoted string
  const match = msg.match(/"([^"]+)"/);
  return match ? match[1] : null;
}


// ──────────────────────────────────────────────
// Fix suggestion database
// ──────────────────────────────────────────────

const FIX_SUGGESTIONS = {
  "event-name-invalid-chars": {
    summary: "Rename event to use only letters, numbers, and underscores",
    steps: [
      "Find the gtag() or dataLayer.push() call sending this event",
      "Replace special characters with underscores: my-event → my_event",
      "Update any GA4 custom dimensions or audiences referencing the old name",
    ],
    snippet: `// Before (broken)\ngtag('event', 'user-sign-up', { method: 'Google' });\n\n// After (fixed)\ngtag('event', 'user_sign_up', { method: 'Google' });`,
  },
  "event-name-must-start-alpha": {
    summary: "Rename event to start with a letter",
    steps: [
      "Prefix the event name with a descriptive letter prefix",
      "Update references in GA4 and GTM",
    ],
    snippet: `// Before (broken)\ngtag('event', '1st_purchase', {});\n\n// After (fixed)\ngtag('event', 'first_purchase', {});`,
  },
  "event-name-too-long": {
    summary: "Shorten event name to 40 characters or fewer",
    steps: [
      "Abbreviate the event name while keeping it descriptive",
      "Move extra context into event parameters instead of the name",
    ],
  },
  "event-name-reserved": {
    summary: "Use a different event name — this one is reserved by GA4",
    steps: [
      "Choose a custom name that doesn't conflict with GA4's reserved names",
      "Prefix with your app name if helpful: app_error instead of error",
    ],
  },
  "event-name-has-spaces": {
    summary: "Replace spaces with underscores in the event name",
    steps: [
      "Find the gtag() call or dataLayer.push() sending this event",
      "Replace spaces with underscores: 'add to cart' → 'add_to_cart'",
    ],
    snippet: `// Before (broken)\ndataLayer.push({ event: 'add to cart', ... });\n\n// After (fixed)\ndataLayer.push({ event: 'add_to_cart', ... });`,
  },
  "empty-event-name": {
    summary: "Ensure every event push includes a non-empty event name",
    steps: [
      "Check for dataLayer.push() calls with empty or missing 'event' key",
      "Add a descriptive event name to each push",
    ],
  },
  "ecommerce-missing-items": {
    summary: "Add an items array to this ecommerce event",
    steps: [
      "Every ecommerce event needs a non-empty items[] array",
      "Each item must have at least item_id or item_name",
      "Populate from your product data — use the same item structure across all ecommerce events",
    ],
    snippet: `gtag('event', 'add_to_cart', {\n  currency: 'USD',\n  value: 29.99,\n  items: [{\n    item_id: 'SKU_123',\n    item_name: 'Blue T-Shirt',\n    price: 29.99,\n    quantity: 1\n  }]\n});`,
  },
  "ecommerce-item-missing-id-or-name": {
    summary: "Add item_id or item_name to each item in the items array",
    steps: [
      "Check your product data mapping — every item needs at least one identifier",
      "item_id is preferred (maps to your SKU), item_name is the fallback",
    ],
  },
  "purchase-missing-transaction-id": {
    summary: "Add a unique transaction_id to the purchase event",
    steps: [
      "Generate or retrieve a unique order ID from your backend",
      "Pass it as the transaction_id parameter",
      "This prevents duplicate purchase counting on page refreshes",
    ],
    snippet: `gtag('event', 'purchase', {\n  transaction_id: 'ORDER_12345',  // unique per order\n  value: 99.99,\n  currency: 'USD',\n  items: [/* ... */]\n});`,
  },
  "purchase-missing-value": {
    summary: "Add a value and currency to the purchase event",
    steps: [
      "Calculate the total order value (before or after tax, be consistent)",
      "Always pair value with a 3-letter currency code",
    ],
  },
  "value-without-currency": {
    summary: "Add a currency parameter alongside value",
    steps: [
      "GA4 ignores the value parameter entirely if currency is missing",
      "Use ISO 4217 format: 'USD', 'EUR', 'GBP', etc.",
    ],
    snippet: `// Before (value ignored)\ngtag('event', 'purchase', { value: 49.99 });\n\n// After (value counted)\ngtag('event', 'purchase', { value: 49.99, currency: 'USD' });`,
  },
  "currency-invalid-format": {
    summary: "Fix the currency code to use 3-letter uppercase ISO 4217 format",
    steps: [
      "Use exactly 3 uppercase letters: USD, EUR, GBP, etc.",
      "Check your backend is sending the code correctly (not 'usd' or '$')",
    ],
  },
  "value-not-numeric": {
    summary: "Send value as a number, not a string",
    steps: [
      "Remove currency symbols and formatting: '$50.00' → 50.00",
      "Ensure the value is a JavaScript number, not a string",
    ],
    snippet: `// Before (broken)\ngtag('event', 'purchase', { value: '$50.00', currency: 'USD' });\n\n// After (fixed)\ngtag('event', 'purchase', { value: 50.00, currency: 'USD' });`,
  },
  "transaction-id-reused": {
    summary: "Ensure each purchase event has a unique transaction_id",
    steps: [
      "Check if your purchase confirmation page re-fires on refresh",
      "Add a guard: only push the purchase event once per order ID",
      "Store the sent transaction ID in sessionStorage to deduplicate",
    ],
    snippet: `// Deduplicate purchases on the confirmation page\nconst txId = 'ORDER_12345';\nif (!sessionStorage.getItem('fairy_tx_' + txId)) {\n  sessionStorage.setItem('fairy_tx_' + txId, '1');\n  gtag('event', 'purchase', { transaction_id: txId, /* ... */ });\n}`,
  },
  "user-id-contains-pii": {
    summary: "Hash or replace the user_id — raw emails violate Google's TOS",
    steps: [
      "Replace the raw email with a hashed or opaque internal user ID",
      "If you need email for Enhanced Conversions, use the separate user_data object with SHA-256 hashing",
    ],
    snippet: `// Before (violation)\ngtag('set', { user_id: 'john@example.com' });\n\n// After (compliant)\ngtag('set', { user_id: 'usr_a1b2c3d4' });  // internal ID`,
  },
  "enhanced-conversions-unhashed-email": {
    summary: "SHA-256 hash the email before sending for Enhanced Conversions",
    steps: [
      "Normalize: lowercase and trim whitespace",
      "Hash with SHA-256 (no salt)",
      "Send the hex-encoded hash, not the raw email",
    ],
    snippet: `// Hash email for Enhanced Conversions\nconst email = 'John@Example.com';\nconst normalized = email.toLowerCase().trim();\nconst hash = await crypto.subtle.digest('SHA-256',\n  new TextEncoder().encode(normalized));\nconst hexHash = [...new Uint8Array(hash)]\n  .map(b => b.toString(16).padStart(2, '0')).join('');`,
  },
  "enhanced-conversions-unhashed-phone": {
    summary: "Normalize to E.164 format and SHA-256 hash the phone number",
    steps: [
      "Convert to E.164: +12125551234 (no spaces, dashes, or parens)",
      "SHA-256 hash the normalized number",
    ],
  },
  "gtm-consent-mode-missing": {
    summary: "Configure Google Consent Mode v2 before GTM loads",
    steps: [
      "Add consent defaults BEFORE the GTM snippet in your HTML <head>",
      "Configure both ad_storage and analytics_storage defaults",
      "Integrate with your CMP (Consent Management Platform) to update consent dynamically",
    ],
    snippet: `<!-- Add BEFORE the GTM snippet -->\n<script>\n  window.dataLayer = window.dataLayer || [];\n  function gtag(){dataLayer.push(arguments);}\n  gtag('consent', 'default', {\n    'ad_storage': 'denied',\n    'ad_user_data': 'denied',\n    'ad_personalization': 'denied',\n    'analytics_storage': 'denied'\n  });\n</script>\n<!-- Then your GTM snippet -->`,
  },
  "enhanced-measurement-duplicate": {
    summary: "Remove the duplicate event — Enhanced Measurement already fires it",
    steps: [
      "Check if Enhanced Measurement is enabled in GA4 (Admin → Data Streams → Enhanced Measurement)",
      "If so, remove the manual gtag('event', ...) or dataLayer.push() for this event",
      "Or disable the specific Enhanced Measurement toggle and keep your custom version",
    ],
  },
  "page-view-missing-page-location": {
    summary: "Add page_location to your page_view event",
    steps: [
      "The page_location should contain the full URL",
      "If using GTM, ensure your GA4 Config tag includes page_location or is set to auto-detect",
    ],
    snippet: `gtag('event', 'page_view', {\n  page_location: window.location.href,\n  page_title: document.title\n});`,
  },
  "missing-page-view-in-session": {
    summary: "Ensure a page_view event fires at the start of every session",
    steps: [
      "Check that your GA4 Config tag (or gtag.js snippet) fires on every page load",
      "In GTM, use the 'All Pages' trigger for the GA4 Configuration tag",
      "If using a SPA, ensure page_view fires on each route change",
    ],
  },
  "event-scoped-on-session-dimension": {
    summary: "Move session-level parameters to session_start or page_view",
    steps: [
      "Source, medium, and campaign are session-scoped — GA4 reads them from the first hit",
      "Set these via UTM parameters in the URL or on your config tag, not on individual events",
    ],
  },
  "event-name-uppercase": {
    summary: "Convert event names to lowercase snake_case",
    steps: [
      "GA4 treats 'Add_To_Cart' and 'add_to_cart' as different events",
      "Standardize all event names to lowercase with underscores",
      "Update any GTM triggers or GA4 custom definitions to match",
    ],
  },
  "duplicate-event-rapid-fire": {
    summary: "Investigate why this event fires twice within 200ms",
    steps: [
      "Check for duplicate GTM tags targeting the same trigger",
      "Look for both a GTM tag and a hardcoded gtag() call sending the same event",
      "Use GTM's Preview mode to identify which tags fire for this event",
    ],
  },
  "gtm-multiple-containers": {
    summary: "Consolidate into a single GTM container",
    steps: [
      "Identify which tags live in each container",
      "Migrate all tags into one primary container",
      "Remove the extra GTM snippet from your HTML",
    ],
  },
  "gtm-duplicate-container-id": {
    summary: "Remove the duplicate GTM snippet — the same container is loaded twice",
    steps: [
      "Search your HTML source for the GTM container ID",
      "You'll likely find two identical <script> blocks — remove one",
      "Check for GTM installed via both a plugin and manual code",
    ],
  },
  "gtm-no-pageview-tag": {
    summary: "Add a GA4 Configuration tag that fires on All Pages",
    steps: [
      "In GTM, create a 'Google Tag' (GA4 Configuration) tag",
      "Set the trigger to 'All Pages' (Page View)",
      "Enter your GA4 Measurement ID (G-XXXXXXX)",
      "Publish the container",
    ],
  },
  "gtm-debug-mode-active": {
    summary: "Exit GTM Preview mode when you're done testing",
    steps: [
      "Go to tagmanager.google.com → your workspace",
      "Click 'Leave Preview Mode' in the orange banner",
      "Or close the Tag Assistant tab",
    ],
  },
  "param-name-invalid": {
    summary: "Fix parameter names to use only letters, numbers, and underscores",
    steps: [
      "Replace hyphens and special characters with underscores",
      "Ensure parameter names start with a letter",
    ],
  },
  "param-name-reserved-prefix": {
    summary: "Rename parameters that start with google_, firebase_, or ga_",
    steps: [
      "These prefixes are reserved by Google — your params are silently dropped",
      "Choose a different prefix or remove the prefix entirely",
    ],
  },
  "param-name-too-long": {
    summary: "Shorten parameter names to 40 characters or fewer",
    steps: [
      "Abbreviate while keeping names descriptive",
      "Use consistent, short naming conventions across all events",
    ],
  },
  "param-value-too-long": {
    summary: "Truncate or restructure parameter values that exceed the character limit",
    steps: [
      "Standard GA4 truncates at 100 characters; GA4 360 allows up to 500",
      "If you need long values, consider using a shorter identifier and storing the full value in your own database",
      "data fairy auto-detects your GA4 version — if detection is wrong, you can override it in settings",
    ],
  },
  "ga4-version-detected": {
    summary: "GA4 property version was detected from client-side signals",
    steps: [
      "data fairy adjusts parameter value limits, custom dimension limits, and other thresholds based on your GA4 version",
      "GA4 Free: 100 char param values, 500 distinct events, 50 custom dimensions, 25 user properties",
      "GA4 360: 500 char param values, 2000 distinct events, 125 custom dimensions, 100 user properties",
      "If the auto-detection is incorrect, you can override it in extension settings",
    ],
  },
};


// ──────────────────────────────────────────────
// Health score calculation
// ──────────────────────────────────────────────

function calculateHealthScore(events, network, findings) {
  const totalEvents = events.length + network.length;
  if (totalEvents === 0) return { score: 0, label: "No Data" };

  // Health score = % of events with no errors
  const errorFindings = findings.filter(f => f.severity === "error");
  const eventsWithErrors = new Set(
    errorFindings.map(f => f.eventIndex).filter(idx => idx !== undefined)
  ).size;

  const score = Math.round((1 - eventsWithErrors / totalEvents) * 100);

  let label;
  if (score >= 95) label = "Excellent";
  else if (score >= 85) label = "Good";
  else if (score >= 70) label = "Needs Work";
  else if (score >= 50) label = "Poor";
  else label = "Critical";

  return { score, label };
}


// ──────────────────────────────────────────────
// Group findings into themes
// ──────────────────────────────────────────────

function groupByTheme(findings) {
  // Build a ruleId → theme lookup
  const ruleToTheme = {};
  for (const [themeId, theme] of Object.entries(THEMES)) {
    for (const ruleId of theme.ruleIds) {
      ruleToTheme[ruleId] = themeId;
    }
  }

  const groups = {};

  for (const f of findings) {
    const themeId = ruleToTheme[f.ruleId] || "other";
    if (!groups[themeId]) {
      groups[themeId] = {
        themeId,
        ...(THEMES[themeId] || { label: "Other Issues", icon: "info", description: "", impactWeight: 1 }),
        findings: [],
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
      };
    }
    groups[themeId].findings.push(f);
    if (f.severity === "error") groups[themeId].errorCount++;
    else if (f.severity === "warning") groups[themeId].warningCount++;
    else groups[themeId].infoCount++;
  }

  // Sort groups by impact: error-heavy + high impactWeight first
  return Object.values(groups).sort((a, b) => {
    const aScore = a.errorCount * 10 + a.warningCount * 3 + a.impactWeight;
    const bScore = b.errorCount * 10 + b.warningCount * 3 + b.impactWeight;
    return bScore - aScore;
  });
}


// ──────────────────────────────────────────────
// Generate action items
// ──────────────────────────────────────────────

function generateActionItems(themedGroups, maxItems = 15) {
  const actions = [];
  const seenRuleIds = new Set();

  for (const group of themedGroups) {
    const uniqueFindings = [];
    for (const f of group.findings) {
      if (!seenRuleIds.has(f.ruleId)) {
        seenRuleIds.add(f.ruleId);
        uniqueFindings.push(f);
      }
    }

    for (const f of uniqueFindings) {
      if (actions.length >= maxItems) break;

      const fix = FIX_SUGGESTIONS[f.ruleId];
      const riskMeta = RISK_METADATA[f.ruleId] || { risk: "medium", effort: "medium", tier: "free", rationale: "" };
      const matchingFindings = group.findings.filter(gf => gf.ruleId === f.ruleId);
      const occurrences = matchingFindings.length;

      // Extract specific entity names from each finding for display
      const specificItems = matchingFindings.map(mf => ({
        name: extractEntityName(mf),
        message: mf.message,
        detail: mf.detail,
        eventIndex: mf.eventIndex,
      })).filter(item => item.name); // only keep ones where we found a name

      // Count unique entity names (the things the user actually needs to fix)
      const uniqueNames = new Set(specificItems.map(si => si.name));
      const uniqueCount = uniqueNames.size || 1; // fall back to 1 if no names extracted

      // Build conversational label using unique count (fixes needed) and
      // total occurrences (how many times the issue fired)
      const convLabel = CONVERSATIONAL_LABELS[f.ruleId];
      let conversationalTitle = "";
      if (convLabel) {
        const template = uniqueCount === 1 ? convLabel.singular : convLabel.plural;
        conversationalTitle = template
          .replace("{{n}}", String(uniqueCount))
          .replace("{{total}}", String(occurrences))
          .replace("{{s}}", occurrences === 1 ? "" : "s");
      }

      actions.push({
        priority: actions.length + 1,
        severity: f.severity,
        theme: group.label,
        themeId: group.themeId,
        ruleId: f.ruleId,
        title: fix?.summary || f.message,
        description: f.detail,
        steps: fix?.steps || [],
        snippet: fix?.snippet || null,
        docs: f.docs,
        occurrences,
        // Conversational data for rich rendering
        conversationalTitle: conversationalTitle || fix?.summary || f.message,
        specificItems,
        // Risk classification
        risk: riskMeta.risk,
        effort: riskMeta.effort,
        tier: riskMeta.tier,
        rationale: riskMeta.rationale,
      });
    }

    if (actions.length >= maxItems) break;
  }

  return actions;
}


/**
 * Bucket action items by risk level for the UI.
 * Returns { safe: [...], low: [...], medium: [...], high: [...] }
 */
function bucketByRisk(actionItems) {
  const buckets = {
    safe:   { label: "Quick Wins — No Risk",     description: "We found data that's currently being lost. These fixes have zero impact on your existing reports — you'll only start capturing data you're currently missing.", actions: [] },
    low:    { label: "Low Risk — Add Missing Data", description: "These items add missing parameters or configuration. Your existing tracking stays exactly the same — you're just filling in gaps.", actions: [] },
    medium: { label: "Medium Risk — Changes Active Tracking", description: "These modify events or parameters that are currently being captured. You'll see a data discontinuity in reports. Test in GTM preview first.", actions: [] },
    high:   { label: "High Risk — Structural Changes",  description: "Major changes that affect multiple tags, triggers, or compliance. Requires careful planning and GTM/GA4 access.", actions: [] },
  };

  for (const action of actionItems) {
    const risk = action.risk || "medium";
    if (buckets[risk]) {
      buckets[risk].actions.push(action);
    } else {
      buckets.medium.actions.push(action);
    }
  }

  return buckets;
}


// ──────────────────────────────────────────────
// Session insights (cross-event analysis)
// ──────────────────────────────────────────────

function deriveInsights(events, network, findings) {
  const insights = [];

  // 1. Event volume check
  if (events.length === 0 && network.length === 0) {
    insights.push({
      type: "no-data",
      title: "No analytics events detected",
      detail: "data fairy didn't capture any dataLayer pushes or GA4 network hits. Check that the site has GA4 or GTM installed.",
    });
    return insights;
  }

  // 2. Check for GA4 measurement ID
  const configs = events.filter(e => e.type === "config");
  const measurementIds = configs
    .map(e => e.measurementId)
    .filter(Boolean);
  if (measurementIds.length > 0) {
    insights.push({
      type: "measurement-ids",
      title: `GA4 Property: ${[...new Set(measurementIds)].join(", ")}`,
      detail: `Found ${new Set(measurementIds).size} measurement ID${new Set(measurementIds).size > 1 ? "s" : ""}.`,
    });
  }

  // 3. Event variety — count distinct custom event names and show totals
  const allEventNames = events
    .map(e => e.eventName || e.payload?.event)
    .filter(Boolean);
  const customNames = allEventNames.filter(n => !n.startsWith("gtm."));
  const gtmNames = allEventNames.filter(n => n.startsWith("gtm."));

  // Build a frequency map for custom events: { "page_view": 12, "purchase": 3, ... }
  const nameFrequency = {};
  for (const n of customNames) {
    nameFrequency[n] = (nameFrequency[n] || 0) + 1;
  }
  const distinctNames = Object.keys(nameFrequency);
  const eventNames = new Set(distinctNames);

  if (distinctNames.length > 0) {
    // Build a readable detail string: "page_view (×12), purchase (×3), scroll (×1)"
    const sorted = Object.entries(nameFrequency).sort((a, b) => b[1] - a[1]);
    const detailParts = sorted.slice(0, 12).map(([name, count]) =>
      count > 1 ? `${name} (×${count})` : name
    );
    const detailStr = detailParts.join(", ") + (sorted.length > 12 ? `, +${sorted.length - 12} more` : "");

    insights.push({
      type: "event-variety",
      title: `${allEventNames.length} events captured across ${distinctNames.length} custom event type${distinctNames.length !== 1 ? "s" : ""}`,
      detail: detailStr + (gtmNames.length > 0 ? ` (plus ${gtmNames.length} internal GTM events)` : ""),
    });
  } else if (gtmNames.length > 0) {
    insights.push({
      type: "event-variety",
      title: `${gtmNames.length} internal GTM events captured, but no custom events`,
      detail: "Only GTM lifecycle events (gtm.js, gtm.load, etc.) were detected. Custom events like page_view or purchase were not found.",
    });
  }

  // 4. Ecommerce detection
  const ecomEvents = new Set([
    "view_item", "add_to_cart", "begin_checkout", "purchase",
    "view_item_list", "select_item", "remove_from_cart",
  ]);
  const foundEcom = [...eventNames].filter(n => ecomEvents.has(n));
  if (foundEcom.length > 0) {
    insights.push({
      type: "ecommerce",
      title: "Ecommerce tracking detected",
      detail: `Found: ${foundEcom.join(", ")}`,
    });
  } else if (network.length > 0) {
    // Check network hits for ecom event names
    const networkEcom = network.filter(n => ecomEvents.has(n.eventName));
    if (networkEcom.length > 0) {
      insights.push({
        type: "ecommerce",
        title: "Ecommerce tracking detected (via network)",
        detail: `Found ecommerce hits in GA4 collect calls.`,
      });
    }
  }

  // 5. Error ratio — count how many events had at least one error, not total findings
  const totalEvents = events.length + network.length;
  const errorFindings = findings.filter(f => f.severity === "error");
  // Use eventIndex (set by lintSession) to count distinct events with errors
  const eventsWithErrors = new Set(errorFindings.map(f => f.eventIndex).filter(idx => idx !== undefined));
  const affectedCount = eventsWithErrors.size;

  if (totalEvents > 0 && affectedCount > 0) {
    const ratio = Math.min(100, ((affectedCount / totalEvents) * 100)).toFixed(1);
    const findingCount = errorFindings.length;
    insights.push({
      type: "error-ratio",
      title: `${ratio}% of events have errors (${affectedCount} of ${totalEvents})`,
      detail: `${affectedCount} event${affectedCount !== 1 ? "s" : ""} triggered ${findingCount} error${findingCount !== 1 ? "s" : ""} total.`,
    });
  }

  // 6. No errors at all — great!
  if (findings.length === 0 && totalEvents > 5) {
    insights.push({
      type: "clean",
      title: "No issues found — looking clean!",
      detail: "data fairy checked all events against GA4 best practices and found no issues.",
    });
  }

  return insights;
}


// ──────────────────────────────────────────────
// Crawl-specific analysis
// ──────────────────────────────────────────────

function analyzeCrawl(crawlReport) {
  if (!crawlReport || !crawlReport.pages) return null;

  const pages = crawlReport.pages;
  const totalPages = pages.length;
  const pagesWithEvents = pages.filter(p => p.events?.length > 0);
  const pagesWithoutEvents = pages.filter(p => !p.events || p.events.length === 0);

  // Collect all events from all pages for cross-page lint
  const allEvents = [];
  for (const page of pages) {
    if (page.events) {
      for (const evt of page.events) {
        evt._pageUrl = page.url;
        allEvents.push(evt);
      }
    }
  }

  // Collect network hits from pages for version detection
  const allNetworkHits = [];
  for (const page of pages) {
    if (page.networkHits) {
      allNetworkHits.push(...page.networkHits);
    }
  }

  // Run lintSession on all events (if FairyLint is available)
  let allFindings = [];
  let crawlGA4Version = null;
  if (typeof window !== "undefined" && window.FairyLint) {
    const result = window.FairyLint.lintSession(allEvents, { networkHits: allNetworkHits });
    allFindings = result.findings;
    crawlGA4Version = result.ga4Version || null;
  }

  // Page-specific issues
  const pageIssues = [];
  if (pagesWithoutEvents.length > 0) {
    pageIssues.push({
      severity: "warning",
      title: `${pagesWithoutEvents.length} page${pagesWithoutEvents.length !== 1 ? "s" : ""} with no analytics events`,
      pages: pagesWithoutEvents.map(p => p.url),
      suggestion: "These pages have no dataLayer pushes or GA4 events. Check if the GTM/gtag snippet is present and loading correctly.",
    });
  }

  // Check for inconsistent event naming across pages
  const eventNamesByPage = {};
  for (const page of pages) {
    if (!page.events) continue;
    for (const evt of page.events) {
      const name = evt.eventName || evt.payload?.event;
      if (name && !name.startsWith("gtm.")) {
        if (!eventNamesByPage[name]) eventNamesByPage[name] = new Set();
        eventNamesByPage[name].add(page.url);
      }
    }
  }

  // Events that only appear on one page might be page-specific (fine) or misconfigured
  const rareEvents = Object.entries(eventNamesByPage)
    .filter(([, urls]) => urls.size === 1 && totalPages > 3);

  if (rareEvents.length > 0) {
    pageIssues.push({
      severity: "info",
      title: `${rareEvents.length} event${rareEvents.length !== 1 ? "s" : ""} only fire on a single page`,
      detail: rareEvents.slice(0, 5).map(([name]) => name).join(", "),
      suggestion: "These events were only seen on one page. This might be expected (e.g., 'purchase' on checkout) or could indicate a tracking gap.",
    });
  }

  return {
    totalPages,
    pagesWithEvents: pagesWithEvents.length,
    pagesWithoutEvents: pagesWithoutEvents.length,
    totalEvents: allEvents.length,
    allFindings,
    pageIssues,
    eventNamesByPage,
    ga4Version: crawlGA4Version,
  };
}


// ──────────────────────────────────────────────
// Main analysis function
// ──────────────────────────────────────────────

/**
 * Analyze a recording or crawl session and produce an actionable report.
 *
 * @param {Object} params
 * @param {Array} params.events - DataLayer/gtag events from the recorder
 * @param {Array} params.network - Network hits from the recorder
 * @param {Array} params.findings - Lint findings from the recorder
 * @param {Object|null} params.crawlReport - Crawl report (if from scanner)
 * @param {string} params.mode - "ga4" or "gtm"
 * @returns {Object} The analysis report
 */
export function analyzeSession({ events = [], network = [], findings = [], crawlReport = null, mode = "ga4", ga4VersionOverride = "auto" }) {
  // Detect GA4 version from events + network hits
  let ga4Version = null;
  if (typeof window !== "undefined" && window.FairyLint) {
    ga4Version = window.FairyLint.detectGA4Version(events, network);
    // Allow user override
    if (ga4VersionOverride && ga4VersionOverride !== "auto") {
      ga4Version = { version: ga4VersionOverride, hints: ["user override"] };
    }
  }

  // Filter findings by mode
  const modeFindings = mode === "gtm"
    ? findings.filter(f => f.category === "gtm")
    : findings.filter(f => f.category !== "gtm");

  // Crawl analysis (computed early so we can use it for health + summary
  // in crawl-only sessions where the recorder never ran)
  const crawlAnalysis = crawlReport ? analyzeCrawl(crawlReport) : null;

  // For crawl-only sessions (recorder idle, all data from scanner), derive the
  // "effective" findings and event count so the scorecard reflects reality.
  const hasRecorderData = events.length + network.length > 0;
  const crawlModeFindings = crawlAnalysis
    ? (mode === "gtm"
        ? crawlAnalysis.allFindings.filter(f => f.category === "gtm")
        : crawlAnalysis.allFindings.filter(f => f.category !== "gtm"))
    : [];
  const effectiveFindings  = hasRecorderData ? modeFindings : crawlModeFindings;
  const effectiveTotalEvents = hasRecorderData
    ? events.length + network.length
    : (crawlAnalysis?.totalEvents || 0);

  // Health score (uses effective data so crawl-only sessions show a real score
  // instead of "No Data")
  const health = hasRecorderData
    ? calculateHealthScore(events, network, modeFindings)
    : calculateHealthScore(Array.from({ length: effectiveTotalEvents }), [], effectiveFindings);

  // Group into themes
  const themedGroups = groupByTheme(modeFindings);

  // Generate prioritized action items
  const actionItems = generateActionItems(themedGroups);

  // Session-level insights
  const insights = deriveInsights(events, network, modeFindings);

  // Merge crawl findings into action items if present
  let finalActions = actionItems;
  if (crawlAnalysis && crawlAnalysis.allFindings.length > 0) {
    const crawlGroups = groupByTheme(crawlModeFindings);
    const crawlActions = generateActionItems(crawlGroups);

    // Merge, deduplicating by ruleId
    const existingRuleIds = new Set(finalActions.map(a => a.ruleId));
    for (const ca of crawlActions) {
      if (!existingRuleIds.has(ca.ruleId)) {
        finalActions.push({ ...ca, priority: finalActions.length + 1 });
        existingRuleIds.add(ca.ruleId);
      }
    }
  }

  // Bucket by risk level
  const riskBuckets = bucketByRisk(finalActions);

  // Count free vs pro actions
  const freeActions = finalActions.filter(a => a.tier === "free").length;
  const proActions = finalActions.filter(a => a.tier === "pro").length;

  return {
    health,
    mode,
    themedGroups,
    actionItems: finalActions,
    riskBuckets,
    insights,
    crawlAnalysis,
    totalFindings: effectiveFindings.length,
    summary: {
      totalEvents: effectiveTotalEvents,
      eventsWithErrors: new Set(
        effectiveFindings.filter(f => f.severity === "error")
          .map(f => f.eventIndex)
          .filter(idx => idx !== undefined)
      ).size,
      errors: effectiveFindings.filter(f => f.severity === "error").length,
      warnings: effectiveFindings.filter(f => f.severity === "warning").length,
    },
    tierBreakdown: { free: freeActions, pro: proActions },
    ga4Version: ga4Version || crawlAnalysis?.ga4Version || { version: "free", hints: [] },
    generatedAt: new Date().toISOString(),
  };
}
