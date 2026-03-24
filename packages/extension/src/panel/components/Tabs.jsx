import React from "react";

export default function Tabs({ tabs, activeTab, onTabChange, counts }) {
  return (
    <div className="flex border-b border-slate-200 mb-3">
      {tabs.map(tab => {
        const isActive = tab.id === activeTab;
        const count = counts?.[tab.id];
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`
              px-3 py-2 text-[12px] font-medium -mb-px border-b-2 transition-colors
              ${isActive
                ? "text-amber-600 border-amber-500"
                : "text-slate-400 border-transparent hover:text-slate-600"
              }
            `}
          >
            {tab.label}
            {count !== undefined && count > 0 && (
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                isActive ? "bg-amber-100 text-amber-600" : "bg-slate-100 text-slate-400"
              }`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
