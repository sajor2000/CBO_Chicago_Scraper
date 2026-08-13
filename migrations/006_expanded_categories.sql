insert into review_workspace.categories (code, label, definition, synonyms, effective_from) values
  ('food_access', 'Food access', 'Provides free or low-cost food, groceries, or meals.', array['food pantry', 'food bank'], current_date),
  ('clinic_fqhc', 'Clinic or FQHC', 'Provides community outpatient clinical or preventive care.', array['clinic', 'fqhc', 'community health center'], current_date),
  ('shelter_housing', 'Shelter and housing', 'Provides emergency shelter, housing navigation, or housing support.', array['shelter', 'housing'], current_date),
  ('mental_health', 'Mental health', 'Provides behavioral-health assessment, treatment, counseling, or support.', array['behavioral health', 'counseling'], current_date),
  ('substance_use', 'Substance use support', 'Provides prevention, treatment, recovery, or harm-reduction services.', array['recovery', 'harm reduction'], current_date),
  ('benefits', 'Benefits support', 'Helps residents access public benefits or resource enrollment.', array['benefits enrollment'], current_date),
  ('transportation', 'Transportation', 'Provides transportation or transportation assistance for health-related needs.', array['ride assistance'], current_date),
  ('domestic_violence_crisis', 'Domestic violence and crisis support', 'Provides domestic-violence, crisis, or safety support.', array['crisis services'], current_date),
  ('immigrant_refugee_support', 'Immigrant and refugee support', 'Provides direct health-related support to immigrant or refugee residents.', array['refugee services'], current_date),
  ('wic', 'WIC', 'Provides Women, Infants, and Children nutrition services.', array['women infants children'], current_date)
on conflict (code) do nothing;
