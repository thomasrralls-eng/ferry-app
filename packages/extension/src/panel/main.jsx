import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "16px", fontFamily: "monospace" }}>
          <p style={{ fontWeight: 600, color: "#dc2626", marginBottom: 8 }}>Something went wrong</p>
          <pre style={{ fontSize: "11px", color: "#7f1d1d", background: "#fef2f2", padding: 8, borderRadius: 4, overflow: "auto", marginBottom: 8 }}>
            {this.state.error.message}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ fontSize: 12, padding: "4px 10px", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Mount React immediately — don't block on rules loading
const root = createRoot(document.getElementById("root"));
root.render(<ErrorBoundary><App /></ErrorBoundary>);

// Load the lint rules engine (sets window.FerryLint) in background
try {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("rules/index.js");
  script.onerror = (e) => console.warn("[Ferry] Rules engine failed to load:", e);
  document.head.appendChild(script);
} catch (e) {
  console.warn("[Ferry] Could not load rules engine:", e);
}
