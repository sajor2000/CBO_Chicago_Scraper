"use client";

import { useState } from "react";

export function RunControls({ resources }: { resources: Array<{ id: string; name: string }> }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length < 10 ? [...current, id] : current);
  async function start() {
    if (!selected.length) return setMessage("Choose at least one copied resource.");
    if (busy) return;
    setBusy(true);
    setMessage("Starting verification run…");
    try {
      const idempotencyKey = crypto.randomUUID();
      const response = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey, selection: selected, budget: selected.length }) });
      const run = await response.json() as { id?: string; error?: string };
      if (!response.ok || !run.id) return setMessage(run.error ?? "Could not start the run.");
      const execution = await fetch(`/api/runs/${run.id}/execute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: selected.length }) });
      const result = await execution.json() as { error?: string; candidatesStaged?: number; unableToVerify?: number; conflicts?: number };
      if (!execution.ok) return setMessage(result.error ?? "Run was created but execution failed.");
      setMessage(`Pilot complete: ${result.candidatesStaged ?? 0} candidate(s), ${result.conflicts ?? 0} conflict(s), ${result.unableToVerify ?? 0} unable to verify. Refresh the queue.`);
    } catch {
      setMessage("The verification run could not be completed. Check your connection and try again.");
    }
    finally { setBusy(false); }
  }
  return <section className="pilot-panel" aria-labelledby="pilot-title">
    <div><p className="section-label">Operator pilot</p><h2 id="pilot-title">Run a small evidence check</h2><p>Choose up to ten copied records. This checks public sources and stages only corroborated changes.</p></div>
    <div className="pilot-resources">{resources.map((resource) => <label key={resource.id}><input type="checkbox" checked={selected.includes(resource.id)} disabled={!selected.includes(resource.id) && selected.length >= 10} onChange={() => toggle(resource.id)} /> {resource.name}</label>)}</div>
    <button type="button" onClick={start} disabled={!selected.length || busy}>{busy ? "Starting…" : `Verify selected (${selected.length})`}</button>
    {message && <p className="pilot-message" role="status">{message}</p>}
  </section>;
}
