-- Clinic portal access rules (section 6 of 20261014 that didn't apply) + link the QA clinic login.
-- Run in Supabase → SQL Editor. Safe to re-run.

-- Clinic staff see their clinic's appointments…
drop policy if exists "appointments_clinic_select" on public.appointments;
create policy "appointments_clinic_select" on public.appointments
  for select using (public.is_clinic_member(clinic_id));

-- …and the profile / MediPass of patients who booked with them or were assigned to them in an SOS
drop policy if exists "patients_clinic_select" on public.patients;
create policy "patients_clinic_select" on public.patients for select using (
  exists (select 1 from public.appointments a where a.patient_id = patients.id and public.is_clinic_member(a.clinic_id))
  or exists (select 1 from public.emergency_cases e where e.patient_id = patients.id and public.is_clinic_member(e.clinic_id))
);

-- QA clinic login → City Care Hospital (remove later with:
--   delete from public.clinic_users where user_id = (select id from auth.users where email = 'mediflow.clinic.qa@example.com'); )
insert into public.clinic_users (user_id, clinic_id, role)
select id, '031473bf-3ab4-4fe4-b223-9277b97d9141', 'owner' from auth.users where email = 'mediflow.clinic.qa@example.com'
on conflict do nothing;

-- Check: expect the two policies and one clinic_users row
select tablename, policyname from pg_policies
where schemaname = 'public' and policyname in ('appointments_clinic_select', 'patients_clinic_select')
union all
select 'clinic_users', u.email from public.clinic_users cu join auth.users u on u.id = cu.user_id;
