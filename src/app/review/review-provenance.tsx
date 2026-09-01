import type { ReviewProvenance } from "../../lib/repositories/review.ts";

const label = (value: string) => value.replace(/_/g, " ");
const compact = (value: string) => value.replace(/\s+/g, " ").replace(/[`*_>#]/g, "").trim().slice(0, 500);
const publicUrl = (value: string) => { try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined; } catch { return undefined; } };

export function ReviewProvenanceCard({ evidence, provenance }: { evidence: string[]; provenance: ReviewProvenance }) {
  return <>
    <section className="detail-panel" aria-labelledby="evidence-title">
      <h2 id="evidence-title">Evidence</h2>
      {provenance.observations.length ? <ul className="evidence-list">
        {provenance.observations.map((observation, index) => <li key={`${observation.provider}-${observation.observedAt}-${index}`}>
          <strong>{observation.provider}</strong>: {label(observation.state)} ({observation.observedAt})
          {observation.sourceUrl ? <> · <a href={observation.sourceUrl} target="_blank" rel="noreferrer">source</a></> : null}
          {observation.values && Object.keys(observation.values).length ? <dl className="evidence-facts">
            {Object.entries(observation.values).filter(([, value]) => value).map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd>{value}</dd></div>)}
          </dl> : null}
          {observation.excerpt ? <p className="evidence-excerpt">{compact(observation.excerpt)}</p> : null}
        </li>)}
      </ul> : evidence.length ? <ul className="evidence-list">{evidence.map((item) => { const url = publicUrl(item); return <li key={item}>{url ? <a href={url} target="_blank" rel="noreferrer">{url}</a> : item}</li>; })}</ul> : <p>No evidence was attached to this revision.</p>}
    </section>
    <section className="detail-panel" aria-labelledby="advisory-title">
      <h2 id="advisory-title">GPT advisory</h2>
      {provenance.advisory ? <>
        <p>This is advisory only; it cannot approve, publish, or close a listing.</p>
        <dl className="field-diff">
          {Object.entries({ eligibility: provenance.advisory.cboEligibility, operatingAssessment: provenance.advisory.operationalAssessment, evidenceQuality: provenance.advisory.evidenceQuality, suggestedCategory: provenance.advisory.suggestedCategory, promptVersion: provenance.advisory.promptVersion }).flatMap(([key, value]) => value ? [<dt key={`${key}-term`}>{label(key)}</dt>, <dd key={`${key}-value`}>{label(value)}</dd>] : [])}
        </dl>
        {provenance.advisory.rationale ? <p>{provenance.advisory.rationale}</p> : null}
        {provenance.advisory.citations?.length ? <p>Citations: {provenance.advisory.citations.join("; ")}</p> : null}
      </> : <p>No GPT advisory was produced for this revision.</p>}
    </section>
  </>;
}
