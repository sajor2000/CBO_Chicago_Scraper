"use client";

import { useState } from "react";
import { clampSelectedBudget } from "./selected-budget.ts";

type Resource = { id: string; name: string };
type LaunchRequest =
  | { mode: "manual_full_cycle"; budget: number }
  | { selection: string[]; budget: number };

export function RunControls({ resources, dueCount }: { resources: Resource[]; dueCount: number }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [budget, setBudget] = useState(dueCount || 1);
  const [selectedBudget, setSelectedBudget] = useState(1);
  const [message, setMessage] = useState<string>();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const visibleResources = resources.filter((resource) => resource.name.toLowerCase().includes(query.trim().toLowerCase()));
  const start = async (body: LaunchRequest, fallback: string) => {
    if (busy) return;
    setBusy(true);
    setMessage("Creating a durable audit run…");
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), ...body })
      });
      const run = await response.json().catch(() => ({})) as { id?: string; error?: string };
      if (!response.ok || !run.id) {
        setMessage(run.error ?? fallback);
        return;
      }
      window.location.assign(`/review/runs/${run.id}`);
    } catch {
      setMessage(fallback);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => setSelected((current) => {
    const next = current.includes(id) ? current.filter((value) => value !== id) : current.length < 100 ? [...current, id] : current;
    setSelectedBudget((value) => clampSelectedBudget(value, next.length));
    return next;
  });

  return <section className="pilot-panel" aria-labelledby="audit-title">
    <div>
      <p className="eyebrow">Current directory</p>
      <h2 id="audit-title">Audit known resources</h2>
      <p>Start one durable campaign. The server processes it in bounded checkpoints and produces a report for every listing.</p>
    </div>
    <div className="actions">
      <button
        type="button"
        className="primary-button"
        onClick={() => void start({ mode: "manual_full_cycle", budget }, "Could not start the full due-directory audit.")}
        disabled={busy || dueCount < 1 || budget < 1 || budget > dueCount}
        aria-busy={busy}
      >
        {busy ? "Starting…" : `Audit all due listings (${dueCount})`}
      </button>
      <label className="resource-search">Approved checkpoint budget
        <input type="number" min="1" max={Math.max(1, dueCount)} value={budget} onChange={(event) => setBudget(Number(event.target.value))} disabled={busy || dueCount < 1} />
      </label>
    </div>
    {!dueCount ? <p className="pilot-empty">No due listings are available. Complete a reconciled refresh before starting the next full audit.</p> : null}

    <details>
      <summary>Run a selected spot check instead</summary>
      <p>A spot check is useful for a specific listing. It does not reset the 60-day due date.</p>
      <label className="resource-search">Search current listings
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by organization or location" disabled={busy} />
      </label>
      <p className="selection-count"><strong>{selected.length}</strong> of 100 selected</p>
      <label className="resource-search">Selected checkpoint budget
        <input type="number" min="1" max={Math.max(1, selected.length)} value={selectedBudget} onChange={(event) => setSelectedBudget(Number(event.target.value))} disabled={busy || !selected.length} />
      </label>
      <div className="pilot-resources" role="group" aria-label="Copied resources">
        {visibleResources.map((resource) => <label key={resource.id} className="pilot-resource">
          <input type="checkbox" checked={selected.includes(resource.id)} disabled={busy || (!selected.includes(resource.id) && selected.length >= 100)} onChange={() => toggle(resource.id)} />
          <span>{resource.name}</span>
        </label>)}
      </div>
      <button type="button" onClick={() => void start({ selection: selected, budget: selectedBudget }, "Could not start the selected spot check.")} disabled={busy || !selected.length || selectedBudget < 1 || selectedBudget > selected.length}>
        Audit selected ({selected.length})
      </button>
    </details>
    {message ? <p className="pilot-message" role="status">{message}</p> : null}
  </section>;
}
