"use client";

import { useMemo, useState } from "react";
import { resolveDiscoveryQueryCells, type DiscoveryCounty } from "../../lib/discovery/query-matrix.ts";
import type { CategoryCode } from "../../lib/taxonomy/categories.ts";

type Activation = { active: boolean; acceptedCycleId: string; dailyProviderCallCeiling: number; rationale: string; serviceOwnerApproval: string };

export function DiscoveryControls({ activation, completedCycles, categories, counties, policyVersion }: { activation?: Activation; completedCycles: Array<{ id: string; completedAt: string }>; categories: readonly CategoryCode[]; counties: readonly DiscoveryCounty[]; policyVersion: string }) {
  const [selectedCategories, setSelectedCategories] = useState<string[]>(["food_access"]);
  const [selectedCounties, setSelectedCounties] = useState<string[]>(["Cook"]);
  const [uniqueLeadCap, setUniqueLeadCap] = useState(10);
  const [providerCallBudget, setProviderCallBudget] = useState(40);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const cells = useMemo(() => { try { return resolveDiscoveryQueryCells({ categories: selectedCategories, counties: selectedCounties, maxCells: 10 }); } catch { return []; } }, [selectedCategories, selectedCounties]);
  const toggle = (value: string, current: string[], set: (next: string[]) => void) => set(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);

  const mutateActivation = async (form: HTMLFormElement, action: "activated" | "deactivated") => {
    setBusy(true); setMessage(action === "activated" ? "Recording activation…" : "Deactivating discovery…");
    const data = new FormData(form);
    try {
      const response = await fetch("/api/discovery/activation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, acceptedCycleId: data.get("acceptedCycleId") || activation?.acceptedCycleId, dailyProviderCallCeiling: Number(data.get("dailyProviderCallCeiling") || activation?.dailyProviderCallCeiling), rationale: data.get("rationale") || activation?.rationale || "Emergency discovery kill switch", serviceOwnerApproval: data.get("serviceOwnerApproval") || activation?.serviceOwnerApproval || "Previously approved activation" }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Activation failed.");
      window.location.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Activation failed."); setBusy(false); }
  };

  const launch = async () => {
    setBusy(true); setMessage("Creating a capped discovery campaign…");
    try {
      const response = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "discovery_only", idempotencyKey: crypto.randomUUID(), categories: selectedCategories, counties: selectedCounties, queryCellCap: 10, uniqueLeadCap, providerCallBudget }) });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok || !result.id) throw new Error(result.error ?? "Discovery launch failed.");
      window.location.assign(`/review/runs/${result.id}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Discovery launch failed."); setBusy(false); }
  };

  if (!activation?.active) return <section className="pilot-panel" aria-labelledby="discovery-title">
    <p className="eyebrow">Manual discovery · disabled</p><h2 id="discovery-title">Activate new-resource discovery</h2>
    <p>Activation requires a completed accepted known-directory cycle and service-owner approval. It does not enable scheduling, export, insertion, or production deployment.</p>
    <form onSubmit={(event) => { event.preventDefault(); void mutateActivation(event.currentTarget, "activated"); }}>
      <label>Accepted completed cycle <select name="acceptedCycleId" required defaultValue=""><option value="" disabled>Select a cycle</option>{completedCycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.completedAt} · {cycle.id.slice(0,8)}</option>)}</select></label>
      <label>Daily provider-call ceiling <input name="dailyProviderCallCeiling" type="number" min="1" max="10000" required defaultValue="100" /></label>
      <label>Activation rationale <textarea name="rationale" required maxLength={1000} /></label>
      <label>Service-owner approval reference <input name="serviceOwnerApproval" required maxLength={300} /></label>
      <button disabled={busy || !completedCycles.length}>{busy ? "Recording…" : "Record activation"}</button>
    </form>{!completedCycles.length ? <p>No completed known-directory cycle is available.</p> : null}{message ? <p role="status">{message}</p> : null}
  </section>;

  return <section className="pilot-panel" aria-labelledby="discovery-title">
    <p className="eyebrow">Manual discovery · active</p><h2 id="discovery-title">Find new CBO and WIC locations</h2>
    <p>Policy <code>{policyVersion}</code>. Search results are leads; only corroborated exact service locations can reach human review.</p>
    <fieldset><legend>Approved categories</legend>{categories.map((category) => <label key={category}><input type="checkbox" checked={selectedCategories.includes(category)} onChange={() => toggle(category, selectedCategories, setSelectedCategories)} /> {category.replace(/_/g," ")}</label>)}</fieldset>
    <fieldset><legend>Counties</legend>{counties.map((county) => <label key={county}><input type="checkbox" checked={selectedCounties.includes(county)} onChange={() => toggle(county, selectedCounties, setSelectedCounties)} /> {county}</label>)}</fieldset>
    <p><strong>{cells.length}</strong> resolved query cells. {cells.length ? cells.map((cell) => `${cell.category}/${cell.county}/${cell.provider}`).join(" · ") : "Reduce the selection to at most 10 cells."}</p>
    {cells.length ? <details><summary>Preview frozen query text</summary><ul>{cells.map((cell)=><li key={cell.id}><strong>{cell.provider}</strong>: {cell.query} (cap {cell.resultCap})</li>)}</ul></details> : null}
    <label>Unique-lead cap <input type="number" min="1" max="50" value={uniqueLeadCap} onChange={(event) => setUniqueLeadCap(Number(event.target.value))} /></label>
    <label>Maximum provider calls <input type="number" min={Math.max(1,cells.length)} max="250" value={providerCallBudget} onChange={(event) => setProviderCallBudget(Number(event.target.value))} /></label>
    <label><input type="checkbox" checked={confirmed} onChange={(event)=>setConfirmed(event.target.checked)} /> I confirm this is a capped manual campaign with no source write, export, or automatic recurrence.</label>
    <div className="actions"><button onClick={() => void launch()} disabled={busy || !confirmed || !cells.length || providerCallBudget < cells.length}>{busy ? "Starting…" : "Launch manual discovery"}</button><form onSubmit={(event) => { event.preventDefault(); void mutateActivation(event.currentTarget, "deactivated"); }}><button className="danger-button" disabled={busy}>Deactivate discovery</button></form></div>
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
