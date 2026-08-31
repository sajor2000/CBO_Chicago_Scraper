"use client";

import { useState } from "react";
import type { RunStatus } from "../../lib/domain/review-workspace.ts";

export function RunActions({ runId, status, resumeHeadroom, fixedProviderBudget = false }: { runId: string; status: RunStatus; resumeHeadroom: number; fixedProviderBudget?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [additionalBudget, setAdditionalBudget] = useState(0);
  const [message, setMessage] = useState<string>();
  const mutate = async (action: "cancel" | "pause" | "resume") => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/runs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, action, ...(action === "resume" ? { additionalBudget } : {}) })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(body.error ?? "The run could not be updated.");
        return;
      }
      window.location.reload();
    } catch {
      setMessage("The run could not be updated. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const executeNext = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/runs/${runId}/execute`, { method: "POST" });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(body.error ?? "The next checkpoint could not be processed.");
        return;
      }
      window.location.reload();
    } catch {
      setMessage("The next checkpoint could not be processed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (status === "completed" || status === "cancelled" || status === "failed") return null;
  return <section className="actions" aria-label="Audit run controls">
    {status === "paused" ? <>
      {!fixedProviderBudget ? <label className="resource-search">Additional checkpoint budget
        <input type="number" min="0" max={resumeHeadroom} value={additionalBudget} onChange={(event) => setAdditionalBudget(Number(event.target.value))} disabled={busy} />
      </label> : <p>Resume uses the campaign’s remaining provider-call allocation and must reserve new headroom after UTC rollover.</p>}
      <button type="button" className="primary-button" onClick={() => void mutate("resume")} disabled={busy || additionalBudget < 0 || additionalBudget > resumeHeadroom}>Resume audit</button>
    </> : <>
      <button type="button" className="primary-button" onClick={() => void executeNext()} disabled={busy}>Process next checkpoint</button>
      <button type="button" onClick={() => void mutate("pause")} disabled={busy}>Pause audit</button>
    </>}
    <button type="button" className="reject-button" onClick={() => void mutate("cancel")} disabled={busy}>Cancel run</button>
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
