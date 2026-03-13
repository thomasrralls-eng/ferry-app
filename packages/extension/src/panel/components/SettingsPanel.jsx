/**
 * SettingsPanel.jsx — Domain agent configuration UI
 *
 * Lets users:
 *   1. Sign in / out with their Google account
 *   2. Create and manage domain agents (one per client site)
 *   3. Configure GA4 Property ID, GTM Container ID, BQ dataset
 *   4. Upload a service account JSON key for each domain
 *   5. Test connectivity to GA4/GTM/BigQuery
 *   6. Select the active domain agent used for enriched scan analysis
 */

import React, { useState, useRef } from "react";

// ── Status badge ──────────────────────────────────────────────────────────────
function ConnectionBadge({ ok, label }) {
  if (ok === null || ok === undefined) {
    return (
      <span className="text-[10px] font-medium text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">
        {label} —
      </span>
    );
  }
  return ok ? (
    <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
      {label} ✓
    </span>
  ) : (
    <span className="text-[10px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
      {label} ✗
    </span>
  );
}

// ── Domain row ─────────────────────────────────────────────────────────────────
function DomainRow({ domain, isActive, onSelect, onEdit }) {
  return (
    <button
      onClick={() => onSelect(domain.domainId)}
      className={`w-full text-left px-3 py-2 rounded-lg border transition-all ${
        isActive
          ? "bg-indigo-50 border-indigo-200 text-indigo-800"
          : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] font-semibold">{domain.displayName || domain.hostname}</p>
          <p className="text-[10px] text-slate-500">{domain.hostname}</p>
        </div>
        <div className="flex items-center gap-1">
          {isActive && (
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" title="Active" />
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(domain); }}
            className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition"
            title="Configure"
          >
            ✏
          </button>
        </div>
      </div>
      <div className="flex gap-1 mt-1 flex-wrap">
        <ConnectionBadge ok={domain.ga4Connected || null} label="GA4" />
        <ConnectionBadge ok={domain.gtmConnected || null} label="GTM" />
        <ConnectionBadge ok={domain.bqConnected || null} label="BQ" />
        {domain.agentContext?.businessType && (
          <span className="text-[10px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 rounded px-1.5 py-0.5">
            {domain.agentContext.businessType}
          </span>
        )}
      </div>
    </button>
  );
}

const BUSINESS_TYPES = [
  { value: "", label: "— Select type —" },
  { value: "ecommerce", label: "Ecommerce" },
  { value: "b2b-saas", label: "B2B SaaS" },
  { value: "b2c-saas", label: "B2C SaaS" },
  { value: "lead-gen", label: "Lead Generation" },
  { value: "media", label: "Media / Publisher" },
  { value: "other", label: "Other" },
];

// ── Domain editor form ─────────────────────────────────────────────────────────
function DomainEditor({ domain, onSave, onCancel, onUploadSA, onTestConnection, onRemoveSA, loading }) {
  const isNew = !domain?.domainId;
  const [form, setForm] = useState({
    hostname: domain?.hostname || "",
    displayName: domain?.displayName || "",
    ga4PropertyId: domain?.ga4PropertyId || "",
    gtmContainerId: domain?.gtmContainerId || "",
    bqProjectId: domain?.bqProjectId || "",
    bqDataset: domain?.bqDataset || "",
    // Agent context fields
    agentBusinessType: domain?.agentContext?.businessType || "",
    agentDescription: domain?.agentContext?.businessDescription || "",
    agentKeyEvents: (domain?.agentContext?.keyEvents || []).join(", "),
    agentFunnelStages: (domain?.agentContext?.funnelStages || []).join("\n"),
    agentNotes: domain?.agentContext?.notes || "",
  });
  const [testResult, setTestResult] = useState(null);
  const [testLoading, setTestLoading] = useState(false);
  const fileRef = useRef(null);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSave = () => {
    const agentContext = {
      businessType: form.agentBusinessType || null,
      businessDescription: form.agentDescription.trim() || null,
      keyEvents: form.agentKeyEvents
        ? form.agentKeyEvents.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
      funnelStages: form.agentFunnelStages
        ? form.agentFunnelStages.split("\n").map((s) => s.trim()).filter(Boolean)
        : [],
      notes: form.agentNotes.trim() || null,
    };
    onSave({ ...form, agentContext }, domain?.domainId);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    await onUploadSA(domain?.domainId, text);
    fileRef.current.value = "";
  };

  const handleTest = async () => {
    setTestLoading(true);
    setTestResult(null);
    try {
      const result = await onTestConnection(domain?.domainId);
      setTestResult(result);
    } catch (err) {
      setTestResult({ error: err.message });
    } finally {
      setTestLoading(false);
    }
  };

  const inputClass =
    "w-full px-2.5 py-1.5 text-[12px] border border-slate-200 rounded-md bg-white text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-300";

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
      <h3 className="text-[12px] font-bold text-slate-700">
        {isNew ? "Add Domain Agent" : `Configure: ${domain.hostname}`}
      </h3>

      {/* Hostname */}
      {isNew && (
        <div>
          <label className="text-[11px] font-medium text-slate-500 block mb-0.5">Hostname</label>
          <input
            className={inputClass}
            placeholder="acmecorp.com"
            value={form.hostname}
            onChange={update("hostname")}
          />
        </div>
      )}

      {/* Display name */}
      <div>
        <label className="text-[11px] font-medium text-slate-500 block mb-0.5">Display name (optional)</label>
        <input
          className={inputClass}
          placeholder="Acme Corp"
          value={form.displayName}
          onChange={update("displayName")}
        />
      </div>

      {/* GA4 Property ID */}
      <div>
        <label className="text-[11px] font-medium text-slate-500 block mb-0.5">
          GA4 Property ID <span className="text-slate-400">(numeric, e.g. 123456789)</span>
        </label>
        <input
          className={inputClass}
          placeholder="123456789"
          value={form.ga4PropertyId}
          onChange={update("ga4PropertyId")}
        />
      </div>

      {/* GTM Container ID */}
      <div>
        <label className="text-[11px] font-medium text-slate-500 block mb-0.5">GTM Container ID</label>
        <input
          className={inputClass}
          placeholder="GTM-XXXXXX"
          value={form.gtmContainerId}
          onChange={update("gtmContainerId")}
        />
      </div>

      {/* BigQuery (optional) */}
      <div>
        <label className="text-[11px] font-medium text-slate-500 block mb-0.5">
          BigQuery — GA4 360 Export <span className="text-slate-400">(optional)</span>
        </label>
        <div className="flex gap-1.5">
          <input
            className={inputClass}
            placeholder="gcp-project-id"
            value={form.bqProjectId}
            onChange={update("bqProjectId")}
          />
          <input
            className={inputClass}
            placeholder="analytics_123456789"
            value={form.bqDataset}
            onChange={update("bqDataset")}
          />
        </div>
      </div>

      {/* ── Agent Context ───────────────────────────────────────────────── */}
      <div className="border-t border-slate-200 pt-3">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-[11px] font-bold text-slate-600">Agent Context</span>
          <span className="text-[10px] text-slate-400 font-normal">
            — helps data fairy personalise analysis and learn across clients
          </span>
        </div>

        {/* Business type */}
        <div className="mb-2">
          <label className="text-[11px] font-medium text-slate-500 block mb-0.5">
            Business type
          </label>
          <select
            className={inputClass}
            value={form.agentBusinessType}
            onChange={update("agentBusinessType")}
          >
            {BUSINESS_TYPES.map((bt) => (
              <option key={bt.value} value={bt.value}>{bt.label}</option>
            ))}
          </select>
        </div>

        {/* Business description */}
        <div className="mb-2">
          <label className="text-[11px] font-medium text-slate-500 block mb-0.5">
            Description <span className="text-slate-400">(optional — e.g. "SaaS CRM, free trial → upgrade funnel")</span>
          </label>
          <textarea
            className={`${inputClass} resize-none`}
            rows={2}
            placeholder="Brief description of the client's business model and key goals"
            value={form.agentDescription}
            onChange={update("agentDescription")}
          />
        </div>

        {/* Key events */}
        <div className="mb-2">
          <label className="text-[11px] font-medium text-slate-500 block mb-0.5">
            Key conversion events <span className="text-slate-400">(comma-separated GA4 event names)</span>
          </label>
          <input
            className={inputClass}
            placeholder="purchase, generate_lead, trial_start, upgrade"
            value={form.agentKeyEvents}
            onChange={update("agentKeyEvents")}
          />
        </div>

        {/* Funnel stages */}
        <div className="mb-2">
          <label className="text-[11px] font-medium text-slate-500 block mb-0.5">
            Funnel stages <span className="text-slate-400">(one per line, in order)</span>
          </label>
          <textarea
            className={`${inputClass} resize-none`}
            rows={3}
            placeholder={"Homepage\nProduct page\nCart\nCheckout\nConfirmation"}
            value={form.agentFunnelStages}
            onChange={update("agentFunnelStages")}
          />
        </div>

        {/* Notes */}
        <div>
          <label className="text-[11px] font-medium text-slate-500 block mb-0.5">
            Notes for data fairy <span className="text-slate-400">(migration history, known quirks, etc.)</span>
          </label>
          <textarea
            className={`${inputClass} resize-none`}
            rows={2}
            placeholder="e.g. Recently migrated from UA. Mobile checkout has known missing purchase event."
            value={form.agentNotes}
            onChange={update("agentNotes")}
          />
        </div>
      </div>

      {/* Save / Cancel */}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={loading}
          className="flex-1 py-1.5 text-[12px] font-semibold text-white bg-indigo-500 rounded-md hover:bg-indigo-600 disabled:opacity-50 transition"
        >
          {isNew ? "Create Agent" : "Save Changes"}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-[12px] font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition"
        >
          Cancel
        </button>
      </div>

      {/* Service account (only for existing domains) */}
      {!isNew && (
        <>
          <div className="border-t border-slate-200 pt-3">
            <label className="text-[11px] font-bold text-slate-600 block mb-1.5">
              Service Account JSON Key
            </label>

            {domain.saKeyEmail ? (
              <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-2">
                <div>
                  <p className="text-[11px] font-semibold text-emerald-700">Key uploaded</p>
                  <p className="text-[10px] text-emerald-600 font-mono">{domain.saKeyEmail}</p>
                </div>
                <button
                  onClick={() => onRemoveSA(domain.domainId)}
                  className="text-[10px] text-red-500 hover:text-red-700 font-medium"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                <p className="text-[11px] text-amber-700">
                  No key uploaded. Create a service account in the client's GCP project with
                  read-only access to their GA4/GTM/BigQuery, then upload the JSON key here.
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <label className="flex-1 cursor-pointer py-1.5 text-[12px] font-medium text-center text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition">
                📁 {domain.saKeyEmail ? "Replace JSON Key" : "Upload JSON Key"}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </label>
              {domain.ga4PropertyId || domain.gtmContainerId ? (
                <button
                  onClick={handleTest}
                  disabled={!domain.saKeySecretId || testLoading}
                  className="px-3 py-1.5 text-[12px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-md hover:bg-indigo-100 disabled:opacity-40 transition"
                >
                  {testLoading ? "Testing…" : "Test Connection"}
                </button>
              ) : null}
            </div>

            {/* Test results */}
            {testResult && !testResult.error && (
              <div className="flex gap-1.5 mt-2">
                {testResult.ga4 && (
                  <ConnectionBadge ok={testResult.ga4.ok} label="GA4" />
                )}
                {testResult.gtm && (
                  <ConnectionBadge ok={testResult.gtm.ok} label="GTM" />
                )}
                {testResult.bq && (
                  <ConnectionBadge ok={testResult.bq.ok} label="BQ" />
                )}
              </div>
            )}
            {testResult?.error && (
              <p className="text-[10px] text-red-600 mt-1">{testResult.error}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main SettingsPanel ─────────────────────────────────────────────────────────
export default function SettingsPanel({
  user,
  domains,
  activeDomainId,
  loading,
  error,
  onSignIn,
  onSignOut,
  onSetActiveDomain,
  onCreateDomain,
  onUpdateDomainConfig,
  onDeleteDomain,
  onUploadSA,
  onRemoveSA,
  onTestConnection,
}) {
  const [editingDomain, setEditingDomain] = useState(null); // null = list; false = new form; object = edit form
  const [localError, setLocalError] = useState(null);

  const handleSave = async (form, domainId) => {
    setLocalError(null);

    // Build the config payload (always includes agentContext)
    const configPayload = {
      ga4PropertyId: form.ga4PropertyId || null,
      gtmContainerId: form.gtmContainerId || null,
      bqProjectId: form.bqProjectId || null,
      bqDataset: form.bqDataset || null,
      displayName: form.displayName || null,
      agentContext: form.agentContext || null,
    };

    try {
      if (!domainId) {
        // Create new domain
        const domain = await onCreateDomain({
          hostname: form.hostname,
          displayName: form.displayName,
        });
        // Immediately apply all config (IDs + agent context)
        await onUpdateDomainConfig(domain.domainId, configPayload);
        onSetActiveDomain(domain.domainId);
      } else {
        await onUpdateDomainConfig(domainId, configPayload);
      }
      setEditingDomain(null);
    } catch (err) {
      setLocalError(err.message);
    }
  };

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 text-center gap-4">
        <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center text-2xl">
          🔑
        </div>
        <div>
          <p className="text-[13px] font-semibold text-slate-700 mb-1">Connect your Google account</p>
          <p className="text-[11px] text-slate-500">
            Sign in to link GA4 properties, GTM containers, and BigQuery datasets to your domain agents.
          </p>
        </div>
        {error && <p className="text-[11px] text-red-600">{error}</p>}
        <button
          onClick={onSignIn}
          disabled={loading}
          className="px-5 py-2 text-[12px] font-semibold text-white bg-indigo-500 rounded-lg hover:bg-indigo-600 disabled:opacity-50 transition shadow-sm flex items-center gap-2"
        >
          {loading ? "Connecting…" : "Sign in with Google"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-6">
      {/* Account header */}
      <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
        <div className="flex items-center gap-2">
          {user.picture ? (
            <img src={user.picture} alt="" className="w-6 h-6 rounded-full" />
          ) : (
            <div className="w-6 h-6 rounded-full bg-indigo-200 flex items-center justify-center text-[10px] font-bold text-indigo-700">
              {user.email?.[0]?.toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-[11px] font-semibold text-slate-700">{user.name || user.email}</p>
            <p className="text-[10px] text-slate-500">{user.email}</p>
          </div>
        </div>
        <button
          onClick={onSignOut}
          className="text-[10px] text-slate-500 hover:text-red-500 font-medium transition"
        >
          Sign out
        </button>
      </div>

      {/* Error */}
      {(localError || error) && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <p className="text-[11px] text-red-700">{localError || error}</p>
        </div>
      )}

      {/* Domain list or editor */}
      {editingDomain === null ? (
        <>
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Domain Agents
              </h3>
              <button
                onClick={() => setEditingDomain(false)}
                className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700"
              >
                + Add Domain
              </button>
            </div>

            {domains.length === 0 ? (
              <div className="text-center py-6 bg-slate-50 border border-dashed border-slate-200 rounded-xl">
                <p className="text-[12px] text-slate-500 mb-3">No domain agents yet</p>
                <button
                  onClick={() => setEditingDomain(false)}
                  className="px-4 py-1.5 text-[12px] font-semibold text-white bg-indigo-500 rounded-lg hover:bg-indigo-600 transition"
                >
                  Add your first domain
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                {domains.map((d) => (
                  <DomainRow
                    key={d.domainId}
                    domain={d}
                    isActive={d.domainId === activeDomainId}
                    onSelect={onSetActiveDomain}
                    onEdit={setEditingDomain}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Active domain info */}
          {activeDomainId && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2">
              <p className="text-[11px] text-indigo-700">
                <span className="font-bold">Active agent:</span>{" "}
                {domains.find((d) => d.domainId === activeDomainId)?.displayName || activeDomainId}
                {" — "}enriched analysis will run automatically after site scans.
              </p>
            </div>
          )}
        </>
      ) : (
        <DomainEditor
          domain={editingDomain || null}
          loading={loading}
          onSave={handleSave}
          onCancel={() => { setEditingDomain(null); setLocalError(null); }}
          onUploadSA={onUploadSA}
          onRemoveSA={onRemoveSA}
          onTestConnection={onTestConnection}
        />
      )}

      {/* Setup instructions */}
      <details className="bg-slate-50 border border-slate-200 rounded-xl">
        <summary className="px-3 py-2 text-[11px] font-semibold text-slate-600 cursor-pointer">
          How to set up a service account
        </summary>
        <div className="px-3 pb-3 space-y-1.5">
          <ol className="text-[11px] text-slate-600 space-y-1 list-decimal list-inside">
            <li>Open <strong>Google Cloud Console</strong> in the client's GCP project</li>
            <li>Go to <strong>IAM &amp; Admin → Service Accounts</strong> → Create</li>
            <li>Name it something like <code className="bg-slate-200 px-1 rounded">fairy-reader</code></li>
            <li>Grant roles: <code className="bg-slate-200 px-1 rounded">Viewer</code> on GA4, <code className="bg-slate-200 px-1 rounded">Tag Manager Read-Only</code> on GTM</li>
            <li>For BigQuery: grant <code className="bg-slate-200 px-1 rounded">BigQuery Data Viewer</code> on their analytics dataset</li>
            <li>Create a JSON key → download → upload here</li>
          </ol>
        </div>
      </details>
    </div>
  );
}
