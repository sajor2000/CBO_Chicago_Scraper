import type { ReviewProvenance } from "../../lib/repositories/review.ts";

const label = (value: string) => value.replace(/_/g, " ");

export function ReviewProvenanceCard({ evidence, provenance }: { evidence: string[]; provenance: ReviewProvenance }) {
  return <>
    <section className="detail-panel" aria-labelledby="evidence-title">
      <div className="section-heading"><div><p className="eyebrow">Evidence trail</p><h2 id="evidence-title">What the web sources found</h2></div><p className="section-note">Open sources first. AI cannot create or approve a change.</p></div>
      {provenance.observations.length ? <ul className="evidence-list evidence-cards">
        {provenance.observations.map((observation, index) => <li key={`${observation.provider}-${observation.observedAt}-${index}`} className="evidence-card">
          <div className="evidence-card-header"><strong>{label(observation.provider)}</strong><span className={`status-chip status-${observation.state}`}>{label(observation.state)}</span></div>
          <p className="evidence-observed">Observed {observation.observedAt}{observation.sourceUrl ? <> · <a href={observation.sourceUrl} target="_blank" rel="noreferrer">Open source</a></> : null}</p>
          {observation.excerpt ? <p className="evidence-excerpt">{observation.excerpt}</p> : null}
          {observation.values ? <dl className="evidence-values">{Object.entries(observation.values).map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd>{value}</dd></div>)}</dl> : null}
        </li>)}
      </ul> : evidence.length ? <ul className="evidence-list">{evidence.map((item) => <li key={item}>{item.startsWith("http") ? <a href={item} target="_blank" rel="noreferrer">{item}</a> : item}</li>)}</ul> : <p>No evidence was attached to this revision.</p>}
    </section>
    <section className="detail-panel" aria-labelledby="advisory-title">
      <div className="section-heading"><div><p className="eyebrow">AI audit</p><h2 id="advisory-title">GPT advisory</h2></div><p className="section-note">Use as a second opinion, not evidence.</p></div>
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
