import React from "react";

export default function Tabs({ tabs, activeTab, onTabChange, counts }) {
  return (
    <div className="flex border-b-2 border-gray-200 mb-3">
      {tabs.map(tab => {
        const isActive = tab.id === activeTab;
        const count = counts?.[tab.id];
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`
              px-4 py-2 text-[13px] font-medium -mb-[2px] border-b-2 transition-colors
              ${isActive
                ? "text-indigo-600 border-indigo-500"
                : "text-gray-400 border-transparent hover:text-gray-600"
              }
            `}
          >
            {tab.label}
            {count !== undefined && count > 0 && (
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                isActive ? "bg-indigo-100 text-indigo-600" : "bg-violet-50 text-violet-400"
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
