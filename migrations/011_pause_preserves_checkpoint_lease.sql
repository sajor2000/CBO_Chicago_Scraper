-- Pausing stops future claims but does not invalidate a provider request already in flight.
create or replace function review_workspace.complete_run_checkpoint(
  target_run_id uuid,
  target_lease_token uuid,
  terminal_outcome text,
  delta jsonb
) returns boolean
language plpgsql
as $$
declare
  claimed review_workspace.run_checkpoints%rowtype;
  mode text;
  used integer;
  budget integer;
begin
  select checkpoint.* into claimed
  from review_workspace.run_checkpoints checkpoint
  join review_workspace.run_current_state state on state.run_id = checkpoint.run_id
  where checkpoint.run_id = target_run_id
    and checkpoint.lease_token = target_lease_token
    and checkpoint.state = 'leased'
    and checkpoint.lease_expires_at > now()
    and state.status in ('running', 'paused')
  for update of checkpoint;
  if not found then return false; end if;

  select run_mode, (run_parameters->>'budget')::integer
  into mode, budget from review_workspace.verification_runs where id = target_run_id;

  insert into review_workspace.run_checkpoint_outcomes
    (run_id, ordinal, cycle_membership_id, lease_token, outcome, report_delta)
  values (claimed.run_id, claimed.ordinal, claimed.cycle_membership_id, target_lease_token, terminal_outcome, delta);

  update review_workspace.run_checkpoints
  set state = case when terminal_outcome in ('provider_failure') then 'failed' else 'completed' end,
      lease_token = null, lease_expires_at = null, report_delta = delta, completed_at = now()
  where run_id = claimed.run_id and ordinal = claimed.ordinal;

  update review_workspace.run_reports current
  set report = jsonb_build_object(
    'recordsChecked', coalesce((current.report->>'recordsChecked')::integer, 0) + coalesce((delta->>'recordsChecked')::integer, 0),
    'candidatesStaged', coalesce((current.report->>'candidatesStaged')::integer, 0) + coalesce((delta->>'candidatesStaged')::integer, 0),
    'conflicts', coalesce((current.report->>'conflicts')::integer, 0) + coalesce((delta->>'conflicts')::integer, 0),
    'unableToVerify', coalesce((current.report->>'unableToVerify')::integer, 0) + coalesce((delta->>'unableToVerify')::integer, 0),
    'providerFailures', coalesce((current.report->>'providerFailures')::integer, 0) + coalesce((delta->>'providerFailures')::integer, 0),
    'budgetUsed', coalesce((current.report->>'budgetUsed')::integer, 0) + coalesce((delta->>'budgetUsed')::integer, 0)
  ), updated_at = now()
  where current.run_id = target_run_id;
  select coalesce((report->>'budgetUsed')::integer, 0) into used
  from review_workspace.run_reports where run_id = target_run_id;

  update review_workspace.verification_runs run
  set budget_state = case
    when used >= budget and claimed.ordinal + 1 < (select count(*) from review_workspace.run_checkpoints where run_id = target_run_id)
      then 'exhausted'
    else run.budget_state
  end
  where run.id = target_run_id;

  if mode in ('manual_full_cycle', 'scheduled_cycle')
     and terminal_outcome in ('verified_no_change', 'candidate_staged', 'conflict') then
    insert into review_workspace.resource_verification_due
      (resource_id, last_cycle_id, last_outcome, last_completed_at, next_due_at)
    select membership.resource_id, membership.cycle_id, terminal_outcome, now(), now() + interval '60 days'
    from review_workspace.cycle_memberships membership where membership.id = claimed.cycle_membership_id
    on conflict (resource_id) do update set
      last_cycle_id = excluded.last_cycle_id, last_outcome = excluded.last_outcome,
      last_completed_at = excluded.last_completed_at, next_due_at = excluded.next_due_at, updated_at = now();
  end if;

  update review_workspace.run_current_state state
  set next_checkpoint_ordinal = next_checkpoint_ordinal + 1,
      status = case
        when terminal_outcome = 'budget_exhausted' then 'paused'
        when next_checkpoint_ordinal + 1 >= (select count(*) from review_workspace.run_checkpoints where run_id = target_run_id) then 'completed'
        when state.status = 'paused' then 'paused'
        when used >= budget then 'paused'
        else 'queued'
      end,
      updated_at = now(), revision = revision + 1
  where state.run_id = target_run_id;

  update review_workspace.verification_cycles cycle
  set status = state.status,
      completed_at = case when state.status = 'completed' then now() else cycle.completed_at end
  from review_workspace.verification_runs run
  join review_workspace.run_current_state state on state.run_id = run.id
  where run.id = target_run_id and cycle.id = run.cycle_id;
  return true;
end;
$$;
