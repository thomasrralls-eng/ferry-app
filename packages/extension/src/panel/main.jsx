import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// Mount React immediately — don't block on rules loading
const root = createRoot(document.getElementById("root"));
root.render(<App />);

// Load the lint rules engine (sets window.FairyLint) in background
try {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("rules/index.js");
  script.onerror = (e) => console.warn("[Ferry] Rules engine failed to load:", e);
  document.head.appendChild(script);
} catch (e) {
  console.warn("[Ferry] Could not load rules engine:", e);
}
