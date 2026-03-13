/**
 * Background service worker for Ferry.
 *
 * Responsibilities:
 *   1. Opens the side panel when the toolbar icon is clicked
 *   2. Captures GA4/GTM network requests via webRequest and:
 *      a) Buffers them into the current crawl page entry (per-page join)
 *      b) Relays them live to the panel (for the recorder UI)
 *   3. Manages port connections from the side panel
 *   4. Routes crawler commands to the crawler module
 *   5. Forwards content-script events to the panel
 */

// crawler.js is a pre-bundled file that includes ferry-hook.js inlined.
// (The build step in vite.config.js concatenates them to avoid a second
// importScripts() call, which Chrome MV3 doesn't support from within
// scripts that were themselves loaded via importScripts().)
importScripts("crawler.js");

// ── Side Panel: open on toolbar icon click ────────────────────────────────────

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Allow side panel on every page
chrome.sidePanel.setOptions({ enabled: true });

// ── Port Management ───────────────────────────────────────────────────────────
// The side panel connects with name "ferry-panel" and sends FERRY_INIT { tabId }

const connections = new Map(); // tabId → port

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "ferry-panel") return;

  port.onMessage.addListener(function initListener(msg) {
    if (msg.type === "FERRY_INIT" && msg.tabId) {
      connections.set(msg.tabId, port);

      port.onDisconnect.addListener(() => {
        connections.delete(msg.tabId);
        if (globalThis.FerryCrawler) {
          globalThis.FerryCrawler.stopCrawl(msg.tabId);
        }
      });

      port.onMessage.removeListener(initListener);
      port.onMessage.addListener((panelMsg) => {
        handlePanelMessage(panelMsg, msg.tabId, port);
      });
    }
  });
});

// ── Panel message handler (crawl commands) ────────────────────────────────────

function handlePanelMessage(msg, tabId, port) {
  if (!globalThis.FerryCrawler) return;

  if (msg.type === "FERRY_CRAWL_START") {
    globalThis.FerryCrawler.startCrawl(tabId, msg.startUrl, msg.maxPages || 50, port);
  }

  if (msg.type === "FERRY_CRAWL_STOP") {
    globalThis.FerryCrawler.stopCrawl(tabId);
    const state = globalThis.FerryCrawler.crawlStates.get(tabId);
    port.postMessage({
      type: "FERRY_CRAWL_COMPLETE",
      pages: state?.pages || [],
      totalVisited: state?.visited?.size || 0,
      totalQueued: 0,
      stopped: true,
    });
  }
}

// ── Network capture via webRequest ────────────────────────────────────────────
// Intercepts GA4 /collect hits, Measurement Protocol, and GTM script loads.
//
// Two consumers per hit:
//   1. Active crawl: buffered into the current page entry so audits get a
//      per-page join of { events (dataLayer), network (/collect hits) }.
//   2. Panel recorder UI: relayed live via the port connection.
//
// This approach replaces chrome.devtools.network.onRequestFinished, which is
// only available inside DevTools panels and unavailable to side panels.

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!details.tabId || details.tabId < 0) return;

    const url = details.url;

    // Classify the hit type
    let hitType = null;

    if (url.includes("/g/collect") || url.includes("/collect?")) {
      hitType = "ga4-collect";
    } else if (url.includes("/mp/collect")) {
      hitType = "measurement-protocol";
    } else if (url.includes("googletagmanager.com/gtm.js")) {
      hitType = "gtm-container";
    } else if (url.includes("googletagmanager.com/gtag/js")) {
      hitType = "gtag-js";
    } else if (url.includes("googleadservices.com/pagead/conversion") ||
               url.includes("google.com/pagead/")) {
      hitType = "google-ads-conversion";
    }

    if (!hitType) return;

    const networkHit = {
      url,
      timestamp: new Date().toISOString(),
      hitType,
    };

    // ── 1. Buffer into current crawl page entry ───────────────────────────────
    // Enables per-page joins of dataLayer events + /collect network hits,
    // which is what an audit needs to validate that events fired AND reached GA4.
    if (globalThis.FerryCrawler) {
      const crawlState = globalThis.FerryCrawler.crawlStates.get(details.tabId);
      if (crawlState?.running && crawlState.pages.length > 0) {
        crawlState.pages[crawlState.pages.length - 1].network.push(networkHit);
      }
    }

    // ── 2. Relay to panel for live recorder view ──────────────────────────────
    const port = connections.get(details.tabId);
    if (port) {
      try {
        port.postMessage({
          type: "FERRY_NETWORK_HIT",
          ...networkHit,
          tabId: details.tabId,
        });
      } catch {}
    }
  },
  { urls: ["<all_urls>"] }
);

// ── Content script event forwarding ──────────────────────────────────────────
// Used by the Record feature — content script relays window.postMessage events.

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "FERRY_EVENT") return;

  const tabId = sender.tab?.id;
  const port = connections.get(tabId);
  if (!port) return;

  port.postMessage(msg);
});
