import { useState, useCallback, useRef, useEffect } from "react";

/**
 * Hook for managing site crawls via the background service worker.
 *
 * Creates a port connection ONLY when a crawl starts, and tears it down
 * when the crawl completes. This avoids "disconnected port" errors from
 * eagerly-created ports that die when the service worker goes idle.
 *
 * Accepts activeTabId from the parent — no DevTools API dependency.
 *
 * @param {string|number} activeTabId
 * @param {Function|null} analyzeWithAgent — optional callback from useDomainAgent;
 *   if provided, called with the crawlReport after crawl completes and the
 *   enriched analysis is stored in agentAnalysis state.
 */
export default function useFerryCrawler(activeTabId, analyzeWithAgent = null) {
  const [crawling, setCrawling] = useState(false);
  const [progress, setProgress] = useState(null);
  const [crawlReport, setCrawlReport] = useState(null);
  const [agentAnalysis, setAgentAnalysis] = useState(null);
  const [errors, setErrors] = useState([]);
  const portRef = useRef(null);

  // Keep a ref to the latest analyzeWithAgent to avoid stale closures
  // inside the port message listener closure.
  const analyzeWithAgentRef = useRef(analyzeWithAgent);
  useEffect(() => {
    analyzeWithAgentRef.current = analyzeWithAgent;
  }, [analyzeWithAgent]);

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

        case "FERRY_CRAWL_COMPLETE": {
          const report = {
            pages: msg.pages || [],
            totalVisited: msg.totalVisited,
            totalQueued: msg.totalQueued,
            stopped: msg.stopped || false,
          };
          setCrawling(false);
          setCrawlReport(report);
          setProgress(null);
          disconnectPort();

          // Fire domain agent enrichment in the background (non-blocking).
          // When the enriched analysis arrives, it's stored separately in
          // agentAnalysis so AgentReportPanel can surface "Connected Insights".
          const analyze = analyzeWithAgentRef.current;
          if (analyze) {
            setAgentAnalysis(null); // reset any previous result
            analyze(report, "ga4").then((enriched) => {
              if (enriched) setAgentAnalysis(enriched);
            }).catch(() => {/* silently ignore — agent analysis is best-effort */});
          }
          break;
        }

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
    setAgentAnalysis(null);
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
    setAgentAnalysis(null);
    setErrors([]);
    setProgress(null);
    disconnectPort();
  }, [disconnectPort]);

  return {
    crawling,
    progress,
    crawlReport,
    agentAnalysis,
    errors,
    startCrawl,
    stopCrawl,
    clearReport,
  };
}
