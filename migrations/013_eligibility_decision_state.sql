-- Eligibility confirmation is a human audit outcome, never a directory export approval.
alter table review_workspace.candidate_current_state
  drop constraint if exists candidate_current_state_status_check;

alter table review_workspace.candidate_current_state
  add constraint candidate_current_state_status_check
  check (status in ('staged', 'deferred', 'rejected', 'approved_for_future_export', 'eligibility_confirmed'));

alter table review_workspace.review_decisions
  drop constraint if exists review_decisions_decision_check;

alter table review_workspace.review_decisions
  add constraint review_decisions_decision_check
  check (decision in ('approved', 'rejected', 'deferred', 'eligibility_confirmed'));
