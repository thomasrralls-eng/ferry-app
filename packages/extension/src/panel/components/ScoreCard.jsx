import React from "react";

const VARIANTS = {
  events:           { border: "border-l-amber-500",  text: "text-amber-900" },
  eventsWithErrors: { border: "border-l-rose-400",    text: "text-rose-600" },
  errors:           { border: "border-l-red-500",     text: "text-red-600" },
  warnings:         { border: "border-l-amber-500",   text: "text-amber-600" },
  success:          { border: "border-l-emerald-500", text: "text-emerald-600" },
};

export default function ScoreCard({ label, value, subtitle, variant = "events" }) {
  const v = VARIANTS[variant] || VARIANTS.events;
  return (
    <div className={`flex-1 bg-white rounded-lg border border-gray-200 border-l-4 ${v.border} p-3 shadow-sm`}>
      <div className={`text-2xl font-bold leading-tight ${v.text}`}>{value}</div>
      {subtitle && (
        <div className="text-[10px] font-semibold text-gray-400 mt-0.5">{subtitle}</div>
      )}
      <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
}
