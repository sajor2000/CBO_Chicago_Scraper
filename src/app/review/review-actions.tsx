"use client";

import { useMemo, useState } from "react";

const fieldLabel = (field: string) => field.replace(/_/g, " ");

export function ReviewActions({
  candidateId,
  expectedRevision,
  proposedValues
}: {
  candidateId: string;
  expectedRevision: number;
  proposedValues: Record<string, string>;
}) {
  const fields = useMemo(() => Object.keys(proposedValues), [proposedValues]);
  const [selected, setSelected] = useState(fields);
  const [draft, setDraft] = useState(proposedValues);
  const [reason, setReason] = useState("");
  const [cboEligibility, setCboEligibility] = useState<"" | "eligible" | "not_eligible">("");
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  const decide = async (action: "approved" | "rejected" | "deferred" | "edit") => {
    if (!reason.trim()) return setMessage("Add a brief review reason before deciding.");
    if (action === "approved" && !selected.length) return setMessage("Select at least one field to approve.");
    if (action === "edit" && Object.values(draft).some((value) => !value.trim())) {
      return setMessage("Edited proposals need a value for every field.");
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          candidateId,
          expectedRevision,
          action,
          fields: action === "approved" ? selected : undefined,
          proposedValues: action === "edit" ? draft : undefined,
          reviewerCboEligibility: action === "approved" || action === "rejected" ? cboEligibility === "eligible" ? true : cboEligibility === "not_eligible" ? false : undefined : undefined,
          reason
        })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(response.status === 409
          ? (body.error ?? "Candidate revision has changed; refresh before deciding.")
          : (body.error ?? "The decision could not be saved."));
        return;
      }
      window.location.assign("/review");
    } catch {
      setMessage("The decision could not be saved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return <section className="review-actions" aria-labelledby="decision-title">
    <h2 id="decision-title">Decision</h2>
    <p>Approve only the fields supported by the evidence. A decision cannot write to ChicagoHealthMap production.</p>
    {fields.length ? (
      <>
        <fieldset disabled={busy}>
          <legend>Approved fields</legend>
          {fields.map((field) => (
            <label key={field} className="field-choice">
              <input
                type="checkbox"
                checked={selected.includes(field)}
                onChange={() => setSelected((current) => current.includes(field) ? current.filter((value) => value !== field) : [...current, field])}
              />
              <span><strong>{fieldLabel(field)}</strong>: {proposedValues[field]}</span>
            </label>
          ))}
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Edit proposal</legend>
          {fields.map((field) => (
            <label key={field} className="edit-field">
              <span>{fieldLabel(field)}</span>
              <input
                value={draft[field] ?? ""}
                onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))}
              />
            </label>
          ))}
        </fieldset>
      </>
    ) : (
      <p className="conflict-note">No field changes were proposed. Use defer or reject after reading the evidence (for example a Google-only closure conflict).</p>
    )}
    <label className="reason-label">
      Reason
      <textarea
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        required
        disabled={busy}
        placeholder="Why is this evidence sufficient, incomplete, or incorrect?"
      />
    </label>
    <fieldset disabled={busy}>
      <legend>CBO eligibility assessment (optional)</legend>
      <label><input type="radio" name="cbo-eligibility" checked={cboEligibility === ""} onChange={() => setCboEligibility("")} /> Not assessed</label>
      <label><input type="radio" name="cbo-eligibility" checked={cboEligibility === "eligible"} onChange={() => setCboEligibility("eligible")} /> Eligible CBO</label>
      <label><input type="radio" name="cbo-eligibility" checked={cboEligibility === "not_eligible"} onChange={() => setCboEligibility("not_eligible")} /> Not eligible CBO</label>
      <p>Recorded only when approving or rejecting; it does not affect field approval.</p>
    </fieldset>
    <div className="actions">
      <button type="button" className="primary-button" disabled={busy || !reason.trim() || !fields.length || selected.length === 0} onClick={() => void decide("approved")}>
        {busy ? "Saving…" : "Approve fields"}
      </button>
      <button type="button" disabled={busy || !reason.trim() || !fields.length || Object.values(draft).some((value) => !value.trim())} onClick={() => void decide("edit")}>
        Save edited proposal
      </button>
      <button type="button" disabled={busy || !reason.trim()} onClick={() => void decide("deferred")}>Defer</button>
      <button type="button" className="reject-button" disabled={busy || !reason.trim()} onClick={() => void decide("rejected")}>Reject</button>
    </div>
    {message && <p className="decision-message" role="status">{message}</p>}
  </section>;
}
