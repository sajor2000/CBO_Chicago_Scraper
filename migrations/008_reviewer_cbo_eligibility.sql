alter table review_workspace.review_decisions
  add column if not exists reviewer_cbo_eligibility boolean;
