import React from "react";

export default function Toolbar({ recording, onStart, onStop, onExport, onClear, onSettings, hasAgent }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {!recording ? (
        <button
          onClick={onStart}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-500 text-white text-[12px] font-semibold hover:bg-amber-600 active:bg-amber-700 transition-colors shadow-sm"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-red-300" />
          Record
        </button>
      ) : (
        <button
          onClick={onStop}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-700 text-white text-[12px] font-semibold hover:bg-slate-800 active:bg-slate-900 transition-colors shadow-sm"
        >
          <span className="w-1.5 h-1.5 rounded-sm bg-white/80" />
          Stop
        </button>
      )}

      <button
        onClick={onExport}
        className="px-3 py-1.5 rounded-md bg-white border border-slate-200 text-[12px] font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 active:bg-slate-100 transition-colors shadow-sm"
      >
        Export
      </button>

      <button
        onClick={onClear}
        className="px-3 py-1.5 rounded-md bg-white border border-slate-200 text-[12px] font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 active:bg-slate-100 transition-colors shadow-sm"
      >
        Clear
      </button>

      {recording && (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-50 border border-red-200 text-[11px] font-semibold text-red-600">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse-dot" />
          REC
        </span>
      )}

      {/* Settings / Agent gear icon */}
      <button
        onClick={onSettings}
        title="Domain agent settings"
        className={`relative p-1.5 rounded-md border transition-colors ${
          hasAgent
            ? "border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100"
            : "border-slate-200 bg-white text-slate-400 hover:bg-slate-50 hover:text-slate-600"
        }`}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        {hasAgent && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500 border-2 border-white" />
        )}
      </button>
    </div>
  );
}
