create table review_workspace.categories (
  code text primary key,
  label text not null,
  definition text not null,
  synonyms text[] not null default '{}',
  effective_from date not null,
  deprecated_at timestamptz,
  replaced_by text references review_workspace.categories(code),
  check (deprecated_at is null or deprecated_at >= effective_from)
);

create table review_workspace.resource_category_assignments (
  resource_id uuid not null references review_workspace.resources(id),
  category_code text not null references review_workspace.categories(code),
  approved_by_decision_id uuid references review_workspace.review_decisions(id),
  effective_from timestamptz not null default now(),
  primary key (resource_id, category_code)
);

create table review_workspace.candidate_category_proposals (
  candidate_revision_id uuid not null references review_workspace.candidate_revisions(id),
  category_code text not null references review_workspace.categories(code),
  action text not null check (action in ('add', 'remove')),
  primary key (candidate_revision_id, category_code, action)
);

insert into review_workspace.categories (code, label, definition, synonyms, effective_from) values
  ('food_pantry', 'Food pantry', 'Provides free or low-cost groceries or prepared food.', array['food bank', 'groceries'], current_date),
  ('primary_care_clinic', 'Primary care clinic', 'Provides outpatient primary or preventive health care.', array['medical clinic', 'health center'], current_date),
  ('mental_health_services', 'Mental health services', 'Provides behavioral or mental health assessment, treatment, or support.', array['behavioral health', 'counseling'], current_date),
  ('shelter', 'Shelter', 'Provides temporary housing or emergency shelter.', array['housing shelter', 'emergency shelter'], current_date),
  ('dental_clinic', 'Dental clinic', 'Provides dental evaluation, prevention, or treatment.', array['dental care'], current_date),
  ('substance_use_treatment', 'Substance use treatment', 'Provides substance use prevention, treatment, recovery, or harm-reduction services.', array['addiction treatment', 'recovery'], current_date),
  ('healthcare_navigation', 'Healthcare navigation', 'Helps people locate, enroll in, or access health and social services.', array['resource navigation', 'care coordination'], current_date)
on conflict (code) do nothing;
