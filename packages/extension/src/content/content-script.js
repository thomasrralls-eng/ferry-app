/**
 * Content script — bridges the page context (injected-hook.js) to the
 * extension context (background service worker).
 *
 * Runs in every frame at document_start.
 */

(() => {
  if (window.__ferry_content_script_loaded) return;
  window.__ferry_content_script_loaded = true;

  function injectScriptFile(file) {
    try {
      const src = chrome.runtime.getURL(file);
      const s = document.createElement("script");
      s.src = src;
      s.type = "text/javascript";
      s.async = false;
      (document.documentElement || document.head || document.body).appendChild(s);
      s.remove();
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
    if (!data || data.type !== "FERRY_EVENT") return;

    try {
      chrome.runtime.sendMessage({
        type: "FERRY_EVENT",
        payload: data.payload
      });
    } catch (e) {
      // Extension might be reloading — safe to ignore
    }
  });

  // Inject our hook into this frame
  injectScriptFile("src/content/injected-hook.js");
})();
