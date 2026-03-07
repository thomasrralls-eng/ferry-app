/**
 * Background service worker for Ferry.
 *
 * Responsibilities:
 *   1. Opens the side panel when the toolbar icon is clicked
 *   2. Captures GA4/GTM network requests via webRequest and relays to panel
 *   3. Manages port connections from the side panel
 *   4. Routes crawler commands to the crawler module
 *   5. Forwards content-script events to the panel
 */

importScripts("crawler.js");

// ── Side Panel: open on toolbar icon click ──

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Allow side panel on every page
chrome.sidePanel.setOptions({ enabled: true });

// ── Port Management ──
// The side panel connects with name "ferry-panel" and sends FERRY_INIT { tabId }

const connections = new Map(); // tabId -> port

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

// ── Panel message handler (crawl commands) ──

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

// ── Network capture via webRequest ──
// Intercepts GA4 /collect hits and GTM script loads, relays to panel.
// This replaces chrome.devtools.network.onRequestFinished which is
// only available inside DevTools panels.

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!details.tabId || details.tabId < 0) return;

    const port = connections.get(details.tabId);
    if (!port) return;

    const url = details.url;

    // GA4 measurement protocol /collect endpoint
    if (url.includes("/g/collect") || url.includes("/collect?")) {
      try {
        port.postMessage({
          type: "FERRY_NETWORK_HIT",
          url,
          tabId: details.tabId,
          timestamp: new Date().toISOString(),
          hitType: "ga4-collect",
        });
      } catch (e) {}
    }

    // GTM container script load
    if (url.includes("googletagmanager.com/gtm.js") || url.includes("googletagmanager.com/gtag/js")) {
      try {
        port.postMessage({
          type: "FERRY_NETWORK_HIT",
          url,
          tabId: details.tabId,
          timestamp: new Date().toISOString(),
          hitType: url.includes("gtm.js") ? "gtm-container" : "gtag-js",
        });
      } catch (e) {}
    }
  },
  { urls: ["<all_urls>"] }
);

// ── Content script event forwarding ──
// Used by the Record feature — content script relays window.postMessage events.

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "FERRY_EVENT") return;

  const tabId = sender.tab?.id;
  const port = connections.get(tabId);
  if (!port) return;

  port.postMessage(msg);
});
