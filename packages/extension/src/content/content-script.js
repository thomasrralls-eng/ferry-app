/**
 * Content script — bridges the page context (injected-hook.js) to the
 * extension context (background service worker).
 *
 * Runs in every frame at document_start.
 */

(() => {
  if (window.__fairy_content_script_loaded) return;
  window.__fairy_content_script_loaded = true;

  function injectScriptFile(file) {
    try {
      const src = chrome.runtime.getURL(file);
      const s = document.createElement("script");
      s.src = src;
      s.type = "text/javascript";
      s.async = false;
      (document.documentElement || document.head || document.body).appendChild(s);
      s.onload = () => s.remove();  // remove AFTER load, not before
      return true;
    } catch (e) {
      console.warn("[Ferry] Failed to inject", file, e);
      return false;
    }
  }

  // Listen for events from injected-hook.js
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== "FAIRY_EVENT") return;

    try {
      chrome.runtime.sendMessage({
        type: "FAIRY_EVENT",
        payload: data.payload
      });
    } catch (e) {
      // Extension might be reloading — safe to ignore
    }
  });

  // Respond to FAIRY_GET_LINKS requests from the crawler
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type !== "FAIRY_GET_LINKS") return;

    try {
      const links = Array.from(document.querySelectorAll("a[href]"))
        .map(a => {
          try { return new URL(a.href, window.location.href).href; }
          catch { return null; }
        })
        .filter(Boolean);
      sendResponse({ links });
    } catch (e) {
      sendResponse({ links: [] });
    }

    return true; // keep channel open for async response
  });

  // Inject our hook into this frame
  injectScriptFile("injected-hook.js");
})();
