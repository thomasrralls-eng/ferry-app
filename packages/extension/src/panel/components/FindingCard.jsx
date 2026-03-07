import React, { useState } from "react";

const SEVERITY_STYLES = {
  error:   { bg: "bg-red-50",    border: "border-l-red-500",    badge: "bg-red-100 text-red-700" },
  warning: { bg: "bg-amber-50",  border: "border-l-amber-500",  badge: "bg-amber-100 text-amber-700" },
  info:    { bg: "bg-violet-50", border: "border-l-violet-400", badge: "bg-violet-100 text-violet-700" },
};

const CATEGORY_LABELS = {
  "ingestion":  "Ingestion Failure",
  "not-set":    "(not set) Risk",
  "schema":     "Schema Violation",
  "limits":     "Limit Exceeded",
  "google-ads": "Google Ads",
  "quality":    "Best Practice",
  "gtm":        "GTM Configuration",
};

/**
 * GroupedFindingCard — renders a single finding type that may have
 * multiple occurrences. Shows the rule once with a count badge,
 * and expands to list the specific events that triggered it.
 */
export function GroupedFindingCard({ ruleId, findings }) {
  const [expanded, setExpanded] = useState(false);

  const representative = findings[0];
  const count = findings.length;
  const s = SEVERITY_STYLES[representative.severity] || SEVERITY_STYLES.info;

  // Extract unique entity names from the findings for the summary
  const entityNames = [];
  const seen = new Set();
  for (const f of findings) {
    const match = (f.message || "").match(/"([^"]+)"/);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      entityNames.push(match[1]);
    }
  }

  // Group occurrences by entity name with counts
  const entityCounts = {};
  for (const f of findings) {
    const match = (f.message || "").match(/"([^"]+)"/);
    const name = match ? match[1] : "(unknown)";
    if (!entityCounts[name]) entityCounts[name] = { count: 0, eventIndices: [] };
    entityCounts[name].count++;
    if (f.eventIndex !== undefined) entityCounts[name].eventIndices.push(f.eventIndex);
  }
  const entities = Object.entries(entityCounts).sort((a, b) => b[1].count - a[1].count);

  return (
    <div className={`${s.bg} rounded-lg border-l-[3px] ${s.border} mb-2 shadow-sm overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-3 hover:brightness-[0.98] transition"
      >
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${s.badge}`}>
            {representative.severity}
          </span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
            {CATEGORY_LABELS[representative.category] || representative.category}
          </span>
          {count > 1 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-200 text-gray-600">
              ×{count}
            </span>
          )}
          <svg
            className={`w-3.5 h-3.5 text-gray-400 ml-auto transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Show the rule message (using representative) */}
        <div className="text-[13px] font-semibold text-gray-900 leading-snug">
          {representative.message}
          {count > 1 && entityNames.length > 1 && (
            <span className="text-gray-400 font-normal text-[12px]">
              {" "}and {entityNames.length - 1} other{entityNames.length - 1 !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {representative.detail && (
          <div className="text-[12px] text-gray-500 leading-relaxed mt-1">{representative.detail}</div>
        )}
      </button>

      {/* Expanded: show which events/entities triggered this finding */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-200/50">
          {/* Entity list */}
          {entities.length > 0 && (
            <div className="mt-2 space-y-1">
              {entities.map(([name, data]) => (
                <div key={name} className="flex items-center gap-2 py-1 px-2 rounded bg-white/60">
                  <span className="text-[11px] font-mono text-gray-700 flex-1 min-w-0 truncate">
                    {name}
                  </span>
                  {data.count > 1 && (
                    <span className="text-[10px] font-semibold text-gray-400 flex-shrink-0">
                      ×{data.count}
                    </span>
                  )}
                  {data.eventIndices.length > 0 && (
                    <span className="text-[10px] text-gray-400 flex-shrink-0">
                      event{data.eventIndices.length > 1 ? "s" : ""} #{data.eventIndices.map(i => i + 1).slice(0, 5).join(", ")}
                      {data.eventIndices.length > 5 ? "..." : ""}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Docs link */}
          {representative.docs && (
            <a
              href={representative.docs}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-700 mt-2 no-underline"
            >
              View documentation
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Original FindingCard — kept for backward compatibility,
 * but the Findings tab now uses GroupedFindingCard.
 */
export default function FindingCard({ finding }) {
  const s = SEVERITY_STYLES[finding.severity] || SEVERITY_STYLES.info;

  return (
    <div className={`${s.bg} rounded-lg border-l-[3px] ${s.border} p-3 mb-2 shadow-sm`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${s.badge}`}>
          {finding.severity}
        </span>
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
          {CATEGORY_LABELS[finding.category] || finding.category}
        </span>
        {finding.eventIndex !== undefined && (
          <span className="text-[10px] text-gray-400 ml-auto">Event #{finding.eventIndex + 1}</span>
        )}
      </div>
      <div className="text-[13px] font-semibold text-gray-900 leading-snug">{finding.message}</div>
      {finding.detail && (
        <div className="text-[12px] text-gray-500 leading-relaxed mt-1">{finding.detail}</div>
      )}
      {finding.docs && (
        <a
          href={finding.docs}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-700 mt-1.5 no-underline"
        >
          View documentation
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}
    </div>
  );
}
