import type { ReviewProvenance } from "../../lib/repositories/review.ts";

const label = (value: string) => value.replace(/_/g, " ");

export function ReviewProvenanceCard({ evidence, provenance }: { evidence: string[]; provenance: ReviewProvenance }) {
  return <>
    <section className="detail-panel" aria-labelledby="evidence-title">
      <h2 id="evidence-title">Evidence</h2>
      {provenance.observations.length ? <ul className="evidence-list">
        {provenance.observations.map((observation, index) => <li key={`${observation.provider}-${observation.observedAt}-${index}`}>
          <strong>{observation.provider}</strong>: {label(observation.state)} ({observation.observedAt})
          {observation.sourceUrl ? <> · <a href={observation.sourceUrl} target="_blank" rel="noreferrer">source</a></> : null}
          {observation.excerpt ? <p>{observation.excerpt}</p> : null}
          {observation.values ? <p>{Object.entries(observation.values).map(([key, value]) => `${label(key)}: ${value}`).join(" · ")}</p> : null}
        </li>)}
      </ul> : evidence.length ? <ul className="evidence-list">{evidence.map((item) => <li key={item}>{item.startsWith("http") ? <a href={item} target="_blank" rel="noreferrer">{item}</a> : item}</li>)}</ul> : <p>No evidence was attached to this revision.</p>}
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
