"use client";

import { useEffect, useRef, useState } from "react";

type Totals = {
  recordsChecked: number;
  candidatesStaged: number;
  conflicts: number;
  unableToVerify: number;
  providerFailures: number;
};

type ExecuteResult = Totals & {
  error?: string;
  message?: string;
  done?: boolean;
  runStatus?: string;
};

const blankTotals = (): Totals => ({
  recordsChecked: 0,
  candidatesStaged: 0,
  conflicts: 0,
  unableToVerify: 0,
  providerFailures: 0
});

const summarize = (totals: Totals) =>
  `${totals.recordsChecked} checked · ${totals.candidatesStaged} candidate(s) · ${totals.conflicts} conflict(s) · ${totals.unableToVerify} unable to verify · ${totals.providerFailures} provider failure(s)`;

const activeRunStorageKey = "cbo-verification-active-run";

export function RunControls({ resources }: { resources: Array<{ id: string; name: string }> }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string>();
  const cancelRequested = useRef(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(activeRunStorageKey) ?? "null") as { id?: unknown; selection?: unknown } | null;
      if (typeof saved?.id === "string" && Array.isArray(saved.selection) && saved.selection.every((id) => typeof id === "string")) {
        setActiveRunId(saved.id);
        setSelected(saved.selection);
        setMessage("An unfinished pilot is ready to resume.");
      }
    } catch {
      sessionStorage.removeItem(activeRunStorageKey);
    }
  }, []);

  const clearActiveRun = () => {
    setActiveRunId(undefined);
    sessionStorage.removeItem(activeRunStorageKey);
  };

  const toggle = (id: string) => setSelected((current) => current.includes(id)
    ? current.filter((value) => value !== id)
    : current.length < 10 ? [...current, id] : current);

  async function cancelActiveRun(runId: string) {
    cancelRequested.current = true;
    setMessage("Cancelling run…");
    try {
      const response = await fetch("/api/runs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, action: "cancel" })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(body.error ?? "Could not cancel the run. Try again.");
        return;
      }
      clearActiveRun();
      setMessage("Run cancelled. Refreshing the queue…");
      window.location.assign("/review");
    } catch {
      setMessage("Could not cancel the run. Check your connection and try again.");
    }
  }

  async function start() {
    if (!selected.length) return setMessage("Choose at least one copied resource.");
    if (busy) return;
    cancelRequested.current = false;
    setBusy(true);
    const totals = blankTotals();
    setMessage(`${activeRunId ? "Resuming" : "Starting"} verification for ${selected.length} resource${selected.length === 1 ? "" : "s"}…`);
    try {
      let runId = activeRunId;
      if (runId) {
        const response = await fetch("/api/runs", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId, action: "resume" })
        });
        const run = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) {
          setMessage(run.error ?? "Could not resume the run.");
          return;
        }
      } else {
        const response = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), selection: selected, budget: selected.length })
        });
        const run = await response.json() as { id?: string; error?: string };
        if (!response.ok || !run.id) {
          setMessage(run.error ?? "Could not start the run.");
          return;
        }
        runId = run.id;
        setActiveRunId(runId);
        sessionStorage.setItem(activeRunStorageKey, JSON.stringify({ id: runId, selection: selected }));
      }

      for (let index = 0; index < selected.length; index += 1) {
        if (cancelRequested.current) {
          setMessage(`Cancelled after ${summarize(totals)}. Refreshing the queue…`);
          window.location.assign("/review");
          return;
        }
        setMessage(`Checking ${index + 1} of ${selected.length}… ${summarize(totals)}`);
        const execution = await fetch(`/api/runs/${runId}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 1 })
        });
        const result = await execution.json() as ExecuteResult;
        if (execution.status === 409) {
          setMessage(`${result.error ?? "A checkpoint is already claimed."} Cancel the run to release it, then retry.`);
          return;
        }
        if (!execution.ok) {
          setMessage(`Stopped after ${summarize(totals)}. ${result.error ?? "Checkpoint execution failed."} Refresh the queue to see any staged candidates.`);
          window.setTimeout(() => window.location.assign("/review"), 1200);
          return;
        }
        if (!result.recordsChecked) {
          setMessage(result.message ?? "No checkpoint is available.");
          break;
        }
        totals.recordsChecked += result.recordsChecked;
        totals.candidatesStaged += result.candidatesStaged ?? 0;
        totals.conflicts += result.conflicts ?? 0;
        totals.unableToVerify += result.unableToVerify ?? 0;
        totals.providerFailures += result.providerFailures ?? 0;
        if (result.done) break;
      }

      setMessage(`Pilot complete: ${summarize(totals)}. Refreshing the queue…`);
      setSelected([]);
      clearActiveRun();
      window.location.assign("/review");
    } catch {
      setMessage(`The verification run could not be completed after ${summarize(totals)}. Check your connection, then refresh the queue.`);
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
      <p>Choose up to ten copied records. Each resource is checked one at a time so a provider failure cannot strand the whole pilot.</p>
    </div>
    <div className="pilot-resources" role="group" aria-label="Copied resources">
      {resources.map((resource) => (
        <label key={resource.id} className="pilot-resource">
          <input
            type="checkbox"
            checked={selected.includes(resource.id)}
            disabled={busy || Boolean(activeRunId) || (!selected.includes(resource.id) && selected.length >= 10)}
            onChange={() => toggle(resource.id)}
          />
          <span>{resource.name}</span>
        </label>
      ))}
    </div>
    <div className="actions">
      <button type="button" className="primary-button" onClick={() => void start()} disabled={!selected.length || busy} aria-busy={busy}>
        {busy ? "Checking…" : activeRunId ? `Resume selected (${selected.length})` : `Verify selected (${selected.length})`}
      </button>
      {busy && activeRunId ? (
        <button type="button" className="reject-button" onClick={() => void cancelActiveRun(activeRunId)}>
          Cancel run
        </button>
      ) : null}
    </div>
    {message && <p className="pilot-message" role="status">{message}</p>}
  </section>;
}
