import assert from "node:assert/strict";
import test from "node:test";
import { verifyResource } from "../src/lib/verification/index.ts";
import type { CapturedObservation } from "../src/lib/retrieval/types.ts";

const resource = { id: "r1", name: "Example Pantry", address: "1 Old St", status: "open" as const };
const observation = (provider: CapturedObservation["provider"], values: CapturedObservation["values"], state: CapturedObservation["state"] = "success"): CapturedObservation => ({ provider, state, observedAt: "2026-08-13T00:00:00Z", values });

test("concordant official and Google evidence stages only an address update", () => {
  const result = verifyResource({ resource, observations: [observation("firecrawl", { address: "2 New St" }), observation("google_places", { address: "2 New St" })] });
  assert.equal(result.state, "candidate_update");
  assert.deepEqual(result.proposedValues, { address: "2 New St" });
  assert.deepEqual(result.diffs[0]?.citedBy.sort(), ["firecrawl", "google_places"]);
});

test("a Google closure conflicts and never stages a closed status", () => {
  const result = verifyResource({ resource, observations: [observation("google_places", { businessStatus: "closed" })] });
  assert.equal(result.state, "conflict");
  assert.equal(result.proposedValues.businessStatus, undefined);
});

test("blocked, timeout, and 429 sources are unable to verify without a status delta", () => {
  for (const state of ["blocked", "timeout", "rate_limited"] as const) {
    const result = verifyResource({ resource, observations: [observation("firecrawl", {}, state)] });
    assert.equal(result.state, "unable_to_verify");
    assert.equal(result.proposedValues.businessStatus, undefined);
  }
});

test("an unmatched trusted-directory lead becomes a potential new resource", () => {
  const lead = observation("local_directory", { name: "New Clinic", address: "3 Lake St" });
  const result = verifyResource({ resource, lead, observations: [] });
  assert.equal(result.state, "potential_new_resource");
  assert.equal(result.proposedValues.name, "New Clinic");
});

test("AI advice cannot create categories, merge identities, or close a record", () => {
  const result = verifyResource({ resource, observations: [], advisory: { suggestedCategory: "invented", mergeWithResourceId: "other", close: true } });
  assert.equal(result.state, "no_change");
  assert.deepEqual(result.proposedValues, {});
  assert.equal(result.advisory?.suggestedCategory, "invented");
});
