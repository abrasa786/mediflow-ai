-- Mediflow AI — Clinic Suite: branding & booking links, doctors, patient register, online (video)
-- appointments, prescriptions, billing, file storage. Also fixes ambulance dispatch tokens.
-- Run in Supabase → SQL Editor. Safe to re-run.

-- ─────────────────────────────────────────────
-- 0. FIX: pgcrypto lives in the "extensions" schema on Supabase
-- ─────────────────────────────────────────────
create or replace function public.clinic_dispatch_ambulance(p_case uuid, p_driver text, p_phone text, p_vehicle text)
returns text language plpgsql security definer set search_path = public as $$
declare v_clinic uuid; v_token text := encode(extensions.gen_random_bytes(18), 'hex');
begin
  select clinic_id into v_clinic from public.emergency_cases
  where id = p_case and status in ('assigned', 'spoke_to_patient', 'doctor_assigned', 'ambulance_dispatched') for update;
  if v_clinic is null or not public.is_clinic_member(v_clinic) then raise exception 'Not allowed'; end if;

  update public.emergency_cases set
    status = 'ambulance_dispatched', confirmed_at = coalesce(confirmed_at, now()), confirmed_by = coalesce(confirmed_by, auth.uid()),
    ambulance_token = v_token, ambulance_driver_name = nullif(p_driver, ''), ambulance_driver_phone = nullif(p_phone, ''),
    ambulance_vehicle = nullif(p_vehicle, ''), ambulance_status = 'dispatched', ambulance_dispatched_at = now(),
    ambulance_lat = null, ambulance_lng = null, ambulance_updated_at = null
  where id = p_case;
  insert into public.emergency_events (case_id, kind, message, data, needs_notify)
  values (p_case, 'ambulance_dispatched',
          '🚑 Ambulance dispatched' || coalesce(' — ' || nullif(p_vehicle, ''), '') || coalesce(', driver ' || nullif(p_driver, ''), ''),
          jsonb_build_object('driver', p_driver, 'vehicle', p_vehicle), true);
  return v_token;
end $$;

-- helper: membership check from a storage folder name (text) without unsafe uuid casts
create or replace function public.is_clinic_member_text(p_clinic text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.clinic_users where user_id = auth.uid() and clinic_id::text = p_clinic);
$$;

-- ─────────────────────────────────────────────
-- 1. CLINICS — branding, booking link, custom domain, storage quota
-- ─────────────────────────────────────────────
alter table public.clinics add column if not exists slug text;
alter table public.clinics add column if not exists brand_name text;
alter table public.clinics add column if not exists logo_url text;
alter table public.clinics add column if not exists brand_color text not null default '#0ea5e9';
alter table public.clinics add column if not exists custom_domain text;
alter table public.clinics add column if not exists about text;
alter table public.clinics add column if not exists storage_quota_mb int not null default 1024;
alter table public.clinics add column if not exists slot_minutes int not null default 30;
alter table public.clinics add column if not exists gstin text;

update public.clinics
set slug = trim(both '-' from lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')))
where slug is null;
create unique index if not exists clinics_slug_key on public.clinics (slug);
create unique index if not exists clinics_custom_domain_key on public.clinics (lower(custom_domain)) where custom_domain is not null;

alter table public.clinics enable row level security;
drop policy if exists "clinics_read_all" on public.clinics;
create policy "clinics_read_all" on public.clinics for select using (true);
drop policy if exists "clinics_member_update" on public.clinics;
create policy "clinics_member_update" on public.clinics for update
  using (public.is_clinic_member(id)) with check (public.is_clinic_member(id));

-- ─────────────────────────────────────────────
-- 2. DOCTORS — managed by the clinic
-- ─────────────────────────────────────────────
alter table public.doctors add column if not exists is_active boolean not null default true;
alter table public.doctors add column if not exists phone text;

alter table public.doctors enable row level security;
drop policy if exists "doctors_read_all" on public.doctors;
create policy "doctors_read_all" on public.doctors for select using (true);
drop policy if exists "doctors_member_insert" on public.doctors;
create policy "doctors_member_insert" on public.doctors for insert with check (public.is_clinic_member(clinic_id));
drop policy if exists "doctors_member_update" on public.doctors;
create policy "doctors_member_update" on public.doctors for update
  using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id));
drop policy if exists "doctors_member_delete" on public.doctors;
create policy "doctors_member_delete" on public.doctors for delete using (public.is_clinic_member(clinic_id));

-- ─────────────────────────────────────────────
-- 3. CLINIC PATIENT REGISTER — every patient a clinic sees (app users + walk-ins)
-- ─────────────────────────────────────────────
create table if not exists public.clinic_patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,   -- linked Mediflow app user (null = walk-in)
  name text not null,
  phone text,
  gender text,
  dob date,
  blood_group text,
  allergies text,
  conditions text,
  notes text,
  created_at timestamptz not null default now()
);
create unique index if not exists clinic_patients_clinic_user_key on public.clinic_patients (clinic_id, user_id) where user_id is not null;
create index if not exists clinic_patients_clinic_idx on public.clinic_patients (clinic_id, name);

alter table public.clinic_patients enable row level security;
drop policy if exists "clinic_patients_member_all" on public.clinic_patients;
create policy "clinic_patients_member_all" on public.clinic_patients for all
  using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id));
drop policy if exists "clinic_patients_self_read" on public.clinic_patients;
create policy "clinic_patients_self_read" on public.clinic_patients for select using (user_id = auth.uid());

-- Create / refresh the register row for an app user (copies MediPass basics)
create or replace function public.ensure_clinic_patient(p_clinic uuid, p_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; p record;
begin
  select * into p from public.patients where id = p_user;
  if p.id is null then return null; end if;
  select id into v_id from public.clinic_patients where clinic_id = p_clinic and user_id = p_user;
  if v_id is null then
    insert into public.clinic_patients (clinic_id, user_id, name, phone, gender, dob, blood_group, allergies, conditions)
    values (p_clinic, p_user, p.name, p.phone, p.gender, p.dob, p.blood_group, p.allergies, p.conditions)
    returning id into v_id;
  else
    update public.clinic_patients set name = p.name, phone = coalesce(p.phone, phone), gender = coalesce(p.gender, gender),
      dob = coalesce(p.dob, dob), blood_group = coalesce(p.blood_group, blood_group),
      allergies = coalesce(p.allergies, allergies), conditions = coalesce(p.conditions, conditions)
    where id = v_id;
  end if;
  return v_id;
end $$;

-- Clinic finds an app patient by exact Mediflow ID or phone (no browsing / enumeration)
create or replace function public.clinic_find_patient(p_clinic uuid, p_query text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := trim(p_query); digits text := right(regexp_replace(p_query, '\D', '', 'g'), 10); r jsonb;
begin
  if not public.is_clinic_member(p_clinic) then raise exception 'Not allowed'; end if;
  select jsonb_build_object('user_id', id, 'name', name, 'patient_id', patient_id, 'phone', phone, 'gender', gender, 'dob', dob)
  into r from public.patients
  where upper(patient_id) = upper(q) or (length(digits) = 10 and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = digits)
  limit 1;
  return r;
end $$;

create or replace function public.clinic_link_patient(p_clinic uuid, p_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.is_clinic_member(p_clinic) then raise exception 'Not allowed'; end if;
  return public.ensure_clinic_patient(p_clinic, p_user);
end $$;

-- ─────────────────────────────────────────────
-- 4. APPOINTMENTS — online (video) / in-clinic, walk-ins, clinic-side booking
-- ─────────────────────────────────────────────
alter table public.appointments add column if not exists clinic_patient_id uuid references public.clinic_patients (id) on delete set null;
alter table public.appointments add column if not exists mode text not null default 'in_clinic';
alter table public.appointments add column if not exists video_room text;
alter table public.appointments add column if not exists notes text;
alter table public.appointments add column if not exists source text not null default 'app';
alter table public.appointments add column if not exists created_by uuid;
alter table public.appointments alter column patient_id drop not null;   -- walk-ins have no app account

do $$ begin
  alter table public.appointments add constraint appointments_mode_chk check (mode in ('in_clinic', 'video'));
exception when duplicate_object then null; end $$;

drop policy if exists "appointments_clinic_insert" on public.appointments;
create policy "appointments_clinic_insert" on public.appointments for insert with check (public.is_clinic_member(clinic_id));
drop policy if exists "appointments_clinic_update" on public.appointments;
create policy "appointments_clinic_update" on public.appointments for update
  using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id));

-- Patients can see their walk-in-linked appointments too
drop policy if exists "appointments_select_via_register" on public.appointments;
create policy "appointments_select_via_register" on public.appointments for select using (
  exists (select 1 from public.clinic_patients cp where cp.id = clinic_patient_id and cp.user_id = auth.uid())
);

create or replace function public.appointments_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.clinic_patient_id is null and new.patient_id is not null then
    new.clinic_patient_id := public.ensure_clinic_patient(new.clinic_id, new.patient_id);
  end if;
  if new.mode = 'video' and new.video_room is null then
    new.video_room := 'mediflow-' || encode(extensions.gen_random_bytes(9), 'hex');
  end if;
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end $$;

drop trigger if exists trg_appointments_before_insert on public.appointments;
create trigger trg_appointments_before_insert before insert on public.appointments
  for each row execute function public.appointments_before_insert();

create or replace function public.appointments_before_update()
returns trigger language plpgsql as $$
begin
  if new.mode = 'video' and new.video_room is null then
    new.video_room := 'mediflow-' || encode(extensions.gen_random_bytes(9), 'hex');
  end if;
  return new;
end $$;
drop trigger if exists trg_appointments_before_update on public.appointments;
create trigger trg_appointments_before_update before update on public.appointments
  for each row execute function public.appointments_before_update();

-- Back-fill the register for existing appointments
update public.appointments a set clinic_patient_id = public.ensure_clinic_patient(a.clinic_id, a.patient_id)
where a.clinic_patient_id is null and a.patient_id is not null;

-- ─────────────────────────────────────────────
-- 5. PRESCRIPTIONS
-- ─────────────────────────────────────────────
create table if not exists public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  clinic_patient_id uuid not null references public.clinic_patients (id) on delete cascade,
  appointment_id uuid references public.appointments (id) on delete set null,
  doctor_id uuid references public.doctors (id) on delete set null,
  doctor_name text,
  complaints text,
  diagnosis text,
  vitals jsonb not null default '{}',     -- {bp, pulse, temp, spo2, weight}
  medicines jsonb not null default '[]',  -- [{name, dose, morning, afternoon, night, food, days, notes}]
  tests text,
  advice text,
  follow_up date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists prescriptions_patient_idx on public.prescriptions (clinic_patient_id, created_at desc);

-- ─────────────────────────────────────────────
-- 6. BILLING
-- ─────────────────────────────────────────────
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  clinic_patient_id uuid not null references public.clinic_patients (id) on delete cascade,
  appointment_id uuid references public.appointments (id) on delete set null,
  number text,
  items jsonb not null default '[]',      -- [{description, qty, rate}]
  subtotal numeric not null default 0,
  discount numeric not null default 0,
  gst_percent numeric not null default 0,
  gst_amount numeric not null default 0,
  total numeric not null default 0,
  status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'partial', 'void')),
  paid_amount numeric not null default 0,
  payment_method text check (payment_method is null or payment_method in ('cash', 'upi', 'card', 'insurance', 'other')),
  paid_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists invoices_number_key on public.invoices (clinic_id, number);
create index if not exists invoices_clinic_date_idx on public.invoices (clinic_id, created_at desc);

create or replace function public.invoices_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if new.number is null then
    perform pg_advisory_xact_lock(hashtext(new.clinic_id::text));
    select count(*) + 1 into n from public.invoices where clinic_id = new.clinic_id;
    new.number := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, 4, '0');
  end if;
  return new;
end $$;
drop trigger if exists trg_invoices_before_insert on public.invoices;
create trigger trg_invoices_before_insert before insert on public.invoices
  for each row execute function public.invoices_before_insert();

-- ─────────────────────────────────────────────
-- 7. FILES (reports, scans) + storage usage
-- ─────────────────────────────────────────────
create table if not exists public.clinic_files (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  clinic_patient_id uuid references public.clinic_patients (id) on delete cascade,
  name text not null,
  path text not null unique,
  size_bytes bigint not null default 0,
  mime text,
  uploaded_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- RLS for prescriptions / invoices / files: clinic staff manage, the patient reads their own
do $$
declare t text;
begin
  foreach t in array array['prescriptions', 'invoices', 'clinic_files'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_member_all" on public.%I', t, t);
    execute format('create policy "%s_member_all" on public.%I for all using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id))', t, t);
    execute format('drop policy if exists "%s_patient_read" on public.%I', t, t);
    execute format('create policy "%s_patient_read" on public.%I for select using (exists (select 1 from public.clinic_patients cp where cp.id = clinic_patient_id and cp.user_id = auth.uid()))', t, t);
  end loop;
end $$;

-- Storage buckets: private clinic files, public branding (logos)
insert into storage.buckets (id, name, public) values ('clinic-files', 'clinic-files', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('clinic-branding', 'clinic-branding', true) on conflict (id) do nothing;

drop policy if exists "clinic_files_member_rw" on storage.objects;
create policy "clinic_files_member_rw" on storage.objects for all
  using (bucket_id = 'clinic-files' and public.is_clinic_member_text((storage.foldername(name))[1]))
  with check (bucket_id = 'clinic-files' and public.is_clinic_member_text((storage.foldername(name))[1]));
drop policy if exists "clinic_files_patient_read" on storage.objects;
create policy "clinic_files_patient_read" on storage.objects for select using (
  bucket_id = 'clinic-files' and exists (
    select 1 from public.clinic_files f join public.clinic_patients cp on cp.id = f.clinic_patient_id
    where f.path = storage.objects.name and cp.user_id = auth.uid())
);
drop policy if exists "clinic_branding_read" on storage.objects;
create policy "clinic_branding_read" on storage.objects for select using (bucket_id = 'clinic-branding');
drop policy if exists "clinic_branding_write" on storage.objects;
create policy "clinic_branding_write" on storage.objects for insert
  with check (bucket_id = 'clinic-branding' and public.is_clinic_member_text((storage.foldername(name))[1]));
drop policy if exists "clinic_branding_update" on storage.objects;
create policy "clinic_branding_update" on storage.objects for update
  using (bucket_id = 'clinic-branding' and public.is_clinic_member_text((storage.foldername(name))[1]));

-- ─────────────────────────────────────────────
-- 8. GRANTS + REALTIME
-- ─────────────────────────────────────────────
grant execute on function public.clinic_find_patient(uuid, text) to authenticated;
grant execute on function public.clinic_link_patient(uuid, uuid) to authenticated;
revoke all on function public.ensure_clinic_patient(uuid, uuid) from public, anon, authenticated;

do $$ begin alter publication supabase_realtime add table public.prescriptions; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.invoices; exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';

-- Check: expect 4 tables and the dispatch function
select 'table' as kind, table_name as name from information_schema.tables
where table_schema = 'public' and table_name in ('clinic_patients', 'prescriptions', 'invoices', 'clinic_files')
union all
select 'clinic slug', slug from public.clinics where id = '031473bf-3ab4-4fe4-b223-9277b97d9141';
