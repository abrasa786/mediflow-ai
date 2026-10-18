-- Mediflow AI — add the patient profile columns that didn't apply.
-- Run in Supabase → SQL Editor. Safe to re-run. If any line errors, copy the error message to Claude.

-- Body stats (from 20261013)
alter table public.patients add column if not exists height numeric;
alter table public.patients add column if not exists weight numeric;
alter table public.patients add column if not exists age int;
alter table public.patients add column if not exists gender text;
alter table public.patients add column if not exists goal text;
alter table public.patients add column if not exists activity_level text;

-- Onboarding + MediPass + emergency contact (from 20261014)
alter table public.patients add column if not exists avatar_url text;
alter table public.patients add column if not exists onboarded_at timestamptz;
alter table public.patients add column if not exists health_flags text[] default '{}';
alter table public.patients add column if not exists emergency_contact_name text;
alter table public.patients add column if not exists emergency_contact_phone text;
alter table public.patients add column if not exists dob date;
alter table public.patients add column if not exists blood_group text;
alter table public.patients add column if not exists allergies text;
alter table public.patients add column if not exists conditions text;
alter table public.patients add column if not exists medications text;
alter table public.patients add column if not exists address text;
alter table public.patients add column if not exists insurance_number text;
alter table public.patients add column if not exists aadhaar_last4 text;

do $$ begin
  alter table public.patients add constraint patients_aadhaar_last4_chk
    check (aadhaar_last4 is null or aadhaar_last4 ~ '^[0-9]{4}$');
exception when duplicate_object then null; end $$;

-- Existing patients skip the new onboarding; new sign-ups go through it
update public.patients set onboarded_at = now() where onboarded_at is null;

-- Make the API see the new columns immediately
notify pgrst, 'reload schema';

-- Check: should list all 19 columns above
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'patients'
  and column_name in ('height','weight','age','gender','goal','activity_level','avatar_url','onboarded_at','health_flags',
                      'emergency_contact_name','emergency_contact_phone','dob','blood_group','allergies','conditions',
                      'medications','address','insurance_number','aadhaar_last4')
order by column_name;
