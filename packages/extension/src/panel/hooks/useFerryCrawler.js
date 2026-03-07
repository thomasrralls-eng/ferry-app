import { useState, useCallback, useRef } from "react";

/**
 * Hook for managing site crawls via the background service worker.
 *
 * Creates a port connection ONLY when a crawl starts, and tears it down
 * when the crawl completes. This avoids "disconnected port" errors from
 * eagerly-created ports that die when the service worker goes idle.
 *
 * Accepts activeTabId from the parent — no DevTools API dependency.
 */
export default function useFerryCrawler(activeTabId) {
  const [crawling, setCrawling] = useState(false);
  const [progress, setProgress] = useState(null);
  const [crawlReport, setCrawlReport] = useState(null);
  const [errors, setErrors] = useState([]);
  const portRef = useRef(null);

  const disconnectPort = useCallback(() => {
    if (portRef.current) {
      try { portRef.current.disconnect(); } catch (e) {}
      portRef.current = null;
    }
  }, []);

  const connectPort = useCallback(() => {
    disconnectPort();

    const port = chrome.runtime.connect({ name: "ferry-panel" });
    portRef.current = port;

    port.postMessage({ type: "FERRY_INIT", tabId: activeTabId });

    port.onMessage.addListener((msg) => {
      switch (msg.type) {
        case "FERRY_CRAWL_PROGRESS":
          setProgress({
            currentUrl: msg.currentUrl,
            visited: msg.visited,
            queued: msg.queued,
            maxPages: msg.maxPages,
          });
          break;

        case "FERRY_CRAWL_COMPLETE":
          setCrawling(false);
          setCrawlReport({
            pages: msg.pages || [],
            totalVisited: msg.totalVisited,
            totalQueued: msg.totalQueued,
            stopped: msg.stopped || false,
          });
          setProgress(null);
          disconnectPort();
          break;

        case "FERRY_CRAWL_ERROR":
          setErrors((prev) => [
            ...prev,
            { url: msg.url, error: msg.error, time: new Date().toISOString() },
          ]);
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      portRef.current = null;
    });

    return port;
  }, [activeTabId, disconnectPort]);

  const startCrawl = useCallback((startUrl, maxPages = 50) => {
    setCrawling(true);
    setCrawlReport(null);
    setErrors([]);
    setProgress(null);

    const port = connectPort();
    port.postMessage({
      type: "FERRY_CRAWL_START",
      startUrl,
      maxPages,
    });
  }, [connectPort]);

  const stopCrawl = useCallback(() => {
    try {
      portRef.current?.postMessage({ type: "FERRY_CRAWL_STOP" });
    } catch (e) {}
  }, []);

  const clearReport = useCallback(() => {
    setCrawlReport(null);
    setErrors([]);
    setProgress(null);
    disconnectPort();
  }, [disconnectPort]);

  return {
    crawling,
    progress,
    crawlReport,
    errors,
    startCrawl,
    stopCrawl,
    clearReport,
  };
}
