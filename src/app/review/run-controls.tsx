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
    setMessage(`Checking ${selected.length} resource${selected.length === 1 ? "" : "s"}…`);
    try {
      const idempotencyKey = crypto.randomUUID();
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey, selection: selected, budget: selected.length })
      });
      const run = await response.json() as { id?: string; error?: string };
      if (!response.ok || !run.id) return setMessage(run.error ?? "Could not start the run.");
      const execution = await fetch(`/api/runs/${run.id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: selected.length })
      });
      const result = await execution.json() as {
        error?: string;
        message?: string;
        candidatesStaged?: number;
        unableToVerify?: number;
        conflicts?: number;
        recordsChecked?: number;
      };
      if (!execution.ok) return setMessage(result.error ?? "Run was created but execution failed.");
      if (!result.recordsChecked) {
        return setMessage(result.message ?? "No checkpoints were available for this run.");
      }
      setMessage(`Pilot complete: ${result.recordsChecked} checked · ${result.candidatesStaged ?? 0} candidate(s) · ${result.conflicts ?? 0} conflict(s) · ${result.unableToVerify ?? 0} unable to verify. Refresh the queue.`);
      setSelected([]);
    } catch {
      setMessage("The verification run could not be completed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!resources.length) {
    return <section className="pilot-panel" aria-labelledby="pilot-title">
      <div>
        <h2 id="pilot-title">Run a small evidence check</h2>
        <p className="pilot-empty">No seeded CBO copies are available yet. Finish a reconciled baseline import before launching a pilot.</p>
      </div>
    </section>;
  }

  return <section className="pilot-panel" aria-labelledby="pilot-title">
    <div>
      <h2 id="pilot-title">Run a small evidence check</h2>
      <p>Choose up to ten copied records. This checks public sources and stages only corroborated changes for human review.</p>
    </div>
    <div className="pilot-resources" role="group" aria-label="Copied resources">
      {resources.map((resource) => (
        <label key={resource.id} className="pilot-resource">
          <input
            type="checkbox"
            checked={selected.includes(resource.id)}
            disabled={busy || (!selected.includes(resource.id) && selected.length >= 10)}
            onChange={() => toggle(resource.id)}
          />
          <span>{resource.name}</span>
        </label>
      ))}
    </div>
    <button type="button" className="primary-button" onClick={start} disabled={!selected.length || busy} aria-busy={busy}>
      {busy ? "Checking…" : `Verify selected (${selected.length})`}
    </button>
    {message && <p className="pilot-message" role="status">{message}</p>}
  </section>;
}
