import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import Toolbar from "./components/Toolbar.jsx";
import ScoreCard from "./components/ScoreCard.jsx";
import Tabs from "./components/Tabs.jsx";
import FindingCard, { GroupedFindingCard } from "./components/FindingCard.jsx";
import EventRow, { GroupedEventRow } from "./components/EventRow.jsx";
import EmptyState from "./components/EmptyState.jsx";
import CrawlPanel from "./components/CrawlPanel.jsx";
import AgentReportPanel from "./components/AgentReportPanel.jsx";
import SettingsPanel from "./components/SettingsPanel.jsx";
import useFerryRecorder from "./hooks/useFerryRecorder.js";
import useFerryCrawler from "./hooks/useFerryCrawler.js";
import { useDomainAgent } from "./hooks/useDomainAgent.js";
import { analyzeSession } from "./analysis-agent.js";

// ── Fairy logo — loaded via chrome.runtime.getURL for extension compatibility ──
function FairyLogo({ size = 28 }) {
  const src = typeof chrome !== "undefined" && chrome.runtime
    ? chrome.runtime.getURL("icons/gdfairy_square.png")
    : "../icons/gdfairy_square.png";
  return (
    <img src={src} alt="gd fairy" width={size} height={size}
      style={{ display: "block", flexShrink: 0, borderRadius: 8 }} />
  );
}

const GA4_TABS = [
  { id: "findings", label: "Findings" },
  { id: "events",   label: "Events" },
  { id: "network",  label: "Network" },
  { id: "scanner",  label: "Scanner" },
  { id: "settings", label: "⚙" },
];

const GTM_TABS = [
  { id: "gtm-findings", label: "Findings" },
  { id: "gtm-datalayer", label: "DataLayer" },
  { id: "gtm-network",  label: "Network" },
  { id: "gtm-scanner",  label: "Scanner" },
  { id: "settings",    label: "⚙" },
];

export default function App() {
  const {
    recording, events, network, findings, activeTabId,
    startRecording, stopRecording, clear, exportJSON,
  } = useFerryRecorder();

  // ── Domain agent (cloud-backed enriched analysis) ──
  const {
    user, domains, activeDomain, activeDomainId, loading: agentLoading, error: agentError,
    signIn, signOut,
    setActiveDomainId,
    createDomain, updateDomainConfig, deleteDomain,
    uploadServiceAccount, removeServiceAccount, testConnection,
    analyzeWithAgent,
  } = useDomainAgent();

  const {
    crawling, progress, crawlReport, agentAnalysis, errors: crawlErrors,
    startCrawl, stopCrawl, clearReport,
  } = useFerryCrawler(activeTabId, analyzeWithAgent);

  const [mode, setMode] = useState("ga4"); // "ga4" or "gtm"
  const [activeTab, setActiveTab] = useState("findings");
  const [agentReport, setAgentReport] = useState(null);
  const [showAgentReport, setShowAgentReport] = useState(false);

  // Track previous recording/crawling state to detect stop transitions
  const prevRecordingRef = useRef(false);
  const prevCrawlingRef = useRef(false);

  const tabs = mode === "ga4" ? GA4_TABS : GTM_TABS;

  // ── Auto-analyze when recording stops ──
  useEffect(() => {
    if (prevRecordingRef.current && !recording) {
      // Recording just stopped — run analysis
      const hasData = events.length > 0 || network.length > 0 || findings.length > 0;
      if (hasData) {
        const report = analyzeSession({ events, network, findings, mode });
        setAgentReport(report);
        setShowAgentReport(true);
      }
    }
    prevRecordingRef.current = recording;
  }, [recording]);

  // ── Auto-analyze when crawl completes ──
  useEffect(() => {
    if (prevCrawlingRef.current && !crawling && crawlReport) {
      // Crawl just finished — run analysis including crawl data
      const report = analyzeSession({
        events, network, findings,
        crawlReport,
        mode,
      });
      setAgentReport(report);
      setShowAgentReport(true);
    }
    prevCrawlingRef.current = crawling;
  }, [crawling]);

  // ── Manual re-analyze ──
  const runAnalysis = useCallback(() => {
    const report = analyzeSession({
      events, network, findings,
      crawlReport: crawlReport || null,
      mode,
    });
    setAgentReport(report);
    setShowAgentReport(true);
  }, [events, network, findings, crawlReport, mode]);

  // Reset to first tab when mode changes
  const handleModeChange = (newMode) => {
    setMode(newMode);
    setActiveTab(newMode === "ga4" ? "findings" : "gtm-findings");
    // Re-analyze with new mode filter if we have a report
    if (agentReport) {
      const report = analyzeSession({
        events, network, findings,
        crawlReport: crawlReport || null,
        mode: newMode,
      });
      setAgentReport(report);
    }
  };

  const handleClear = useCallback(() => {
    clear();
    clearReport();
    setAgentReport(null);
    setShowAgentReport(false);
  }, [clear, clearReport]);

  // ── Settings renderer ──
  const renderSettings = () => (
    <SettingsPanel
      user={user}
      domains={domains}
      activeDomainId={activeDomainId}
      loading={agentLoading}
      error={agentError}
      onSignIn={signIn}
      onSignOut={signOut}
      onSetActiveDomain={setActiveDomainId}
      onCreateDomain={createDomain}
      onUpdateDomainConfig={updateDomainConfig}
      onDeleteDomain={deleteDomain}
      onUploadSA={uploadServiceAccount}
      onRemoveSA={removeServiceAccount}
      onTestConnection={testConnection}
    />
  );

  // ── Computed stats ──
  const modeFindings = useMemo(() => {
    if (mode === "gtm") return findings.filter((f) => f.category === "gtm");
    return findings.filter((f) => f.category !== "gtm");
  }, [findings, mode]);

  const stats = useMemo(() => {
    const errorFindings = modeFindings.filter((f) => f.severity === "error");
    const eventsWithErrors = new Set(
      errorFindings.map((f) => f.eventIndex).filter((idx) => idx !== undefined)
    ).size;
    return {
      events: events.length + network.length,
      errors: errorFindings.length,
      warnings: modeFindings.filter((f) => f.severity === "warning").length,
      eventsWithErrors,
    };
  }, [events, network, modeFindings]);

  const sortedFindings = useMemo(() => {
    const order = { error: 0, warning: 1, info: 2 };
    return [...modeFindings].sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
  }, [modeFindings]);

  // ── Group findings by ruleId for the Findings tab ──
  const groupedFindings = useMemo(() => {
    const map = new Map();
    for (const f of sortedFindings) {
      const key = f.ruleId || f.message || "unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(f);
    }
    // Sort groups: errors first, then warnings, then info — by first item's severity
    const order = { error: 0, warning: 1, info: 2 };
    return Array.from(map.entries()).sort(
      (a, b) => (order[a[1][0].severity] ?? 3) - (order[b[1][0].severity] ?? 3)
    );
  }, [sortedFindings]);

  // ── Group events by event name for the Events tab ──
  const groupedEvents = useMemo(() => {
    const map = new Map();
    for (let i = 0; i < events.length; i++) {
      const evt = events[i];
      const name = evt.eventName || evt.event || evt.payload?.event || "(unknown)";
      if (!map.has(name)) map.set(name, []);
      map.get(name).push({
        event: evt,
        originalIndex: i,
        findings: modeFindings.filter((f) => f.eventIndex === i),
      });
    }
    return Array.from(map.entries());
  }, [events, modeFindings]);

  const tabCounts = useMemo(() => {
    const scannerCount = crawlReport?.pages?.length || (crawling ? "..." : null);
    const findingGroupCount = groupedFindings.length;
    const eventGroupCount = groupedEvents.length;
    if (mode === "ga4") {
      return {
        findings: findingGroupCount,
        events: eventGroupCount,
        network: network.length,
        scanner: scannerCount,
      };
    }
    return {
      "gtm-findings": findingGroupCount,
      "gtm-datalayer": eventGroupCount,
      "gtm-network": network.length,
      "gtm-scanner": scannerCount,
    };
  }, [groupedFindings, groupedEvents, network, crawlReport, crawling, mode]);

  const hasData = stats.events > 0;

  // ── Shared tab content renderers ──
  const renderFindings = () => (
    sortedFindings.length === 0 ? (
      <EmptyState
        title={recording ? "No issues found yet" : "Start recording to analyze events"}
        subtitle={recording
          ? "Browse the site — gd fairy will flag data quality issues in real time."
          : "Click Record, then browse the site. gd fairy catches every dataLayer push and GA4 hit."
        }
      />
    ) : (
      groupedFindings.map(([ruleId, findings]) => (
        <GroupedFindingCard key={ruleId} ruleId={ruleId} findings={findings} />
      ))
    )
  );

  const renderEvents = () => (
    events.length === 0 ? (
      <EmptyState title="No events captured yet" subtitle="DataLayer pushes and gtag() calls will appear here." />
    ) : (
      groupedEvents.map(([name, entries]) => (
        <GroupedEventRow
          key={name}
          eventName={name}
          events={entries}
          allFindings={modeFindings}
        />
      ))
    )
  );

  const renderNetwork = () => (
    network.length === 0 ? (
      <EmptyState title="No network hits captured" subtitle="GA4 /collect requests will appear here." />
    ) : (
      network.map((hit, i) => (
        <EventRow
          key={i}
          event={hit}
          index={i + 1000}
          findings={modeFindings.filter((f) => f.eventIndex === i + 1000)}
        />
      ))
    )
  );

  const renderScanner = () => (
    <CrawlPanel
      crawling={crawling}
      progress={progress}
      crawlReport={crawlReport}
      errors={crawlErrors}
      onStartCrawl={startCrawl}
      onStopCrawl={stopCrawl}
      onClearReport={clearReport}
      activeTabId={activeTabId}
    />
  );

  return (
    <div className="p-4 min-h-screen">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-0.5">
          <FairyLogo size={22} />
          <span className="text-[14px] font-bold tracking-tight text-slate-800">
            gd fairy<span className="text-indigo-400 ml-0.5">✦</span>
          </span>
        </div>
        <Toolbar
          recording={recording}
          onStart={startRecording}
          onStop={stopRecording}
          onExport={exportJSON}
          onClear={handleClear}
          onSettings={() => setActiveTab("settings")}
          hasAgent={!!activeDomain}
        />
      </div>

      {/* ── Mode Selector ── */}
      <div className="flex gap-1 mb-3 bg-slate-100 rounded-lg p-0.5">
        <button
          onClick={() => handleModeChange("ga4")}
          className={`flex-1 px-3 py-1.5 text-[12px] font-semibold rounded-md transition ${
            mode === "ga4"
              ? "bg-white text-indigo-600 shadow-sm"
              : "text-slate-400 hover:text-slate-600"
          }`}
        >
          GA4
        </button>
        <button
          onClick={() => handleModeChange("gtm")}
          className={`flex-1 px-3 py-1.5 text-[12px] font-semibold rounded-md transition ${
            mode === "gtm"
              ? "bg-white text-indigo-600 shadow-sm"
              : "text-slate-400 hover:text-slate-600"
          }`}
        >
          GTM
        </button>
      </div>

      {/* ── Agent Report (appears after recording/crawl stops) ── */}
      {showAgentReport && agentReport && (
        <div className="mb-3">
          <AgentReportPanel
            report={agentReport}
            agentAnalysis={agentAnalysis}
            onDismiss={() => setShowAgentReport(false)}
            onViewFindings={() => {
              setShowAgentReport(false);
              setActiveTab(mode === "ga4" ? "findings" : "gtm-findings");
            }}
          />
        </div>
      )}

      {/* ── Score Cards ── */}
      {hasData && !showAgentReport && (
        <div className="flex gap-2 mb-3">
          <ScoreCard label="Events" value={stats.events} variant="events" />
          <ScoreCard
            label="w/ Errors"
            value={stats.eventsWithErrors}
            subtitle={stats.events > 0 ? `${Math.round((stats.eventsWithErrors / stats.events) * 100)}%` : "0%"}
            variant="eventsWithErrors"
          />
          <ScoreCard label="Errors" value={stats.errors} variant="errors" />
          <ScoreCard label="Warnings" value={stats.warnings} variant="warnings" />
        </div>
      )}

      {/* ── Analyze Button (when we have data but no report showing) ── */}
      {hasData && !showAgentReport && !recording && !crawling && (
        <button
          onClick={runAnalysis}
          className="w-full mb-3 py-2 text-[12px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-lg hover:bg-indigo-100 hover:border-indigo-200 transition flex items-center justify-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          Analyze Session
        </button>
      )}

      {/* ── Tabs ── */}
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} counts={tabCounts} />

      {/* ── Shared Settings Tab ── */}
      {activeTab === "settings" && renderSettings()}

      {/* ── GA4 Tab Content ── */}
      {mode === "ga4" && activeTab !== "settings" && (
        <>
          {activeTab === "findings" && <div>{renderFindings()}</div>}
          {activeTab === "events" && <div>{renderEvents()}</div>}
          {activeTab === "network" && <div>{renderNetwork()}</div>}
          {activeTab === "scanner" && renderScanner()}
        </>
      )}

      {/* ── GTM Tab Content ── */}
      {mode === "gtm" && activeTab !== "settings" && (
        <>
          {activeTab === "gtm-findings" && <div>{renderFindings()}</div>}
          {activeTab === "gtm-datalayer" && <div>{renderEvents()}</div>}
          {activeTab === "gtm-network" && <div>{renderNetwork()}</div>}
          {activeTab === "gtm-scanner" && renderScanner()}
        </>
      )}
    </div>
  );
}
