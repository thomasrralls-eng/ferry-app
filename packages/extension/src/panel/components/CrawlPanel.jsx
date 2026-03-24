import React, { useState } from "react";

/**
 * CrawlPanel — the UI for starting / monitoring / reviewing a site crawl.
 *
 * Always starts from the current page (no URL input).
 *
 * States:
 *   idle      → shows max-pages + Start button
 *   crawling  → shows live progress (pages visited, current URL)
 *   complete  → shows crawl report summary + per-page details
 */
export default function CrawlPanel({
  crawling,
  progress,
  crawlReport,
  errors,
  onStartCrawl,
  onStopCrawl,
  onClearReport,
  activeTabId,
}) {
  const [maxPages, setMaxPages] = useState(50);

  const handleStart = async () => {
    if (!activeTabId) return;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: () => window.location.href,
      });
      const url = results?.[0]?.result;
      if (url) onStartCrawl(url, maxPages);
    } catch (e) {
      // Fall back to tabs API
      const tab = await chrome.tabs.get(activeTabId);
      if (tab?.url) onStartCrawl(tab.url, maxPages);
    }
  };

  // ── Crawl Report View ──
  if (crawlReport && !crawling) {
    const pageCount = crawlReport.pages?.length || 0;
    const totalEvents = crawlReport.pages?.reduce(
      (sum, p) => sum + (p.events?.length || 0), 0
    ) || 0;
    const pagesWithEvents = crawlReport.pages?.filter(
      (p) => p.events?.length > 0
    ).length || 0;
    const pagesWithoutEvents = pageCount - pagesWithEvents;

    return (
      <div className="space-y-3">
        {/* Summary card */}
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-800">
              Scan Complete
              {crawlReport.stopped && (
                <span className="ml-1.5 text-xs font-normal text-gray-400">(stopped early)</span>
              )}
            </h3>
            <div className="flex gap-2">
              <button
                onClick={onClearReport}
                className="px-2.5 py-1 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-md hover:bg-gray-100 transition"
              >
                Clear
              </button>
              <button
                onClick={handleStart}
                className="px-2.5 py-1 text-xs font-medium text-white bg-gradient-to-r from-amber-500 to-amber-600 rounded-md hover:from-amber-600 hover:to-amber-700 transition"
              >
                Scan Again
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-2xl font-bold text-gray-800">{pageCount}</div>
              <div className="text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">Pages</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-800">{totalEvents}</div>
              <div className="text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">Events</div>
            </div>
            <div>
              <div className={`text-2xl font-bold ${pagesWithoutEvents > 0 ? "text-amber-500" : "text-green-500"}`}>
                {pagesWithoutEvents > 0 ? pagesWithoutEvents : "0"}
              </div>
              <div className="text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">No Events</div>
            </div>
          </div>
        </div>

        {/* Page list */}
        {pageCount > 0 && <PageList pages={crawlReport.pages} />}

        {/* Crawl errors */}
        {errors.length > 0 && (
          <div className="rounded-lg border border-red-100 bg-red-50 p-3">
            <h4 className="text-xs font-semibold text-red-600 mb-1">Errors ({errors.length})</h4>
            {errors.map((err, i) => (
              <div key={i} className="text-[11px] text-red-500 truncate" title={err.url}>
                {err.url?.replace(/^https?:\/\/[^/]+/, "")} — {err.error}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Active Crawl View ──
  if (crawling) {
    const visited = progress?.visited || 0;
    const max = progress?.maxPages || maxPages;
    const pct = Math.round((visited / max) * 100);

    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
              <span className="text-sm font-semibold text-amber-700">Scanning...</span>
            </div>
            <button
              onClick={onStopCrawl}
              className="px-2.5 py-1 text-xs font-medium text-red-600 bg-white border border-red-200 rounded-md hover:bg-red-50 transition"
            >
              Stop
            </button>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-white/60 rounded-full h-1.5 mb-2">
            <div
              className="bg-amber-500 h-1.5 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>

          <div className="flex justify-between text-xs text-amber-600">
            <span>{visited} / {max} pages</span>
            <span>{progress?.queued || 0} queued</span>
          </div>

          {progress?.currentUrl && (
            <p className="text-[11px] text-amber-400 mt-2 truncate" title={progress.currentUrl}>
              {progress.currentUrl}
            </p>
          )}
        </div>

        {errors.length > 0 && (
          <p className="text-xs text-red-500">{errors.length} error{errors.length !== 1 ? "s" : ""}</p>
        )}
      </div>
    );
  }

  // ── Idle View ──
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Site Scanner</h3>
        <p className="text-xs text-gray-500 mb-4 leading-relaxed">
          Crawl pages from the site you're on, capturing all dataLayer events
          and GA4 hits on each page.
        </p>

        <div className="flex items-end gap-3">
          <div className="flex-shrink-0">
            <label className="block text-[11px] font-medium text-gray-500 mb-1">
              Max pages
            </label>
            <input
              type="number"
              value={maxPages}
              onChange={(e) => setMaxPages(Math.max(1, parseInt(e.target.value) || 50))}
              min={1}
              max={500}
              className="w-20 px-2.5 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-400 bg-amber-50/30"
            />
          </div>
          <button
            onClick={handleStart}
            className="flex-1 py-2 text-sm font-semibold text-white bg-gradient-to-r from-amber-500 to-amber-600 rounded-lg hover:from-amber-600 hover:to-amber-700 shadow-sm transition"
          >
            Scan This Site
          </button>
        </div>
      </div>
    </div>
  );
}


// ── Page List ──

function PageList({ pages }) {
  const [expanded, setExpanded] = useState(null);

  return (
    <div>
      <h4 className="text-xs font-semibold text-gray-500 mb-1.5">
        Pages ({pages.length})
      </h4>
      <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
        {pages.map((page, i) => {
          const eventCount = page.events?.length || 0;
          const isOpen = expanded === i;
          const path = page.url?.replace(/^https?:\/\/[^/]+/, "") || page.url;

          return (
            <div key={i}>
              <button
                onClick={() => setExpanded(isOpen ? null : i)}
                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50 transition group"
              >
                <span className="text-xs text-gray-700 truncate flex-1 mr-2" title={page.url}>
                  {path}
                </span>
                <span className="flex items-center gap-1.5 flex-shrink-0">
                  {eventCount > 0 ? (
                    <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded font-medium">
                      {eventCount} event{eventCount !== 1 ? "s" : ""}
                    </span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-500 rounded font-medium">
                      no events
                    </span>
                  )}
                  <svg
                    className={`w-3 h-3 text-gray-300 group-hover:text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
              </button>

              {isOpen && (
                <div className="px-3 pb-2 bg-gray-50/50">
                  {eventCount > 0 ? (
                    <div className="space-y-0.5 pt-1">
                      {page.events.map((evt, j) => (
                        <EventMini key={j} evt={evt} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-400 py-1">
                      No dataLayer events detected on this page.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ── Mini event display for page drill-down ──

function EventMini({ evt }) {
  const name = evt.eventName || evt.event || evt.payload?.event || evt.type || "unknown";
  const source = evt.source || "dataLayer";

  const sourceColors = {
    dataLayer: "bg-amber-50 text-amber-600",
    gtag: "bg-amber-50 text-amber-600",
  };

  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${sourceColors[source] || "bg-gray-100 text-gray-500"}`}>
        {source}
      </span>
      <span className="text-[11px] text-gray-600 font-mono truncate">
        {name}
      </span>
    </div>
  );
}
