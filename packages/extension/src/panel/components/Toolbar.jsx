import React from "react";

export default function Toolbar({ recording, onStart, onStop, onExport, onClear }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {!recording ? (
        <button
          onClick={onStart}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 text-white text-[12px] font-semibold hover:bg-indigo-700 active:bg-indigo-800 transition-colors shadow-sm"
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
    </div>
  );
}
