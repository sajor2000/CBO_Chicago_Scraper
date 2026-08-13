import assert from "node:assert/strict";
import test from "node:test";
import { approvedCategory, categoryCodes } from "../src/lib/taxonomy/categories.ts";

test("production taxonomy covers the agreed health-resource categories", () => {
  for (const code of ["food_access", "clinic_fqhc", "shelter_housing", "mental_health", "substance_use", "benefits", "transportation", "domestic_violence_crisis", "immigrant_refugee_support", "wic"] as const) {
    assert.ok(categoryCodes.includes(code));
  }
});

test("AI may only propose an approved category", () => {
  assert.equal(approvedCategory("food_access"), "food_access");
  assert.equal(approvedCategory("invented_category"), undefined);
});
