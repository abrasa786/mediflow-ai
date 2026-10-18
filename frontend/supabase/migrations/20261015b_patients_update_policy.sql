-- Let each patient update their own profile row (onboarding, MediPass, body stats, emergency contact).
-- Run in Supabase → SQL Editor. Safe to re-run.
drop policy if exists "patients_update_own" on public.patients;
create policy "patients_update_own" on public.patients
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Check: should show patients_update_own with cmd = UPDATE
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'patients' order by policyname;
