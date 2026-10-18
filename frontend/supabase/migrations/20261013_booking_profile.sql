-- Mediflow AI — booking, profile & Patient ID support
-- Run once in Supabase Dashboard → SQL Editor. Safe to re-run.

-- ─────────────────────────────────────────────
-- 1. PATIENTS: Patient ID (MF-2026-XXXXX) + body stats
-- ─────────────────────────────────────────────
alter table public.patients add column if not exists patient_id text;
alter table public.patients add column if not exists height numeric;
alter table public.patients add column if not exists weight numeric;
alter table public.patients add column if not exists age int;
alter table public.patients add column if not exists gender text;
alter table public.patients add column if not exists goal text;
alter table public.patients add column if not exists activity_level text;

create sequence if not exists public.patient_id_seq start 1;

create or replace function public.assign_patient_id()
returns trigger language plpgsql as $$
begin
  if new.patient_id is null or new.patient_id = '' then
    new.patient_id := 'MF-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.patient_id_seq')::text, 5, '0');
  end if;
  return new;
end $$;

drop trigger if exists trg_assign_patient_id on public.patients;
create trigger trg_assign_patient_id
  before insert on public.patients
  for each row execute function public.assign_patient_id();

-- Backfill existing patients without an ID
update public.patients
set patient_id = 'MF-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.patient_id_seq')::text, 5, '0')
where patient_id is null or patient_id = '';

create unique index if not exists patients_patient_id_key on public.patients (patient_id);

-- ─────────────────────────────────────────────
-- 2. APPOINTMENTS: symptoms note + no double booking
-- ─────────────────────────────────────────────
alter table public.appointments add column if not exists symptoms text;
alter table public.appointments add column if not exists created_at timestamptz default now();

create unique index if not exists appointments_no_double_booking
  on public.appointments (doctor_id, appointment_date, appointment_time)
  where status = 'confirmed' and doctor_id is not null;

-- ─────────────────────────────────────────────
-- 3. ROW LEVEL SECURITY — patients manage only their own rows
-- ─────────────────────────────────────────────
alter table public.patients enable row level security;
alter table public.appointments enable row level security;

drop policy if exists "patients_select_own" on public.patients;
create policy "patients_select_own" on public.patients for select using (auth.uid() = id);
drop policy if exists "patients_insert_own" on public.patients;
create policy "patients_insert_own" on public.patients for insert with check (auth.uid() = id);
drop policy if exists "patients_update_own" on public.patients;
create policy "patients_update_own" on public.patients for update using (auth.uid() = id);

drop policy if exists "appointments_select_own" on public.appointments;
create policy "appointments_select_own" on public.appointments for select using (auth.uid() = patient_id);
drop policy if exists "appointments_insert_own" on public.appointments;
create policy "appointments_insert_own" on public.appointments for insert with check (auth.uid() = patient_id);
drop policy if exists "appointments_update_own" on public.appointments;
create policy "appointments_update_own" on public.appointments for update using (auth.uid() = patient_id);

-- ─────────────────────────────────────────────
-- 4. Slot availability without exposing other patients' data
-- ─────────────────────────────────────────────
create or replace function public.booked_times(p_clinic uuid, p_doctor uuid, p_date date)
returns setof text
language sql security definer set search_path = public as $$
  select appointment_time from public.appointments
  where clinic_id = p_clinic
    and appointment_date = p_date
    and status = 'confirmed'
    and (doctor_id = p_doctor or (p_doctor is null and doctor_id is null));
$$;
grant execute on function public.booked_times(uuid, uuid, date) to anon, authenticated;
