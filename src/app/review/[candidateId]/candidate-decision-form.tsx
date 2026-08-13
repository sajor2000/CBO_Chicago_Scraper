"use client";

import { FormEvent, useState } from "react";

export function CandidateDecisionForm({ candidateId, revision, fields }: { candidateId: string; revision: number; fields: string[] }) {
  const [selected, setSelected] = useState(fields);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const decide = async (action: "approved" | "deferred" | "rejected") => {
    if (!reason.trim()) return setMessage("Add a brief review reason before deciding.");
    if (action === "approved" && !selected.length) return setMessage("Select at least one field to approve.");
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateId, expectedRevision: revision, action, fields: action === "approved" ? selected : undefined, reason })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setMessage(body.error ?? "The decision could not be saved.");
        return;
      }
      window.location.assign("/review");
    } catch {
      setMessage("The decision could not be saved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => { event.preventDefault(); void decide("approved"); };
  const toggle = (field: string) => setSelected((current) => current.includes(field) ? current.filter((item) => item !== field) : [...current, field]);

  return <form className="decision-form" onSubmit={submit}>
    <fieldset><legend>Approve only the fields you are confident in</legend>
      {fields.map((field) => <label className="field-choice" key={field}><input type="checkbox" checked={selected.includes(field)} onChange={() => toggle(field)} /> {field.replace(/_/g, " ")}</label>)}
    </fieldset>
    <label className="reason-label">Review reason<textarea required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this evidence sufficient, incomplete, or incorrect?" /></label>
    {message && <p className="decision-message" role="status">{message}</p>}
    <div className="decision-actions"><button className="approve-button" disabled={busy} type="submit">Approve selected fields</button><button disabled={busy} type="button" onClick={() => void decide("deferred")}>Defer</button><button className="reject-button" disabled={busy} type="button" onClick={() => void decide("rejected")}>Reject</button></div>
  </form>;
}
