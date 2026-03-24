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
import useFairyRecorder from "./hooks/useFairyRecorder.js";
import useFairyCrawler from "./hooks/useFairyCrawler.js";
import { useDomainAgent } from "./hooks/useDomainAgent.js";
import { analyzeSession } from "./analysis-agent.js";

// ── Fairy wordmark — full "data fairy" logotype inline SVG ──
function FairyLogo({ height = 18 }) {
  return (
    <svg height={height} viewBox="700 455 530 165" xmlns="http://www.w3.org/2000/svg" style={{ display: "block", width: "auto", flexShrink: 0 }}>
      <path fill="#1c1917" d="M742.89,589.99c-8.23,0-14.9-3.12-20-9.36-5.09-6.24-7.64-14.63-7.64-25.16s2.61-18.49,7.83-24.9c5.22-6.41,11.91-9.61,20.06-9.61s14.31,3.23,18.47,9.68h.38v-33.63h17.33v91.07h-16.69v-8.54h-.26c-4.25,6.97-10.74,10.44-19.49,10.44ZM746.71,575.47c5.1,0,8.98-1.74,11.66-5.22,2.68-3.48,4.01-8.28,4.01-14.39,0-13.92-5.05-20.89-15.16-20.89-4.67,0-8.24,1.87-10.7,5.6-2.46,3.74-3.69,8.71-3.69,14.91s1.21,11.3,3.63,14.77c2.42,3.48,5.84,5.22,10.25,5.22Z"/>
      <path fill="#1c1917" d="M851.92,532.53v-11.47h9.05v-18.7h16.94v18.7h11.21v11.47h-11.21v36.31c0,4.33,2.17,6.5,6.5,6.5l5.1-.13v12.74c-2.64.17-6.24.26-10.83.26-5.01,0-9.21-1.21-12.61-3.63-3.39-2.41-5.09-6.43-5.09-12.04v-40.01h-9.05Z"/>
      <path fill="#1c1917" d="M961.34,533.04v-11.97h8.92v-4.19c0-7.64,2.63-13.08,7.9-16.3s12.31-4.37,21.14-3.44v13.38c-4.33-.17-7.37.21-9.11,1.15-1.74.93-2.61,3.02-2.61,6.24v3.16h11.72v11.97h-11.72v55.04h-17.32v-55.04h-8.92Z"/>
      <path fill="#d97706" d="M1033.3,521.06c-9,0-15.84,2.05-20.63,6.15-4.79,4.1-7.29,9.23-7.52,15.38h15.38c.57-6.15,4.79-9.12,12.65-9.12,3.53,0,6.27.68,8.09,2.05,1.94,1.37,2.85,3.3,2.85,5.7s-1.14,3.87-3.3,4.79c-2.17.8-6.38,1.71-12.53,2.62-8.32,1.14-14.7,3.3-19.26,6.38-4.67,3.08-6.95,7.98-6.95,14.59s2.05,11.28,6.27,14.81c4.1,3.42,9.69,5.24,16.52,5.24,5.24,0,9.23-.8,12.08-2.39,2.96-1.48,5.36-3.65,7.18-6.5l.11,7.29h16.52v-42.96c0-15.95-9.12-24.04-27.46-24.04ZM1044.46,565.05c0,3.42-1.37,6.27-4.1,8.77-2.74,2.51-6.5,3.65-11.28,3.65-6.72,0-10.14-2.73-10.14-8.2,0-2.96,1.03-5.01,3.08-6.5,1.94-1.37,5.47-2.62,10.37-3.76,6.27-1.37,10.26-2.73,12.08-3.76v9.8Z"/>
      <path fill="#1c1917" d="M926.98,521.06c-9,0-15.84,2.05-20.63,6.15-4.79,4.1-7.29,9.23-7.52,15.38h15.38c.57-6.15,4.79-9.12,12.65-9.12,3.53,0,6.27.68,8.09,2.05,1.94,1.37,2.85,3.3,2.85,5.7s-1.14,3.87-3.3,4.79c-2.17.8-6.38,1.71-12.53,2.62-8.32,1.14-14.7,3.3-19.26,6.38-4.67,3.08-6.95,7.98-6.95,14.59s2.05,11.28,6.27,14.81c4.1,3.42,9.69,5.24,16.52,5.24,5.24,0,9.23-.8,12.08-2.39,2.96-1.48,5.36-3.65,7.18-6.5l.11,7.29h16.52v-42.96c0-15.95-9.12-24.04-27.46-24.04ZM938.15,565.05c0,3.42-1.37,6.27-4.1,8.77-2.74,2.51-6.5,3.65-11.28,3.65-6.72,0-10.14-2.73-10.14-8.2,0-2.96,1.03-5.01,3.08-6.5,1.94-1.37,5.47-2.62,10.37-3.76,6.27-1.37,10.26-2.73,12.08-3.76v9.8Z"/>
      <path fill="#d97706" d="M1071.77,589.66v-68.6h17.33v68.6h-17.33Z"/>
      <path fill="#1c1917" d="M1117.29,521.83v10.45h.38c2.04-3.82,4.28-6.64,6.75-8.47,2.46-1.83,5.56-2.74,9.3-2.74,1.79,0,3.14.17,4.08.51v15.16h-.38c-5.86-.6-10.57.68-14.14,3.82-3.57,3.14-5.35,8.07-5.35,14.77v34.34h-17.33v-67.84h16.69Z"/>
      <path fill="#1c1917" d="M1148.6,608.37v-13.63h6.11c6.45,0,9.68-2.97,9.68-8.91,0-2.89-1.55-9.35-4.86-18.26l-17.58-46.49h18.21l9.68,29.42,4.21,14.27h.25c1.19-5.51,2.46-10.27,3.82-14.27l9.17-29.42h17.45l-22.9,67.56c-2.55,7.47-5.41,12.62-8.6,15.47-3.19,2.84-8.01,4.27-14.46,4.27h-10.19Z"/>
      <path fill="#1c1917" d="M818.84,521.06c-9,0-15.84,2.05-20.63,6.15-4.79,4.1-7.29,9.23-7.52,15.38h15.38c.57-6.15,4.79-9.12,12.65-9.12,3.53,0,6.27.68,8.09,2.05,1.94,1.37,2.85,3.3,2.85,5.7s-1.14,3.87-3.3,4.79c-2.17.8-6.38,1.71-12.53,2.62-8.32,1.14-14.7,3.3-19.26,6.38-4.67,3.08-6.95,7.98-6.95,14.59s2.05,11.28,6.27,14.81c4.1,3.42,9.69,5.24,16.52,5.24,5.24,0,9.23-.8,12.08-2.39,2.96-1.48,5.36-3.65,7.18-6.5l.11,7.29h16.52v-42.96c0-15.95-9.12-24.04-27.46-24.04ZM830.01,565.05c0,3.42-1.37,6.27-4.1,8.77-2.74,2.51-6.5,3.65-11.28,3.65-6.72,0-10.14-2.73-10.14-8.2,0-2.96,1.03-5.01,3.08-6.5,1.94-1.37,5.47-2.62,10.37-3.76,6.27-1.37,10.26-2.73,12.08-3.76v9.8Z"/>
      <path fill="#d97706" d="M1080.8,481.41c-3.89,7.18-9.78,13.08-16.97,16.97,7.18,3.89,13.08,9.78,16.97,16.97,3.89-7.19,9.78-13.08,16.97-16.97-7.18-3.89-13.08-9.78-16.97-16.97ZM1080.79,508.8v.14s0-.09,0-.14c-.02-5.72-4.71-10.4-10.43-10.42-.05,0-.09,0-.14,0h.14c5.72-.02,10.41-4.7,10.43-10.42,0-.05,0-.09,0-.14v.14c.02,5.72,4.71,10.4,10.43,10.42h.14s-.09,0-.14,0c-5.72.02-10.41,4.7-10.43,10.42Z"/>
      <path fill="#d97706" d="M1091.35,485.09v.09s0-.06,0-.09c-.01-3.67-3.02-6.67-6.69-6.68-.03,0-.06,0-.09,0h.09c3.67-.01,6.68-3.02,6.69-6.68,0-.03,0-.06,0-.09v.09c.01,3.67,3.02,6.67,6.69,6.68h.09s-.06,0-.09,0c-3.67.01-6.68,3.02-6.69,6.68Z"/>
      <path fill="#d97706" d="M1061.71,509.57v.05s0-.03,0-.05c0-1.89-1.56-3.45-3.46-3.45-.02,0-.03,0-.05,0h.05c1.9,0,3.45-1.56,3.46-3.45,0-.02,0-.03,0-.05v.05c0,1.89,1.56,3.45,3.46,3.45h.05s-.03,0-.05,0c-1.9,0-3.45,1.56-3.46,3.45Z"/>
    </svg>
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
  } = useFairyRecorder();

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
  } = useFairyCrawler(activeTabId, analyzeWithAgent);

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
          ? "Browse the site — data fairy will flag data quality issues in real time."
          : "Click Record, then browse the site. data fairy catches every dataLayer push and GA4 hit."
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
        <div className="flex items-center">
          <FairyLogo height={18} />
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
              ? "bg-white text-amber-600 shadow-sm"
              : "text-slate-400 hover:text-slate-600"
          }`}
        >
          GA4
        </button>
        <button
          onClick={() => handleModeChange("gtm")}
          className={`flex-1 px-3 py-1.5 text-[12px] font-semibold rounded-md transition ${
            mode === "gtm"
              ? "bg-white text-amber-600 shadow-sm"
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
          className="w-full mb-3 py-2 text-[12px] font-semibold text-amber-600 bg-amber-50 border border-amber-100 rounded-lg hover:bg-amber-100 hover:border-amber-200 transition flex items-center justify-center gap-1.5"
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
