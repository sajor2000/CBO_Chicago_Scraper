"use client";

import { useMemo, useState } from "react";

export function ReviewActions({ candidateId, expectedRevision, proposedValues }: { candidateId: string; expectedRevision: number; proposedValues: Record<string, string> }) {
  const fields = useMemo(() => Object.keys(proposedValues), [proposedValues]);
  const [selected, setSelected] = useState(fields);
  const [draft, setDraft] = useState(proposedValues);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string>();
  const decide = async (action: "approved" | "rejected" | "deferred" | "edit") => {
    const response = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateId, expectedRevision, action, fields: action === "approved" ? selected : undefined, proposedValues: action === "edit" ? draft : undefined, reason }) });
    setMessage(response.ok ? `Decision recorded: ${action}. Refresh to see the current revision.` : (await response.json() as { error?: string }).error ?? "Decision failed.");
  };
  return <section className="review-actions">
    <h2>Decision</h2>
    <p>Approve only the fields supported by the evidence. A decision cannot write to ChicagoHealthMap production.</p>
    <fieldset><legend>Approved fields</legend>{fields.map((field) => <label key={field}><input type="checkbox" checked={selected.includes(field)} onChange={() => setSelected((current) => current.includes(field) ? current.filter((value) => value !== field) : [...current, field])} /> {field}: {proposedValues[field]}</label>)}</fieldset>
    <fieldset><legend>Edit proposal</legend>{fields.map((field) => <label key={field}>{field}<input value={draft[field] ?? ""} onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))} /></label>)}</fieldset>
    <label>Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} required /></label>
    <div className="actions"><button type="button" disabled={!reason.trim() || selected.length === 0} onClick={() => decide("approved")}>Approve fields</button><button type="button" disabled={!reason.trim() || Object.values(draft).some((value) => !value.trim())} onClick={() => decide("edit")}>Save edited proposal</button><button type="button" disabled={!reason.trim()} onClick={() => decide("deferred")}>Defer</button><button type="button" disabled={!reason.trim()} onClick={() => decide("rejected")}>Reject</button></div>
    {message && <p role="status">{message}</p>}
  </section>;
}
