/**
 * page-classifier.js — Classify page type from URL patterns + DOM signals.
 *
 * Helps the recon phase understand what a website does (e-commerce, blog,
 * SaaS, lead-gen) and helps the deep crawl prioritize diverse page types.
 *
 * Returns a page type + confidence score (0–1). Higher confidence means
 * more signal was found to support the classification.
 */

// ──────────────────────────────────────────────
// URL pattern matchers
// ──────────────────────────────────────────────

const URL_PATTERNS = [
  // E-commerce
  { type: "product-detail",   patterns: [/\/products?\/[^/]+$/i, /\/item\/[^/]+$/i, /\/p\/[^/]+$/i, /\/dp\/[A-Z0-9]+/i, /\/shop\/[^/]+\/[^/]+$/i] },
  { type: "category",         patterns: [/\/collections?\//i, /\/categor(y|ies)\//i, /\/shop\/?$/i, /\/store\/?$/i, /\/department\//i] },
  { type: "cart",             patterns: [/\/cart\/?$/i, /\/basket\/?$/i, /\/bag\/?$/i] },
  { type: "checkout",         patterns: [/\/checkout/i, /\/order\//i, /\/payment\//i] },

  // Content
  { type: "blog-post",        patterns: [/\/blog\/[^/]+$/i, /\/posts?\/[^/]+$/i, /\/articles?\/[^/]+$/i, /\/news\/[^/]+$/i, /\/\d{4}\/\d{2}\/[^/]+$/i] },
  { type: "blog-index",       patterns: [/\/blog\/?$/i, /\/news\/?$/i, /\/articles?\/?$/i, /\/posts?\/?$/i] },

  // Informational
  { type: "about",            patterns: [/\/about/i, /\/company/i, /\/team/i, /\/our-story/i] },
  { type: "contact",          patterns: [/\/contact/i, /\/support/i, /\/help\/?$/i, /\/get-in-touch/i] },
  { type: "landing",          patterns: [/\/lp\//i, /\/landing/i, /\/promo/i, /\/campaign/i, /\/offer\//i] },
  { type: "pricing",          patterns: [/\/pricing/i, /\/plans/i, /\/packages/i] },

  // Lead-gen / Fintech
  { type: "lead-gen-form",    patterns: [/\/apply/i, /\/quote/i, /\/get-?quote/i, /\/rates?\b/i, /\/get-?rates?/i, /\/get-?started/i, /\/pre-?qualif/i, /\/calculator/i, /\/compare/i, /\/estimate/i, /\/request-?info/i] },

  // Utility
  { type: "search-results",   patterns: [/\/search/i, /[?&]q=/i, /[?&]query=/i, /[?&]s=/i] },
  { type: "account",          patterns: [/\/account/i, /\/my-/i, /\/dashboard/i, /\/login/i, /\/register/i, /\/sign-?in/i, /\/sign-?up/i] },
];

/**
 * Classify page type from URL alone (fast, no DOM needed).
 *
 * @param {string} url - Full URL
 * @returns {{ type: string, confidence: number }}
 */
export function classifyByUrl(url) {
  let pathname;
  try {
    const parsed = new URL(url);
    pathname = parsed.pathname + parsed.search;
  } catch {
    return { type: "other", confidence: 0 };
  }

  // Homepage detection
  if (pathname === "/" || pathname === "" || pathname === "/index.html" || pathname === "/home") {
    return { type: "homepage", confidence: 0.9 };
  }

  for (const { type, patterns } of URL_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(pathname)) {
        return { type, confidence: 0.6 };
      }
    }
  }

  return { type: "other", confidence: 0.2 };
}

/**
 * Classify page type from DOM signals (run inside Puppeteer page.evaluate).
 * This runs in the browser context.
 *
 * @returns {Object} DOM classification signals
 */
export function domClassifierScript() {
  // This function is serialized and injected into the page
  return () => {
    const signals = {
      jsonLdTypes: [],
      ogType: null,
      hasProductSchema: false,
      hasArticleSchema: false,
      hasPrice: false,
      hasAddToCart: false,
      hasCheckoutForm: false,
      hasContactForm: false,
      hasLeadGenForm: false,
      hasSearchForm: false,
      hasVideoEmbed: false,
      hasBlogMeta: false,
      metaDescription: null,
      pageKeywords: [],
    };

    // JSON-LD structured data
    try {
      const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of jsonLdScripts) {
        try {
          const data = JSON.parse(script.textContent);
          const types = Array.isArray(data) ? data.map(d => d["@type"]) : [data["@type"]];
          signals.jsonLdTypes.push(...types.filter(Boolean));

          if (types.includes("Product")) signals.hasProductSchema = true;
          if (types.includes("Article") || types.includes("BlogPosting") || types.includes("NewsArticle")) {
            signals.hasArticleSchema = true;
          }
        } catch {}
      }
    } catch {}

    // Open Graph type
    const ogMeta = document.querySelector('meta[property="og:type"]');
    if (ogMeta) signals.ogType = ogMeta.content;

    // Price indicators
    signals.hasPrice = !!(
      document.querySelector('[class*="price"]') ||
      document.querySelector('[data-price]') ||
      document.querySelector('[itemprop="price"]') ||
      document.querySelector('.product-price, .price-tag, .sale-price')
    );

    // Add to cart
    signals.hasAddToCart = !!(
      document.querySelector('[class*="add-to-cart"], [class*="addtocart"], [class*="add_to_cart"]') ||
      document.querySelector('button[name*="cart"], button[data-action*="cart"]') ||
      document.querySelector('form[action*="cart"]')
    );

    // Checkout form
    signals.hasCheckoutForm = !!(
      document.querySelector('form[action*="checkout"]') ||
      document.querySelector('[class*="checkout-form"]') ||
      document.querySelector('input[name*="card_number"], input[name*="cc-number"]')
    );

    // Contact form
    signals.hasContactForm = !!(
      document.querySelector('form[action*="contact"]') ||
      document.querySelector('form[class*="contact"]') ||
      (document.querySelector('form') &&
       document.querySelector('input[type="email"]') &&
       document.querySelector('textarea'))
    );

    // Lead-gen form (broader than contact: financial forms, quote forms, multi-step)
    const forms = document.querySelectorAll('form');
    for (const form of forms) {
      // Multi-step form indicators
      const isMultiStep = !!(
        form.querySelector('[data-step], [data-stage], .wizard, .stepper, .step-indicator') ||
        form.querySelector('[class*="multi-step"], [class*="multistep"]')
      );

      // Financial/comparison select dropdowns
      const selects = form.querySelectorAll('select');
      const hasFinancialSelect = [...selects].some(s => {
        const nameId = (s.name || "") + (s.id || "");
        return /loan|rate|amount|credit|term|insurance|mortgage|type|coverage|income|debt/i.test(nameId);
      });

      // Lead-gen CTA buttons
      const buttons = form.querySelectorAll('button, input[type="submit"], a[role="button"]');
      const hasLeadGenCta = [...buttons].some(b => {
        const text = (b.textContent || b.value || "").toLowerCase();
        return /apply|get quote|compare|get rate|get started|check rate|get approved|see offer|find rate|pre-?qualif|calculate|estimate|see result/i.test(text);
      });

      // Range sliders (loan amount, term selectors)
      const hasRangeInputs = form.querySelectorAll('input[type="range"]').length >= 1;

      if (isMultiStep || hasFinancialSelect || hasLeadGenCta || hasRangeInputs) {
        signals.hasLeadGenForm = true;
        break;
      }
    }

    // Also check for lead-gen CTAs outside forms (common on landing pages)
    if (!signals.hasLeadGenForm) {
      const allButtons = document.querySelectorAll('a, button');
      let ctaCount = 0;
      for (const el of allButtons) {
        const text = (el.textContent || "").toLowerCase().trim();
        if (/^(apply now|get (?:a )?quote|compare rates?|get started|check (?:my |your )?rate|get (?:pre-?)?approved|see (?:my |your )?rate|request quote)$/i.test(text)) {
          ctaCount++;
        }
      }
      if (ctaCount >= 2) signals.hasLeadGenForm = true;
    }

    // Page keywords: scan title, h1, meta description for industry signals
    const keywordSources = [
      document.title || "",
      (document.querySelector('h1') || {}).textContent || "",
      (document.querySelector('meta[name="description"]') || {}).content || "",
      (document.querySelector('meta[property="og:title"]') || {}).content || "",
    ].join(" ").toLowerCase();

    const INDUSTRY_KEYWORDS = [
      "loan", "mortgage", "credit", "rate", "insurance", "quote",
      "refinance", "approval", "pre-qualify", "comparison", "lender",
      "apr", "interest rate", "apply", "get approved", "compare rates",
      "financial", "debt", "savings", "investment", "banking",
    ];
    signals.pageKeywords = INDUSTRY_KEYWORDS.filter(kw => keywordSources.includes(kw));

    // Search form
    signals.hasSearchForm = !!(
      document.querySelector('form[role="search"]') ||
      document.querySelector('input[type="search"]') ||
      document.querySelector('form[action*="search"]')
    );

    // Video embed
    signals.hasVideoEmbed = !!(
      document.querySelector('iframe[src*="youtube"], iframe[src*="vimeo"]') ||
      document.querySelector('video')
    );

    // Blog signals
    signals.hasBlogMeta = !!(
      document.querySelector('article') ||
      document.querySelector('[class*="blog-post"], [class*="article-content"]') ||
      document.querySelector('time[datetime], [class*="publish-date"]')
    );

    // Meta description
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) signals.metaDescription = metaDesc.content?.slice(0, 200);

    return signals;
  };
}

/**
 * Combine URL classification with DOM signals for a final verdict.
 *
 * @param {string} url
 * @param {Object} domSignals - Output from domClassifierScript()
 * @returns {{ type: string, confidence: number, siteCategory: string }}
 */
export function classifyPage(url, domSignals = null) {
  const urlResult = classifyByUrl(url);

  if (!domSignals) return { ...urlResult, siteCategory: "unknown" };

  let type = urlResult.type;
  let confidence = urlResult.confidence;
  let siteCategory = "other";

  // Boost confidence or reclassify based on DOM signals
  if (domSignals.hasProductSchema || (domSignals.hasPrice && domSignals.hasAddToCart)) {
    if (type === "other") type = "product-detail";
    confidence = Math.max(confidence, 0.85);
    siteCategory = "ecommerce";
  }

  if (domSignals.hasArticleSchema || (domSignals.hasBlogMeta && domSignals.ogType === "article")) {
    if (type === "other") type = "blog-post";
    confidence = Math.max(confidence, 0.8);
    if (siteCategory === "other") siteCategory = "content";
  }

  if (domSignals.hasCheckoutForm) {
    if (type === "other") type = "checkout";
    confidence = Math.max(confidence, 0.9);
    siteCategory = "ecommerce";
  }

  if (domSignals.hasContactForm && type === "other") {
    type = "contact";
    confidence = Math.max(confidence, 0.7);
    if (siteCategory === "other") siteCategory = "lead-gen";
  }

  // Lead-gen form detection (financial forms, multi-step wizards, quote tools)
  if (domSignals.hasLeadGenForm && type !== "checkout" && type !== "product-detail") {
    if (type === "other" || type === "homepage") type = "lead-gen-form";
    confidence = Math.max(confidence, 0.8);
    siteCategory = "lead-gen";
  }

  // Page keywords can upgrade "other" pages to lead-gen
  if ((domSignals.pageKeywords?.length || 0) >= 2 && siteCategory === "other") {
    siteCategory = "lead-gen";
    if (type === "other") {
      type = "lead-gen-form";
      confidence = Math.max(confidence, 0.6);
    }
  }

  // Infer site category from accumulated signals
  if (siteCategory === "other") {
    if (domSignals.hasPrice || domSignals.hasAddToCart) siteCategory = "ecommerce";
    else if (domSignals.hasBlogMeta || domSignals.hasArticleSchema) siteCategory = "content";
    else if (domSignals.hasContactForm || domSignals.hasLeadGenForm) siteCategory = "lead-gen";
    else if ((domSignals.pageKeywords?.length || 0) >= 2) siteCategory = "lead-gen";
  }

  return { type, confidence, siteCategory };
}

/**
 * Infer the overall site type from a collection of classified pages.
 *
 * @param {Array<{ type: string, siteCategory: string }>} classifiedPages
 * @returns {string} "ecommerce" | "saas" | "blog" | "lead-gen" | "portfolio" | "other"
 */
export function inferSiteType(classifiedPages) {
  const categoryCounts = {};
  for (const page of classifiedPages) {
    const cat = page.siteCategory || "other";
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  }

  const typeCounts = {};
  for (const page of classifiedPages) {
    typeCounts[page.type] = (typeCounts[page.type] || 0) + 1;
  }

  // If multiple product pages → definitely ecommerce
  if ((typeCounts["product-detail"] || 0) >= 2) return "ecommerce";
  if (categoryCounts["ecommerce"] > 0) return "ecommerce";

  // If blog posts dominate → content/blog
  if ((typeCounts["blog-post"] || 0) >= 2) return "blog";
  if (categoryCounts["content"] > (categoryCounts["lead-gen"] || 0)) return "blog";

  // If pricing page exists and no products → likely SaaS
  if (typeCounts["pricing"]) return "saas";

  // Lead-gen: explicit forms, contact pages, or landing pages
  if ((typeCounts["lead-gen-form"] || 0) >= 1) return "lead-gen";
  if (categoryCounts["lead-gen"] > 0) return "lead-gen";

  return "other";
}
