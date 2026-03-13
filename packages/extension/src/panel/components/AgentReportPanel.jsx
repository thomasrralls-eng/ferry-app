import React, { useState } from "react";

/**
 * AgentReportPanel — the "smart summary" that appears after a recording
 * or crawl finishes. Shows a health score, risk-bucketed action items with
 * fix suggestions, and session insights.
 *
 * Actions are grouped by risk level:
 *   Safe   → data being lost, fixing only gains
 *   Low    → adds missing data, no existing impact
 *   Medium → changes active tracking, needs care
 *   High   → structural changes, needs GTM/GA4 access (Pro)
 */
export default function AgentReportPanel({ report, agentAnalysis, onDismiss, onViewFindings }) {
  const [expandedAction, setExpandedAction] = useState(null);
  const [collapsedBuckets, setCollapsedBuckets] = useState({});

  if (!report) return null;

  const { health, mode, riskBuckets, actionItems, insights, crawlAnalysis, summary, tierBreakdown, ga4Version } = report;
  const scoreLabel = mode === "gtm" ? "GTM Implementation Score" : "GA4 Implementation Score";
  const analysisLabel = mode === "gtm" ? "GTM Analysis" : "GA4 Analysis";

  const toggleBucket = (key) => {
    setCollapsedBuckets(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Order of risk buckets to display
  const bucketOrder = ["safe", "low", "medium", "high"];
  const activeBuckets = bucketOrder.filter(key => riskBuckets?.[key]?.actions?.length > 0);

  return (
    <div className="space-y-3 animate-in">
      {/* ── Health Score Card ── */}
      <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-white to-indigo-50/30 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-indigo-900">
              {analysisLabel}
            </span>
            {ga4Version && ga4Version.version !== "free" && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                ga4Version.version === "360"
                  ? "bg-purple-100 text-purple-700 border border-purple-200"
                  : "bg-amber-50 text-amber-700 border border-amber-200"
              }`}>
                {ga4Version.version === "360" ? "GA4 360" : "GA4 360?"}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {onViewFindings && (
              <button
                onClick={onViewFindings}
                className="px-2.5 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 transition"
              >
                All Findings
              </button>
            )}
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="px-2 py-1 text-xs text-gray-400 hover:text-gray-600 transition"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>

        {/* Score ring */}
        <div className="flex items-center gap-4">
          <HealthRing score={health.score} label={health.label} scoreLabel={scoreLabel} />
          <div className="flex-1">
            <div className="flex gap-3 text-center">
              <StatPill value={summary.totalEvents || 0} label="Events" color="indigo" />
              <StatPill value={summary.eventsWithErrors || 0} label="w/ Errors" color="red" />
              <StatPill value={summary.warnings} label="Warnings" color="amber" />
            </div>
            {actionItems.length > 0 && (
              <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                We found <strong>{actionItems.length} thing{actionItems.length !== 1 ? "s" : ""}</strong> to address.
                {tierBreakdown?.free > 0 && ` ${tierBreakdown.free} can be fixed right now.`}
                {tierBreakdown?.pro > 0 && ` ${tierBreakdown.pro} need container access.`}
              </p>
            )}
            {actionItems.length === 0 && (
              <p className="text-xs text-green-600 mt-2 font-medium">
                No issues found — your tracking looks clean!
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Insights ── */}
      {insights.length > 0 && (
        <div className="rounded-lg border border-violet-100 bg-violet-50/30 p-3">
          <h4 className="text-[11px] font-semibold text-violet-500 uppercase tracking-wider mb-2">
            Session Overview
          </h4>
          <div className="space-y-2">
            {insights.map((insight, i) => (
              <div key={i} className="flex items-start gap-2">
                <InsightIcon type={insight.type} />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-gray-700">{insight.title}</div>
                  {insight.detail && (
                    <div className="text-[11px] text-gray-400 leading-relaxed mt-0.5 break-words">{insight.detail}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Crawl Summary (if scanner) ── */}
      {crawlAnalysis && (
        <CrawlSummary crawlAnalysis={crawlAnalysis} />
      )}

      {/* ── Connected Insights (domain agent enriched analysis) ── */}
      {agentAnalysis && (
        <ConnectedInsights agentAnalysis={agentAnalysis} />
      )}

      {/* ── Risk-Bucketed Action Items ── */}
      {activeBuckets.map((bucketKey) => {
        const bucket = riskBuckets[bucketKey];
        const isCollapsed = collapsedBuckets[bucketKey];
        const meta = BUCKET_META[bucketKey];
        const hasProActions = bucket.actions.some(a => a.tier === "pro");
        const isConversational = bucketKey === "safe" || bucketKey === "low";

        return (
          <div key={bucketKey} className={`rounded-lg border ${meta.borderColor} overflow-hidden`}>
            {/* Bucket header */}
            <button
              onClick={() => toggleBucket(bucketKey)}
              className={`w-full flex items-center justify-between px-3 py-2.5 ${meta.headerBg} transition hover:brightness-95`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-5 h-5 rounded-full ${meta.iconBg} flex items-center justify-center`}>
                  <span className="text-[10px]">{meta.icon}</span>
                </span>
                <div className="text-left">
                  <span className="text-xs font-semibold text-gray-800">{bucket.label}</span>
                  <span className="text-[10px] text-gray-400 ml-1.5">
                    {bucket.actions.length} item{bucket.actions.length !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {hasProActions && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-violet-100 text-violet-600">
                    PRO
                  </span>
                )}
                <ChevronIcon rotated={!isCollapsed} />
              </div>
            </button>

            {/* Bucket description */}
            {!isCollapsed && (
              <div className="px-3 py-1.5 bg-white/50 border-b border-gray-100">
                <p className="text-[11px] text-gray-500 leading-relaxed">{bucket.description}</p>
              </div>
            )}

            {/* Conversational rendering for safe/low buckets */}
            {!isCollapsed && isConversational && (
              <div className="p-2 space-y-2 bg-white/30">
                {bucket.actions.map((action) => (
                  <ConversationalGroup
                    key={action.ruleId}
                    action={action}
                    isExpanded={expandedAction === action.ruleId}
                    onToggle={() =>
                      setExpandedAction(expandedAction === action.ruleId ? null : action.ruleId)
                    }
                  />
                ))}
              </div>
            )}

            {/* Standard card rendering for medium/high buckets */}
            {!isCollapsed && !isConversational && (
              <div className="p-2 space-y-2 bg-white/30">
                {bucket.actions.map((action) => (
                  <ActionCard
                    key={action.ruleId}
                    action={action}
                    isExpanded={expandedAction === action.ruleId}
                    onToggle={() =>
                      setExpandedAction(expandedAction === action.ruleId ? null : action.ruleId)
                    }
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* ── Pro Upgrade Nudge ── */}
      {tierBreakdown?.pro > 0 && (
        <div className="rounded-lg border border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50 p-4">
          <div className="flex items-start gap-3">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center flex-shrink-0 shadow-sm">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </span>
            <div>
              <h4 className="text-sm font-semibold text-gray-800 mb-1">
                {tierBreakdown.pro} fix{tierBreakdown.pro !== 1 ? "es" : ""} need GTM/GA4 access
              </h4>
              <p className="text-xs text-gray-500 leading-relaxed mb-2">
                Medium- and high-risk changes require connecting your GTM container or GA4 property
                so gd fairy can safely apply changes, preview them, and roll back if needed.
              </p>
              <button className="px-3 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-indigo-500 to-violet-500 rounded-lg hover:from-indigo-600 hover:to-violet-600 shadow-sm transition">
                Connect GTM/GA4 — Coming Soon
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ──────────────────────────────────────────────
// Bucket visual metadata
// ──────────────────────────────────────────────

const BUCKET_META = {
  safe: {
    icon: "✓",
    iconBg: "bg-green-100",
    headerBg: "bg-green-50/60",
    borderColor: "border-green-200",
  },
  low: {
    icon: "+",
    iconBg: "bg-violet-100",
    headerBg: "bg-violet-50/40",
    borderColor: "border-violet-200",
  },
  medium: {
    icon: "~",
    iconBg: "bg-amber-100",
    headerBg: "bg-amber-50/60",
    borderColor: "border-amber-200",
  },
  high: {
    icon: "!",
    iconBg: "bg-red-100",
    headerBg: "bg-red-50/60",
    borderColor: "border-red-200",
  },
};


// ──────────────────────────────────────────────
// Shared micro-components
// ──────────────────────────────────────────────

function ChevronIcon({ rotated, className = "" }) {
  return (
    <svg
      className={`w-4 h-4 text-gray-400 transition-transform ${rotated ? "rotate-180" : ""} ${className}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}


// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────

function HealthRing({ score, label, scoreLabel = "Implementation Score" }) {
  const size = 96;
  const center = size / 2;
  const radius = 40;
  const stroke = 6;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  let color;
  if (score >= 90) color = "#22c55e";
  else if (score >= 75) color = "#84cc16";
  else if (score >= 50) color = "#f59e0b";
  else if (score >= 25) color = "#f97316";
  else color = "#ef4444";

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={center} cy={center} r={radius} fill="none" stroke="#f3f4f6" strokeWidth={stroke} />
        <circle
          cx={center} cy={center} r={radius}
          fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-gray-800" style={{ lineHeight: 1 }}>{score}</span>
        <span className="text-[8px] text-gray-400 font-medium uppercase mt-1 tracking-wide leading-tight text-center px-1">{scoreLabel}</span>
      </div>
    </div>
  );
}

function StatPill({ value, label, color }) {
  const colors = {
    indigo: "bg-indigo-50 text-indigo-600 border-indigo-100",
    red: "bg-red-50 text-red-600 border-red-100",
    amber: "bg-amber-50 text-amber-600 border-amber-100",
    blue: "bg-violet-50 text-violet-600 border-violet-100",
  };

  return (
    <div className={`flex-1 rounded-lg border px-2 py-1.5 ${colors[color]}`}>
      <div className="text-base font-bold leading-none">{value}</div>
      <div className="text-[9px] font-medium uppercase mt-0.5 opacity-70">{label}</div>
    </div>
  );
}

function InsightIcon({ type }) {
  const icons = {
    "measurement-ids": <span className="text-[10px] w-4 h-4 rounded bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold">G</span>,
    "event-variety": <span className="text-[10px] w-4 h-4 rounded bg-violet-100 text-violet-600 flex items-center justify-center font-bold">#</span>,
    "ecommerce": <span className="text-[10px] w-4 h-4 rounded bg-amber-100 text-amber-600 flex items-center justify-center font-bold">$</span>,
    "error-ratio": <span className="text-[10px] w-4 h-4 rounded bg-red-100 text-red-600 flex items-center justify-center font-bold">!</span>,
    "clean": <span className="text-[10px] w-4 h-4 rounded bg-green-100 text-green-600 flex items-center justify-center font-bold">✓</span>,
    "no-data": <span className="text-[10px] w-4 h-4 rounded bg-violet-50 text-violet-400 flex items-center justify-center font-bold">?</span>,
  };

  return icons[type] || (
    <span className="text-[10px] w-4 h-4 rounded bg-gray-100 text-gray-500 flex items-center justify-center font-bold">·</span>
  );
}

function SeverityDot({ severity }) {
  const colors = { error: "bg-red-400", warning: "bg-amber-400", info: "bg-violet-400" };
  return <span className={`w-1.5 h-1.5 rounded-full ${colors[severity] || "bg-gray-300"} flex-shrink-0 mt-1`} />;
}


// ──────────────────────────────────────────────
// Connected Insights — GA4 / GTM / BQ enrichment
// ──────────────────────────────────────────────

function ConnectedInsights({ agentAnalysis }) {
  const [expanded, setExpanded] = useState(true);
  const { ga4Snapshot, gtmSnapshot, bqSnapshot, aiAnalysis, masterPatterns, masterBusinessType } = agentAnalysis;

  return (
    <div className="rounded-lg border border-indigo-200 bg-gradient-to-br from-indigo-50/60 to-violet-50/40 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-indigo-50/60 transition"
      >
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center">
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </span>
          <span className="text-xs font-semibold text-indigo-900">Connected Insights</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 font-medium">Live</span>
        </div>
        <ChevronIcon rotated={expanded} />
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {/* AI Analysis (Gemini) */}
          {aiAnalysis && (
            <div className="p-2.5 rounded-lg bg-white/70 border border-indigo-100">
              <h5 className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider mb-1.5">
                AI Analysis
              </h5>
              <p className="text-[12px] text-gray-600 leading-relaxed">{aiAnalysis}</p>
            </div>
          )}

          {/* GA4 Snapshot */}
          {ga4Snapshot && (
            <div className="p-2.5 rounded-lg bg-white/70 border border-indigo-100">
              <h5 className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider mb-2">
                GA4 — Last 30 Days
              </h5>
              <div className="grid grid-cols-3 gap-2 text-center mb-2">
                <StatPill value={fmtNum(ga4Snapshot.sessions)} label="Sessions" color="indigo" />
                <StatPill value={fmtNum(ga4Snapshot.totalUsers)} label="Users" color="blue" />
                <StatPill value={fmtNum(ga4Snapshot.conversions)} label="Conversions" color="amber" />
              </div>
              {ga4Snapshot.topEvents?.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide mb-1">
                    Top Events
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {ga4Snapshot.topEvents.slice(0, 8).map((e) => (
                      <span
                        key={e.eventName}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-50 border border-indigo-100 text-[11px] font-mono text-indigo-700"
                        title={`${fmtNum(e.eventCount)} events`}
                      >
                        {e.eventName}
                        <span className="text-[10px] text-indigo-400">{fmtCompact(e.eventCount)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* GTM Snapshot */}
          {gtmSnapshot && (
            <div className="p-2.5 rounded-lg bg-white/70 border border-indigo-100">
              <h5 className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider mb-2">
                GTM Container
                {gtmSnapshot.containerId && (
                  <span className="ml-1.5 font-mono text-indigo-400 normal-case">{gtmSnapshot.containerId}</span>
                )}
              </h5>
              <div className="flex gap-3 text-center mb-2">
                <div>
                  <div className="text-base font-bold text-gray-800">{gtmSnapshot.tagCount ?? "—"}</div>
                  <div className="text-[10px] text-gray-400">Tags</div>
                </div>
                <div>
                  <div className="text-base font-bold text-gray-800">{gtmSnapshot.triggerCount ?? "—"}</div>
                  <div className="text-[10px] text-gray-400">Triggers</div>
                </div>
                <div>
                  <div className="text-base font-bold text-gray-800">{gtmSnapshot.variableCount ?? "—"}</div>
                  <div className="text-[10px] text-gray-400">Variables</div>
                </div>
                {gtmSnapshot.customHtmlTags > 0 && (
                  <div>
                    <div className="text-base font-bold text-amber-500">{gtmSnapshot.customHtmlTags}</div>
                    <div className="text-[10px] text-gray-400">Custom HTML</div>
                  </div>
                )}
              </div>
              {gtmSnapshot.ga4ConfigTags?.length > 0 && (
                <div className="mt-1.5">
                  <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide mb-1">
                    GA4 Config Tags
                  </p>
                  {gtmSnapshot.ga4ConfigTags.map((t) => (
                    <div key={t.measurementId} className="flex items-center gap-1.5 text-[11px]">
                      <span className="text-green-500">✓</span>
                      <span className="font-mono text-gray-600">{t.measurementId}</span>
                      <span className="text-gray-400 truncate">{t.name}</span>
                    </div>
                  ))}
                </div>
              )}
              {gtmSnapshot.publishedVersion?.versionId && (
                <p className="text-[10px] text-gray-400 mt-1.5">
                  Published version: <span className="font-mono text-gray-600">v{gtmSnapshot.publishedVersion.versionId}</span>
                  {gtmSnapshot.publishedVersion.name && ` — ${gtmSnapshot.publishedVersion.name}`}
                </p>
              )}
            </div>
          )}

          {/* BigQuery Snapshot */}
          {bqSnapshot?.events?.length > 0 && (
            <div className="p-2.5 rounded-lg bg-white/70 border border-indigo-100">
              <h5 className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider mb-2">
                BigQuery — Raw GA4 360 Events
              </h5>
              <p className="text-[10px] text-gray-400 mb-1.5">
                Top events by volume over last 30 days
              </p>
              <div className="space-y-1">
                {bqSnapshot.events.slice(0, 8).map((e) => (
                  <div key={e.eventName} className="flex items-center justify-between text-[11px]">
                    <span className="font-mono text-gray-600 truncate">{e.eventName}</span>
                    <span className="text-gray-400 flex-shrink-0 ml-2">{fmtCompact(e.count)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fairy Master — Industry Patterns */}
          {masterPatterns?.length > 0 && (
            <div className="p-2.5 rounded-lg bg-white/70 border border-violet-100">
              <h5 className="text-[10px] font-semibold text-violet-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <span>Industry Patterns</span>
                {masterBusinessType && (
                  <span className="font-mono font-normal text-violet-300 normal-case">
                    — {masterBusinessType}
                  </span>
                )}
              </h5>
              <p className="text-[10px] text-gray-400 mb-1.5 leading-relaxed">
                Common issues found across similar sites by the fairy master.
              </p>
              <div className="space-y-1.5">
                {masterPatterns.map((p, i) => {
                  const severityColor = {
                    error: "text-red-600 bg-red-50 border-red-100",
                    warning: "text-amber-600 bg-amber-50 border-amber-100",
                    info: "text-violet-600 bg-violet-50 border-violet-100",
                  }[p.severity] || "text-gray-600 bg-gray-50 border-gray-100";
                  return (
                    <div key={i} className={`rounded border px-2 py-1.5 ${severityColor}`}>
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-[10px] font-semibold uppercase">{p.severity}</span>
                        <span className="text-[10px] font-medium opacity-70">
                          {Math.round(p.frequency * 100)}% of sites
                        </span>
                      </div>
                      <p className="text-[11px] leading-snug">{p.pattern}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Format number with K/M suffix */
function fmtCompact(n) {
  if (!n && n !== 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Format number with locale commas */
function fmtNum(n) {
  if (!n && n !== 0) return "—";
  return Number(n).toLocaleString();
}


// ──────────────────────────────────────────────
// Crawl Summary — with expandable page lists
// ──────────────────────────────────────────────

function CrawlSummary({ crawlAnalysis }) {
  const [expandedIssue, setExpandedIssue] = useState(null);

  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
      <h4 className="text-[11px] font-semibold text-indigo-600 uppercase tracking-wider mb-2">
        Site Scan Summary
      </h4>
      <div className="grid grid-cols-3 gap-2 text-center mb-2">
        <div>
          <div className="text-lg font-bold text-gray-800">{crawlAnalysis.totalPages}</div>
          <div className="text-[10px] text-gray-400">Pages</div>
        </div>
        <div>
          <div className="text-lg font-bold text-gray-800">{crawlAnalysis.totalEvents}</div>
          <div className="text-[10px] text-gray-400">Events</div>
        </div>
        <div>
          <div className={`text-lg font-bold ${crawlAnalysis.pagesWithoutEvents > 0 ? "text-amber-500" : "text-green-500"}`}>
            {crawlAnalysis.pagesWithoutEvents}
          </div>
          <div className="text-[10px] text-gray-400">No Events</div>
        </div>
      </div>
      {crawlAnalysis.pageIssues?.map((issue, i) => (
        <CrawlIssueCard
          key={i}
          issue={issue}
          isExpanded={expandedIssue === i}
          onToggle={() => setExpandedIssue(expandedIssue === i ? null : i)}
        />
      ))}
    </div>
  );
}

function CrawlIssueCard({ issue, isExpanded, onToggle }) {
  const pageCount = issue.pages?.length || 0;
  const PREVIEW_LIMIT = 3;

  return (
    <div className="mt-2 rounded bg-white/60 border border-indigo-100 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full text-left p-2 hover:bg-white/80 transition"
      >
        <div className="flex items-center gap-1.5 mb-0.5">
          <SeverityDot severity={issue.severity} />
          <span className="text-xs font-medium text-gray-700 flex-1">{issue.title}</span>
          {pageCount > PREVIEW_LIMIT && (
            <ChevronIcon rotated={isExpanded} className="w-3.5 h-3.5" />
          )}
        </div>
        {issue.suggestion && (
          <p className="text-[11px] text-gray-500 leading-relaxed">{issue.suggestion}</p>
        )}
      </button>

      {issue.pages && issue.pages.length > 0 && (
        <div className="px-2 pb-2">
          <div className="space-y-0.5">
            {issue.pages.slice(0, isExpanded ? undefined : PREVIEW_LIMIT).map((url, j) => (
              <div key={j} className="text-[10px] text-gray-400 font-mono truncate">
                {url.replace(/^https?:\/\/[^/]+/, "")}
              </div>
            ))}
          </div>
          {!isExpanded && pageCount > PREVIEW_LIMIT && (
            <button
              onClick={onToggle}
              className="text-[10px] text-indigo-500 hover:text-indigo-700 font-medium mt-1 transition"
            >
              Show {pageCount - PREVIEW_LIMIT} more page{pageCount - PREVIEW_LIMIT !== 1 ? "s" : ""}
            </button>
          )}
        </div>
      )}
    </div>
  );
}


// ──────────────────────────────────────────────
// ConversationalGroup — friendly safe/low rendering
// ──────────────────────────────────────────────

/**
 * Deduplicates specificItems by name, counting occurrences.
 * Returns [{ name, count, occurrences: [...] }]
 */
function deduplicateItems(specificItems) {
  if (!specificItems || specificItems.length === 0) return [];

  const map = new Map();
  for (const item of specificItems) {
    const key = item.name;
    if (!map.has(key)) {
      map.set(key, { name: key, count: 0, occurrences: [] });
    }
    const entry = map.get(key);
    entry.count++;
    entry.occurrences.push(item);
  }

  // Sort by count descending, then alphabetically
  return Array.from(map.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.name.localeCompare(b.name);
  });
}


function ConversationalGroup({ action, isExpanded, onToggle }) {
  const [showAllItems, setShowAllItems] = useState(false);
  const [expandedItemName, setExpandedItemName] = useState(null);

  const severityColors = {
    error:   { dot: "bg-red-400",    accent: "text-red-600",    bg: "bg-red-50" },
    warning: { dot: "bg-amber-400",  accent: "text-amber-600",  bg: "bg-amber-50" },
    info:    { dot: "bg-violet-400", accent: "text-violet-600", bg: "bg-violet-50" },
  };

  const effortLabels = { quick: "Quick fix", medium: "Moderate effort", large: "Major project" };
  const c = severityColors[action.severity] || severityColors.info;

  // Deduplicate items by name and count them
  const dedupedItems = deduplicateItems(action.specificItems);
  const hasItems = dedupedItems.length > 0;

  // Show up to 6 unique items inline; rest behind "Show N more"
  const INLINE_LIMIT = 6;
  const visibleItems = showAllItems ? dedupedItems : dedupedItems.slice(0, INLINE_LIMIT);
  const hiddenCount = Math.max(0, dedupedItems.length - INLINE_LIMIT);

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm">
      {/* Conversational header — the natural language title */}
      <button
        onClick={onToggle}
        className="w-full text-left px-3 py-2.5 hover:bg-gray-50/50 transition"
      >
        <div className="flex items-start gap-2.5">
          <span className={`w-2 h-2 rounded-full ${c.dot} flex-shrink-0 mt-[7px]`} />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-gray-800 leading-snug">
              {action.conversationalTitle || action.title}
            </div>

            {/* Inline deduplicated entity tags */}
            {hasItems && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {visibleItems.map((item) => (
                  <ItemTag
                    key={item.name}
                    item={item}
                    isExpandedInline={expandedItemName === item.name}
                    onToggleDetail={(e) => {
                      e.stopPropagation();
                      setExpandedItemName(expandedItemName === item.name ? null : item.name);
                    }}
                  />
                ))}
                {!showAllItems && hiddenCount > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowAllItems(true); }}
                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 font-medium transition"
                  >
                    +{hiddenCount} more
                  </button>
                )}
                {showAllItems && hiddenCount > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowAllItems(false); }}
                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] text-gray-400 hover:text-gray-600 hover:bg-gray-50 font-medium transition"
                  >
                    Show less
                  </button>
                )}
              </div>
            )}

            {/* Expanded detail for a specific item (when count badge is clicked) */}
            {expandedItemName && (
              <ItemDetailPopover
                item={dedupedItems.find(d => d.name === expandedItemName)}
                onClose={(e) => { e.stopPropagation(); setExpandedItemName(null); }}
              />
            )}

            {/* Tags row */}
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${c.bg} ${c.accent}`}>
                {action.severity}
              </span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-gray-100 text-gray-400">
                {effortLabels[action.effort] || action.effort}
              </span>
              {action.tier === "pro" && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-violet-100 text-violet-600">
                  PRO
                </span>
              )}
            </div>
          </div>
          <ChevronIcon rotated={isExpanded} className="flex-shrink-0 mt-1 text-gray-300" />
        </div>
      </button>

      {/* Expanded detail panel */}
      {isExpanded && (
        <div className="px-3 pb-3 border-t border-gray-100 bg-gray-50/30">
          {/* Why this matters */}
          {action.rationale && (
            <div className="mt-2 p-2 rounded bg-indigo-50/50 border border-indigo-100">
              <p className="text-[11px] text-indigo-700 leading-relaxed">
                {action.rationale}
              </p>
            </div>
          )}

          {/* How to fix */}
          {action.steps.length > 0 && (
            <div className="mt-2.5">
              <h5 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                How to fix
              </h5>
              <ol className="space-y-1">
                {action.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px] text-gray-600 leading-relaxed">
                    <span className="w-4 h-4 rounded-full bg-gray-200 text-gray-500 text-[9px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Code snippet */}
          {action.snippet && (
            <div className="mt-2.5">
              <h5 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Example</h5>
              <pre className="text-[11px] text-gray-700 bg-gray-100 rounded-md p-2.5 overflow-x-auto leading-relaxed font-mono whitespace-pre-wrap">
                {action.snippet}
              </pre>
            </div>
          )}

          {/* Docs link */}
          {action.docs && (
            <a
              href={action.docs}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-700 mt-2 no-underline"
            >
              View documentation
              <ExternalLinkIcon />
            </a>
          )}
        </div>
      )}
    </div>
  );
}


/**
 * ItemTag — a single deduplicated item tag with an optional count badge.
 * Clicking the count badge reveals detail about each occurrence.
 */
function ItemTag({ item, isExpandedInline, onToggleDetail }) {
  return (
    <span className="inline-flex items-center rounded border border-gray-200 bg-gray-100 overflow-hidden">
      <span className="px-1.5 py-0.5 text-[11px] font-mono text-gray-600">
        {item.name}
      </span>
      {item.count > 1 && (
        <button
          onClick={onToggleDetail}
          className={`px-1 py-0.5 text-[10px] font-semibold border-l border-gray-200 transition
            ${isExpandedInline
              ? "bg-indigo-100 text-indigo-600"
              : "bg-gray-50 text-gray-400 hover:bg-indigo-50 hover:text-indigo-500"}`}
          title={`${item.count} occurrences — click for details`}
        >
          ×{item.count}
        </button>
      )}
    </span>
  );
}


/**
 * ItemDetailPopover — shows a useful summary when a count badge is clicked.
 * Instead of repeating the same warning message N times, shows:
 *   - How many times the event fired with this issue
 *   - The underlying problem (once, not repeated)
 */
function ItemDetailPopover({ item, onClose }) {
  if (!item) return null;

  // All occurrences of the same name have the same detail — grab it once
  const detail = item.occurrences[0]?.detail || item.occurrences[0]?.message || "";

  return (
    <div
      className="mt-2 p-2.5 rounded-md bg-white border border-gray-200 shadow-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] font-semibold text-gray-700">
          <span className="font-mono">{item.name}</span>
        </span>
        <button
          onClick={onClose}
          className="w-4 h-4 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-600 transition text-[10px]"
        >
          ✕
        </button>
      </div>
      <p className="text-[11px] text-gray-500 leading-relaxed">
        This event fired <strong className="text-gray-700">{item.count} time{item.count !== 1 ? "s" : ""}</strong> during
        this session, and each time the same issue was present:
      </p>
      <div className="mt-1.5 p-2 rounded bg-gray-50 border border-gray-100">
        <p className="text-[11px] text-gray-600 leading-relaxed">
          {detail}
        </p>
      </div>
    </div>
  );
}


// ──────────────────────────────────────────────
// ActionCard — standard rendering for medium/high
// ──────────────────────────────────────────────

function ActionCard({ action, isExpanded, onToggle }) {
  const severityColors = {
    error:   { border: "border-l-red-400",   badge: "bg-red-100 text-red-700",     num: "bg-red-500" },
    warning: { border: "border-l-amber-400", badge: "bg-amber-100 text-amber-700", num: "bg-amber-500" },
    info:    { border: "border-l-violet-400",  badge: "bg-violet-100 text-violet-700",   num: "bg-violet-500" },
  };

  const effortLabels = { quick: "Quick fix", medium: "Moderate effort", large: "Major project" };
  const c = severityColors[action.severity] || severityColors.info;

  return (
    <div className={`rounded-lg border border-gray-200 border-l-[3px] ${c.border} bg-white overflow-hidden shadow-sm`}>
      <button
        onClick={onToggle}
        className="w-full text-left px-3 py-2.5 hover:bg-gray-50/50 transition"
      >
        <div className="flex items-start gap-2.5">
          <span className={`w-5 h-5 rounded-full ${c.num} text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5`}>
            {action.priority}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${c.badge}`}>
                {action.severity}
              </span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-gray-100 text-gray-400">
                {action.theme}
              </span>
              {action.effort && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-gray-50 text-gray-400 border border-gray-100">
                  {effortLabels[action.effort] || action.effort}
                </span>
              )}
              {action.tier === "pro" && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-violet-100 text-violet-600">
                  PRO
                </span>
              )}
              {action.occurrences > 1 && (
                <span className="text-[9px] text-gray-400">×{action.occurrences}</span>
              )}
            </div>
            <div className="text-[13px] font-semibold text-gray-800 leading-snug">
              {action.title}
            </div>
          </div>
          <ChevronIcon rotated={isExpanded} className="flex-shrink-0 mt-1 text-gray-300" />
        </div>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 border-t border-gray-100 bg-gray-50/30">
          {/* Risk rationale */}
          {action.rationale && (
            <div className="mt-2 p-2 rounded bg-indigo-50/50 border border-indigo-100">
              <p className="text-[11px] text-indigo-700 leading-relaxed">
                <strong>Why this risk level:</strong> {action.rationale}
              </p>
            </div>
          )}

          {/* Description */}
          {action.description && (
            <p className="text-[12px] text-gray-500 leading-relaxed mt-2">{action.description}</p>
          )}

          {/* Steps */}
          {action.steps.length > 0 && (
            <div className="mt-2.5">
              <h5 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                How to fix
              </h5>
              <ol className="space-y-1">
                {action.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px] text-gray-600 leading-relaxed">
                    <span className="w-4 h-4 rounded-full bg-gray-200 text-gray-500 text-[9px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Code snippet */}
          {action.snippet && (
            <div className="mt-2.5">
              <h5 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Example</h5>
              <pre className="text-[11px] text-gray-700 bg-gray-100 rounded-md p-2.5 overflow-x-auto leading-relaxed font-mono whitespace-pre-wrap">
                {action.snippet}
              </pre>
            </div>
          )}

          {/* Docs link */}
          {action.docs && (
            <a
              href={action.docs}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-700 mt-2 no-underline"
            >
              View documentation
              <ExternalLinkIcon />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
