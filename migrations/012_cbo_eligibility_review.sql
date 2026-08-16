alter table review_workspace.candidate_revisions
  drop constraint if exists candidate_revisions_kind_check;

alter table review_workspace.candidate_revisions
  add constraint candidate_revisions_kind_check
  check (kind in ('update', 'new_resource', 'closure_review', 'eligibility_review'));
