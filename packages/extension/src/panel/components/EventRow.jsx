import React, { useState } from "react";

/**
 * GroupedEventRow — renders a group of events that share the same name.
 * Shows the name once with a count, and expands to list individual occurrences.
 */
export function GroupedEventRow({ eventName, events, allFindings }) {
  const [expanded, setExpanded] = useState(false);
  const [expandedChild, setExpandedChild] = useState(null);

  const count = events.length;
  const source = events[0].event?.source || events[0].event?.type || "";

  // Aggregate findings across all events in this group
  const totalErrors = events.reduce((sum, e) => sum + e.findings.filter(f => f.severity === "error").length, 0);
  const totalWarnings = events.reduce((sum, e) => sum + e.findings.filter(f => f.severity === "warning").length, 0);

  return (
    <div className="bg-white rounded-lg border border-gray-200 mb-1.5 shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-2.5 hover:bg-violet-50/30 transition-colors"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[13px] font-semibold text-gray-900 truncate">{eventName}</span>
            {count > 1 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-200 text-gray-600 flex-shrink-0">
                ×{count}
              </span>
            )}
            {source && (
              <span className="text-[11px] text-gray-400 flex-shrink-0">{source}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {totalErrors > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700">
                {totalErrors} error{totalErrors > 1 ? "s" : ""}
              </span>
            )}
            {totalWarnings > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700">
                {totalWarnings} warn{totalWarnings > 1 ? "s" : ""}
              </span>
            )}
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100">
          {events.map((entry, i) => {
            const evt = entry.event;
            const idx = entry.originalIndex;
            const isChildOpen = expandedChild === i;
            const childErrors = entry.findings.filter(f => f.severity === "error").length;
            const childWarnings = entry.findings.filter(f => f.severity === "warning").length;

            return (
              <div key={i} className="border-b border-gray-50 last:border-b-0">
                <button
                  onClick={(e) => { e.stopPropagation(); setExpandedChild(isChildOpen ? null : i); }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50/50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[11px] text-gray-500">
                      <span className="text-gray-300 font-mono">#{idx + 1}</span>
                      <span>{evt.source || ""}{evt.type ? ` · ${evt.type}` : ""}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {childErrors > 0 && (
                        <span className="w-2 h-2 rounded-full bg-red-400" title={`${childErrors} error(s)`} />
                      )}
                      {childWarnings > 0 && (
                        <span className="w-2 h-2 rounded-full bg-amber-400" title={`${childWarnings} warning(s)`} />
                      )}
                      <svg
                        className={`w-3 h-3 text-gray-300 transition-transform ${isChildOpen ? "rotate-180" : ""}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </button>
                {isChildOpen && (
                  <div className="px-3 pb-2">
                    <pre className="bg-gray-50 rounded-md p-2.5 text-[11px] text-gray-700 font-mono overflow-x-auto max-h-48 overflow-y-auto">
                      {JSON.stringify(evt, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


/**
 * Original EventRow — kept for backward compatibility (network tab still uses it).
 */
export default function EventRow({ event, index, findings }) {
  const [open, setOpen] = useState(false);

  const name = event.eventName || event.event || (event.payload?.event) || "(unknown)";
  const source = event.source || "unknown";
  const type = event.type || "";
  const errCount = findings.filter(f => f.severity === "error").length;
  const warnCount = findings.filter(f => f.severity === "warning").length;

  return (
    <div
      className="bg-white rounded-lg border border-gray-200 mb-1.5 shadow-sm cursor-pointer hover:bg-violet-50/30 transition-colors"
      onClick={() => setOpen(!open)}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-gray-900">{name}</span>
          <span className="text-[11px] text-gray-400">{source} · {type}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {errCount > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700">
              {errCount} error{errCount > 1 ? "s" : ""}
            </span>
          )}
          {warnCount > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700">
              {warnCount} warn{warnCount > 1 ? "s" : ""}
            </span>
          )}
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
      {open && (
        <div className="px-3 pb-3">
          <pre className="bg-gray-50 rounded-md p-2.5 text-[11px] text-gray-700 font-mono overflow-x-auto max-h-64 overflow-y-auto">
            {JSON.stringify(event, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
