import React from "react";

export default function EmptyState({ icon, title, subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon && <div className="text-4xl mb-3">{icon}</div>}
      <div className="text-[14px] font-medium text-slate-500">{title}</div>
      {subtitle && <div className="text-[12px] text-slate-400 mt-1 max-w-xs">{subtitle}</div>}
    </div>
  );
}
