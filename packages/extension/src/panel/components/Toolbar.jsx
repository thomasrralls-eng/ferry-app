import React from "react";

export default function Toolbar({ recording, onStart, onStop, onExport, onClear }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {!recording ? (
        <button
          onClick={onStart}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gradient-to-r from-indigo-500 to-indigo-600 text-white text-[13px] font-medium hover:from-indigo-600 hover:to-indigo-700 active:from-indigo-700 active:to-indigo-800 transition-all shadow-sm"
        >
          <span className="w-2 h-2 rounded-full bg-red-400" />
          Record
        </button>
      ) : (
        <button
          onClick={onStop}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gray-700 text-white text-[13px] font-medium hover:bg-gray-800 active:bg-gray-900 transition-colors shadow-sm"
        >
          <span className="w-2 h-2 rounded-sm bg-white" />
          Stop
        </button>
      )}

      <button
        onClick={onExport}
        className="px-3 py-1.5 rounded-md bg-white border border-gray-200 text-[13px] font-medium text-gray-700 hover:bg-indigo-50/50 hover:border-indigo-200/50 active:bg-indigo-100/50 transition-colors shadow-sm"
      >
        Export
      </button>

      <button
        onClick={onClear}
        className="px-3 py-1.5 rounded-md bg-white border border-gray-200 text-[13px] font-medium text-gray-700 hover:bg-indigo-50/50 hover:border-indigo-200/50 active:bg-indigo-100/50 transition-colors shadow-sm"
      >
        Clear
      </button>

      {recording && (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 border border-red-200 text-[11px] font-semibold text-red-600">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse-dot" />
          Recording
        </span>
      )}
    </div>
  );
}
