/**
 * GA4 event schemas — the canonical source of truth for event names,
 * required parameters, and recommended parameters.
 *
 * Sources:
 *   https://developers.google.com/analytics/devguides/collection/ga4/reference/events
 *   https://support.google.com/analytics/answer/9267735
 *   https://support.google.com/analytics/answer/13316687
 *   https://support.google.com/analytics/answer/9216061
 */

// ──────────────────────────────────────────────
// Reserved event names — CANNOT be used as custom event names.
// Sending these as custom events will silently corrupt data.
// ──────────────────────────────────────────────
const RESERVED_EVENT_NAMES = new Set([
  "ad_activeview",
  "ad_click",
  "ad_exposure",
  "ad_impression",
  "ad_query",
  "adunit_exposure",
  "app_clear_data",
  "app_exception",
  "app_install",
  "app_remove",
  "app_store_refund",
  "app_store_subscription_cancel",
  "app_store_subscription_convert",
  "app_store_subscription_renew",
  "app_update",
  "app_upgrade",
  "dynamic_link_app_open",
  "dynamic_link_app_update",
  "dynamic_link_first_open",
  "error",
  "firebase_campaign",
  "firebase_in_app_message_action",
  "firebase_in_app_message_dismiss",
  "firebase_in_app_message_impression",
  "first_open",
  "first_visit",
  "in_app_purchase",
  "notification_dismiss",
  "notification_foreground",
  "notification_open",
  "notification_receive",
  "notification_send",
  "os_update",
  "screen_view",
  "session_start",
  "user_engagement",
]);

// ──────────────────────────────────────────────
// Automatically collected events — GA4 fires these itself.
// Sending duplicates will double-count.
// ──────────────────────────────────────────────
const AUTO_COLLECTED_EVENTS = new Set([
  "first_visit",
  "session_start",
  "user_engagement",
  "page_view",        // when enhanced measurement is on
]);

// ──────────────────────────────────────────────
// Enhanced measurement events — auto-tracked when enabled.
// Sending custom events with these names = double counting.
// ──────────────────────────────────────────────
const ENHANCED_MEASUREMENT_EVENTS = new Set([
  "page_view",
  "scroll",
  "click",             // outbound clicks
  "view_search_results",
  "video_start",
  "video_progress",
  "video_complete",
  "file_download",
  "form_start",
  "form_submit",
]);

// ──────────────────────────────────────────────
// Reserved parameter name prefixes — parameters starting with
// these will be silently dropped or cause errors.
// ──────────────────────────────────────────────
const RESERVED_PARAM_PREFIXES = ["google_", "firebase_", "ga_"];

// ──────────────────────────────────────────────
// Reserved parameter names — cannot be used as custom params
// ──────────────────────────────────────────────
const RESERVED_PARAM_NAMES = new Set([
  "firebase_conversion",
]);

// ──────────────────────────────────────────────
// Recommended ecommerce events and their schemas.
// "required" = data is meaningless without it
// "recommended" = strongly suggested for full reporting
// ──────────────────────────────────────────────
const ECOMMERCE_EVENTS = {
  view_item_list: {
    params: {
      item_list_id: "recommended",
      item_list_name: "recommended",
      items: "required",
    },
    itemParams: {
      item_id: "required_or",    // item_id OR item_name required
      item_name: "required_or",
    }
  },
  select_item: {
    params: {
      item_list_id: "recommended",
      item_list_name: "recommended",
      items: "required",
    },
    itemParams: {
      item_id: "required_or",
      item_name: "required_or",
    }
  },
  view_item: {
    params: {
      currency: "recommended",
      value: "recommended",
      items: "required",
    },
    itemParams: {
      item_id: "required_or",
      item_name: "required_or",
    }
  },
  add_to_cart: {
    params: {
      currency: "recommended",
      value: "recommended",
      items: "required",
    },
    itemParams: {
      item_id: "required_or",
      item_name: "required_or",
      quantity: "recommended",
    }
  },
  remove_from_cart: {
    params: {
      currency: "recommended",
      value: "recommended",
      items: "required",
    },
    itemParams: {
      item_id: "required_or",
      item_name: "required_or",
    }
  },
  view_cart: {
    params: {
      currency: "recommended",
      value: "recommended",
      items: "required",
    },
    itemParams: {
      item_id: "required_or",
      item_name: "required_or",
    }
  },
  begin_checkout: {
    params: {
      currency: "recommended",
      value: "recommended",
      coupon: "recommended",
      items: "required",
    },
    itemParams: {
      item_id: "required_or",
      item_name: "required_or",
    }
  },
  add_shipping_info: {
    params: {
      currency: "recommended",
      value: "recommended",
      shipping_tier: "recommended",
      items: "required",
    },
    itemParams: {
      item_id: "required_or",
      item_name: "required_or",
    }
  },
  add_payment_info: {
    params: {
      currency: "recommended",
      value: "recommended",
      payment_type: "recommended",
      items: "required",
    },
    itemParams: {
      item_id: "required_or",
      item_name: "required_or",
    }
  },
  purchase: {
    params: {
      transaction_id: "required",
      currency: "required",
      value: "required",
      coupon: "recommended",
      shipping: "recommended",
      tax: "recommended",
      items: "required",
    },
    itemParams: {
      item_id: "required_or",
      item_name: "required_or",
      quantity: "recommended",
      price: "recommended",
    }
  },
  refund: {
    params: {
      transaction_id: "required",
      currency: "recommended",
      value: "recommended",
      items: "recommended",    // required for partial refunds
    },
    itemParams: {
      item_id: "required",
      quantity: "required",
    }
  },
};

// ──────────────────────────────────────────────
// Other recommended (non-ecommerce) events
// ──────────────────────────────────────────────
const RECOMMENDED_EVENTS = {
  login: { params: { method: "recommended" } },
  sign_up: { params: { method: "recommended" } },
  search: { params: { search_term: "required" } },
  share: { params: { method: "recommended", content_type: "recommended", item_id: "recommended" } },
  select_content: { params: { content_type: "recommended", item_id: "recommended" } },
  generate_lead: { params: { currency: "recommended", value: "recommended" } },
  earn_virtual_currency: { params: { virtual_currency_name: "recommended", value: "recommended" } },
  spend_virtual_currency: { params: { item_name: "recommended", virtual_currency_name: "recommended", value: "recommended" } },
  join_group: { params: { group_id: "recommended" } },
  tutorial_begin: { params: {} },
  tutorial_complete: { params: {} },
  level_start: { params: { level_name: "recommended" } },
  level_end: { params: { level_name: "recommended", success: "recommended" } },
  level_up: { params: { level: "recommended", character: "recommended" } },
  post_score: { params: { score: "required", level: "recommended", character: "recommended" } },
  unlock_achievement: { params: { achievement_id: "required" } },
};

// ──────────────────────────────────────────────
// Valid ISO 4217 currency codes (common subset)
// ──────────────────────────────────────────────
const VALID_CURRENCY_CODES = new Set([
  "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "CNY", "SEK", "NZD",
  "MXN", "SGD", "HKD", "NOK", "KRW", "TRY", "RUB", "INR", "BRL", "ZAR",
  "DKK", "PLN", "TWD", "THB", "IDR", "HUF", "CZK", "ILS", "CLP", "PHP",
  "AED", "COP", "SAR", "MYR", "RON", "ARS", "BGN", "HRK", "PEN", "PKR",
  "EGP", "NGN", "UAH", "VND", "BDT", "QAR", "KWD", "OMR", "BHD", "JOD",
]);

// ──────────────────────────────────────────────
// Collection limits
// ──────────────────────────────────────────────
const LIMITS = {
  eventNameMaxLength: 40,
  paramNameMaxLength: 40,
  paramValueMaxLength: 100,          // 500 for GA4 360
  paramValueMaxLength360: 500,
  maxParamsPerEvent: 25,
  maxItemParamsPerItem: 27,
  maxItemsPerEvent: 200,
  maxDistinctEventsWeb: 500,         // not enforced yet, but documented
  maxDistinctEventsApp: 500,
  maxCustomDimensions: 50,
  maxCustomMetrics: 50,
  userPropertyNameMaxLength: 24,
  userPropertyValueMaxLength: 36,
  maxUserProperties: 25,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    RESERVED_EVENT_NAMES,
    AUTO_COLLECTED_EVENTS,
    ENHANCED_MEASUREMENT_EVENTS,
    RESERVED_PARAM_PREFIXES,
    RESERVED_PARAM_NAMES,
    ECOMMERCE_EVENTS,
    RECOMMENDED_EVENTS,
    VALID_CURRENCY_CODES,
    LIMITS,
  };
}
