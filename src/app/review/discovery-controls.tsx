"use client";

import { useState } from "react";
import { categoryCodes } from "../../lib/taxonomy/categories.ts";
import { DISCOVERY_COUNTIES, DISCOVERY_MAX_PROVIDER_CALLS, DISCOVERY_MAX_QUERY_CELLS, DISCOVERY_MAX_UNIQUE_LEADS } from "../../lib/discovery/query-matrix.ts";

type Cycle = { id: string; completedAt: string };

export function DiscoveryControls({ active, dailyProviderCallCeiling, acceptedCycles }: { active: boolean; dailyProviderCallCeiling?: number; acceptedCycles: Cycle[] }) {
  const [categories, setCategories] = useState<string[]>([categoryCodes[0]]);
  const [counties, setCounties] = useState<string[]>([DISCOVERY_COUNTIES[0]]);
  const [leadCap, setLeadCap] = useState(10);
  const [callBudget, setCallBudget] = useState(20);
  const [rationale, setRationale] = useState("");
  const [owner, setOwner] = useState("");
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const cells = categories.length * counties.length * 2;
  const toggle = (value: string, current: string[], set: (next: string[]) => void) => set(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  const request = async (url: string, body: object, fallback: string) => {
    setBusy(true); setMessage(undefined);
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as { id?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? fallback);
      return result;
    } catch (error) { setMessage(error instanceof Error ? error.message : fallback); return undefined; } finally { setBusy(false); }
  };
  const activate = async (nextActive: boolean) => {
    const result = await request("/api/discovery/activation", {
      active: nextActive, acceptedCycleId: acceptedCycles[0]?.id, dailyProviderCallCeiling: Math.min(DISCOVERY_MAX_PROVIDER_CALLS, Math.max(1, callBudget)), serviceOwnerSubject: owner, rationale
    }, "Could not update discovery activation.");
    if (result) window.location.reload();
  };
  const launch = async () => {
    if (cells > DISCOVERY_MAX_QUERY_CELLS) return setMessage(`Choose at most ${DISCOVERY_MAX_QUERY_CELLS} provider query cells.`);
    const result = await request("/api/runs", { mode: "discovery_only", idempotencyKey: crypto.randomUUID(), categories, counties, uniqueLeadCap: leadCap, providerCallBudget: callBudget }, "Could not start discovery.");
    if (result?.id) window.location.assign(`/review/runs/${result.id}`);
  };
  return <section className="pilot-panel" aria-labelledby="discovery-title">
    <div><p className="eyebrow">Manual canary lane</p><h2 id="discovery-title">Find new resources</h2><p>Discovery is disabled by default. It stages evidence for human review and never writes the source directory.</p></div>
    {!active ? <>
      <p>{acceptedCycles.length ? "Activate only after confirming the completed directory cycle and service-owner approval." : "A completed known-directory cycle is required before discovery can be activated."}</p>
      <label className="resource-search">Service-owner approval subject<input value={owner} onChange={(event) => setOwner(event.target.value)} disabled={busy || !acceptedCycles.length} /></label>
      <label className="resource-search">Activation rationale<textarea value={rationale} onChange={(event) => setRationale(event.target.value)} maxLength={1000} disabled={busy || !acceptedCycles.length} /></label>
      <button type="button" className="primary-button" onClick={() => void activate(true)} disabled={busy || !acceptedCycles.length || !owner.trim() || !rationale.trim()}>Activate manual discovery</button>
    </> : <>
      <p className="availability active">Active · daily call ceiling {dailyProviderCallCeiling}</p>
      <label className="resource-search">Deactivation rationale<input value={rationale} onChange={(event) => setRationale(event.target.value)} maxLength={1000} disabled={busy} /></label>
      <fieldset disabled={busy}><legend>Frozen query matrix ({cells} of {DISCOVERY_MAX_QUERY_CELLS} provider cells)</legend>
        <div className="pilot-resources" role="group" aria-label="Approved categories">{categoryCodes.map((category) => <label key={category} className="pilot-resource"><input type="checkbox" checked={categories.includes(category)} onChange={() => toggle(category, categories, setCategories)} /><span>{category.replace(/_/g, " ")}</span></label>)}</div>
        <div className="pilot-resources" role="group" aria-label="Approved counties">{DISCOVERY_COUNTIES.map((county) => <label key={county} className="pilot-resource"><input type="checkbox" checked={counties.includes(county)} onChange={() => toggle(county, counties, setCounties)} /><span>{county} County</span></label>)}</div>
      </fieldset>
      <label className="resource-search">Unique-lead cap<input type="number" min="1" max={DISCOVERY_MAX_UNIQUE_LEADS} value={leadCap} onChange={(event) => setLeadCap(Number(event.target.value))} disabled={busy} /></label>
      <label className="resource-search">Provider-call budget<input type="number" min={cells} max={Math.min(DISCOVERY_MAX_PROVIDER_CALLS, dailyProviderCallCeiling ?? DISCOVERY_MAX_PROVIDER_CALLS)} value={callBudget} onChange={(event) => setCallBudget(Number(event.target.value))} disabled={busy} /></label>
      <div className="actions"><button type="button" className="primary-button" onClick={() => void launch()} disabled={busy || !categories.length || !counties.length || cells > DISCOVERY_MAX_QUERY_CELLS || callBudget < cells}>Start capped discovery</button><button type="button" onClick={() => void activate(false)} disabled={busy || !rationale.trim()}>Deactivate discovery</button></div>
    </>}
    {message ? <p role="status" className="pilot-message">{message}</p> : null}
  </section>;
}
