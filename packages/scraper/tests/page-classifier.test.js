import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyByUrl, classifyPage, inferSiteType } from "../src/page-classifier.js";

describe("classifyByUrl", () => {
  it("detects homepage", () => {
    assert.equal(classifyByUrl("https://example.com/").type, "homepage");
    assert.equal(classifyByUrl("https://example.com").type, "homepage");
    assert.equal(classifyByUrl("https://example.com/index.html").type, "homepage");
  });

  it("detects product pages", () => {
    assert.equal(classifyByUrl("https://shop.com/products/blue-widget").type, "product-detail");
    assert.equal(classifyByUrl("https://shop.com/product/12345").type, "product-detail");
    assert.equal(classifyByUrl("https://shop.com/p/sku-abc").type, "product-detail");
  });

  it("detects category pages", () => {
    assert.equal(classifyByUrl("https://shop.com/collections/summer").type, "category");
    assert.equal(classifyByUrl("https://shop.com/category/electronics").type, "category");
    assert.equal(classifyByUrl("https://shop.com/shop").type, "category");
  });

  it("detects cart and checkout", () => {
    assert.equal(classifyByUrl("https://shop.com/cart").type, "cart");
    assert.equal(classifyByUrl("https://shop.com/checkout").type, "checkout");
    assert.equal(classifyByUrl("https://shop.com/checkout/shipping").type, "checkout");
  });

  it("detects blog posts", () => {
    assert.equal(classifyByUrl("https://blog.com/blog/my-post").type, "blog-post");
    assert.equal(classifyByUrl("https://news.com/articles/breaking-news").type, "blog-post");
    assert.equal(classifyByUrl("https://site.com/2024/03/some-article").type, "blog-post");
  });

  it("detects blog index", () => {
    assert.equal(classifyByUrl("https://site.com/blog").type, "blog-index");
    assert.equal(classifyByUrl("https://site.com/blog/").type, "blog-index");
    assert.equal(classifyByUrl("https://site.com/news").type, "blog-index");
  });

  it("detects informational pages", () => {
    assert.equal(classifyByUrl("https://site.com/about").type, "about");
    assert.equal(classifyByUrl("https://site.com/contact").type, "contact");
    assert.equal(classifyByUrl("https://site.com/pricing").type, "pricing");
  });

  it("detects search results", () => {
    assert.equal(classifyByUrl("https://site.com/search?q=test").type, "search-results");
  });

  it("returns 'other' for unrecognized pages", () => {
    assert.equal(classifyByUrl("https://site.com/some-random-page").type, "other");
  });

  it("detects lead-gen URL patterns", () => {
    assert.equal(classifyByUrl("https://site.com/apply").type, "lead-gen-form");
    assert.equal(classifyByUrl("https://site.com/get-quote").type, "lead-gen-form");
    assert.equal(classifyByUrl("https://site.com/rates").type, "lead-gen-form");
    assert.equal(classifyByUrl("https://site.com/calculator").type, "lead-gen-form");
    assert.equal(classifyByUrl("https://site.com/compare").type, "lead-gen-form");
    assert.equal(classifyByUrl("https://site.com/pre-qualify").type, "lead-gen-form");
    assert.equal(classifyByUrl("https://site.com/get-started").type, "lead-gen-form");
  });
});

describe("classifyPage (with DOM signals)", () => {
  it("upgrades classification with product schema", () => {
    const result = classifyPage("https://site.com/some-page", {
      hasProductSchema: true,
      hasPrice: true,
      hasAddToCart: true,
      jsonLdTypes: ["Product"],
    });
    assert.equal(result.type, "product-detail");
    assert.equal(result.siteCategory, "ecommerce");
    assert.ok(result.confidence >= 0.85);
  });

  it("upgrades classification with article schema", () => {
    const result = classifyPage("https://site.com/some-page", {
      hasArticleSchema: true,
      hasBlogMeta: true,
      ogType: "article",
      jsonLdTypes: ["Article"],
    });
    assert.equal(result.type, "blog-post");
    assert.equal(result.siteCategory, "content");
  });

  it("detects contact/lead-gen from form", () => {
    const result = classifyPage("https://site.com/some-page", {
      hasContactForm: true,
      jsonLdTypes: [],
    });
    assert.equal(result.type, "contact");
    assert.equal(result.siteCategory, "lead-gen");
  });

  it("detects lead-gen form from DOM signals", () => {
    const result = classifyPage("https://site.com/some-page", {
      hasLeadGenForm: true,
      jsonLdTypes: [],
      pageKeywords: ["loan", "mortgage"],
    });
    assert.equal(result.type, "lead-gen-form");
    assert.equal(result.siteCategory, "lead-gen");
    assert.ok(result.confidence >= 0.8);
  });

  it("detects lead-gen from financial keywords alone", () => {
    const result = classifyPage("https://site.com/some-page", {
      jsonLdTypes: [],
      pageKeywords: ["loan", "rate", "mortgage"],
    });
    assert.equal(result.siteCategory, "lead-gen");
  });

  it("does not override ecommerce with lead-gen", () => {
    const result = classifyPage("https://shop.com/products/widget", {
      hasProductSchema: true,
      hasPrice: true,
      hasAddToCart: true,
      hasLeadGenForm: false,
      jsonLdTypes: ["Product"],
      pageKeywords: [],
    });
    assert.equal(result.type, "product-detail");
    assert.equal(result.siteCategory, "ecommerce");
  });
});

describe("inferSiteType", () => {
  it("identifies ecommerce from product pages", () => {
    const pages = [
      { type: "homepage", siteCategory: "other" },
      { type: "product-detail", siteCategory: "ecommerce" },
      { type: "product-detail", siteCategory: "ecommerce" },
      { type: "cart", siteCategory: "ecommerce" },
    ];
    assert.equal(inferSiteType(pages), "ecommerce");
  });

  it("identifies blog from blog posts", () => {
    const pages = [
      { type: "homepage", siteCategory: "other" },
      { type: "blog-post", siteCategory: "content" },
      { type: "blog-post", siteCategory: "content" },
      { type: "about", siteCategory: "other" },
    ];
    assert.equal(inferSiteType(pages), "blog");
  });

  it("identifies SaaS from pricing page", () => {
    const pages = [
      { type: "homepage", siteCategory: "other" },
      { type: "pricing", siteCategory: "other" },
      { type: "about", siteCategory: "other" },
    ];
    assert.equal(inferSiteType(pages), "saas");
  });

  it("identifies lead-gen from contact forms", () => {
    const pages = [
      { type: "homepage", siteCategory: "other" },
      { type: "contact", siteCategory: "lead-gen" },
      { type: "landing", siteCategory: "lead-gen" },
    ];
    assert.equal(inferSiteType(pages), "lead-gen");
  });

  it("identifies lead-gen from lead-gen-form pages", () => {
    const pages = [
      { type: "homepage", siteCategory: "other" },
      { type: "lead-gen-form", siteCategory: "lead-gen" },
      { type: "other", siteCategory: "other" },
      { type: "blog-post", siteCategory: "content" },
    ];
    assert.equal(inferSiteType(pages), "lead-gen");
  });

  it("identifies lead-gen even with just one lead-gen-form page", () => {
    const pages = [
      { type: "homepage", siteCategory: "other" },
      { type: "lead-gen-form", siteCategory: "lead-gen" },
      { type: "about", siteCategory: "other" },
    ];
    assert.equal(inferSiteType(pages), "lead-gen");
  });
});
