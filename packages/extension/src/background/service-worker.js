/**
 * Background service worker — routes messages from content scripts
 * to the correct DevTools panel instance.
 */

const connections = new Map();

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "ferry-panel") return;
  connections.set(port.sender.tab.id, port);
  port.onDisconnect.addListener(() => {
    connections.delete(port.sender.tab.id);
  });
});

// From content script (dataLayer / gtag events)
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "FERRY_EVENT") return;

  const tabId = sender.tab?.id;
  const port = connections.get(tabId);
  if (!port) return;

  port.postMessage(msg);
});
