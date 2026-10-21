-- Mediflow AI — real data everywhere:
--   • clinics come from the map (Google Places / OpenStreetMap) and are saved on first booking
--   • clinics sign themselves up and claim their map listing (self-serve clinic portal)
--   • live platform stats, saved health reports, persisted fitness logs
-- Run in Supabase → SQL Editor AFTER 20261015c_clinic_access.sql. Safe to re-run.
-- (Does not need 20261016_clinic_suite.sql.)

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────
-- 1. CLINICS — map source, claim status, real opening hours
-- ─────────────────────────────────────────────
alter table public.clinics add column if not exists source text;            -- mediflow | google | osm | seed
alter table public.clinics add column if not exists source_place_id text;   -- Google place id / OSM "N123"
alter table public.clinics add column if not exists claimed_at timestamptz; -- set when the clinic signs up
alter table public.clinics add column if not exists maps_url text;
alter table public.clinics add column if not exists hours jsonb;            -- {"Mon": [[540, 1260]], …} minutes from midnight
alter table public.clinics add column if not exists slot_minutes int not null default 30;

-- Map listings have no rating / wait time until real ones exist — never invent them
alter table public.clinics alter column rating drop not null;
alter table public.clinics alter column total_reviews drop not null;
alter table public.clinics alter column wait_time_minutes drop not null;

-- Retire the demo clinics seeded during development (made-up names, doctors and Bengaluru pins).
-- Rows are kept because old appointments point at them, but they are hidden from patients and SOS.
-- Undo with: update public.clinics set is_active = true where source = 'seed';
update public.clinics set source = 'seed', is_active = false, is_emergency_ready = false where source is null;
alter table public.clinics alter column source set default 'mediflow';

create unique index if not exists clinics_source_place_key
  on public.clinics (source, source_place_id) where source_place_id is not null;
create index if not exists clinics_geo_idx on public.clinics (latitude, longitude);

alter table public.clinics enable row level security;
drop policy if exists "clinics_read_all" on public.clinics;
create policy "clinics_read_all" on public.clinics for select using (true);
drop policy if exists "clinics_member_update" on public.clinics;
create policy "clinics_member_update" on public.clinics for update
  using (public.is_clinic_member(id)) with check (public.is_clinic_member(id));

-- Consultation fee for a map listing: ₹200–₹800 in ₹50 steps, stable per place.
-- backend/places.py computes the same number (md5 of "<source>:<place id>") to show it before booking.
create or replace function public.place_fee(p_key text)
returns int language sql immutable as $$
  select 200 + ((('x' || substr(md5(p_key), 1, 7))::bit(28)::int) % 13) * 50;
$$;

create or replace function public._hhmm_minutes(p text)
returns int language sql immutable as $$
  select split_part(p, ':', 1)::int * 60 + split_part(p, ':', 2)::int;
$$;

-- Save a map listing as a clinic row (first booking). Never overwrites an existing row.
create or replace function public.import_place_clinic(
  p_source text, p_place_id text, p_name text, p_address text, p_area text, p_city text,
  p_lat double precision, p_lng double precision, p_phone text, p_rating numeric, p_reviews int,
  p_open text, p_close text, p_hours jsonb, p_specialities text[], p_maps_url text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_source not in ('google', 'osm') or coalesce(p_place_id, '') = '' or coalesce(trim(p_name), '') = '' then
    raise exception 'Invalid place';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Invalid location';
  end if;

  select id into v_id from public.clinics where source = p_source and source_place_id = p_place_id;
  if v_id is not null then return v_id; end if;

  insert into public.clinics (
    name, address, area, city, specialities, rating, total_reviews, consultation_fee, wait_time_minutes, phone,
    open_time, close_time, is_active, is_emergency_ready, latitude, longitude,
    source, source_place_id, maps_url, hours
  ) values (
    left(trim(p_name), 120), left(coalesce(p_address, ''), 300), left(coalesce(p_area, ''), 80), left(coalesce(p_city, ''), 80),
    coalesce(p_specialities, '{General}'),
    case when p_rating between 0 and 5 then p_rating end, case when p_reviews >= 0 then p_reviews end,
    public.place_fee(p_source || ':' || p_place_id), null, left(coalesce(p_phone, ''), 30),
    case when p_open ~ '^\d{2}:\d{2}$' then p_open else '09:00' end,
    case when p_close ~ '^\d{2}:\d{2}$' then p_close else '21:00' end,
    true, false, p_lat, p_lng, p_source, p_place_id, left(p_maps_url, 500), p_hours
  )
  on conflict (source, source_place_id) where source_place_id is not null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.clinics where source = p_source and source_place_id = p_place_id;
  end if;
  return v_id;
end $$;
revoke all on function public.import_place_clinic(text, text, text, text, text, text, double precision, double precision,
  text, numeric, int, text, text, jsonb, text[], text) from public, anon;
grant execute on function public.import_place_clinic(text, text, text, text, text, text, double precision, double precision,
  text, numeric, int, text, text, jsonb, text[], text) to authenticated;

-- Self-serve clinic sign-up: claim a map listing (p_clinic) or create a new clinic, and become its owner.
create or replace function public.register_clinic(
  p_clinic uuid, p_name text, p_phone text, p_whatsapp text, p_address text, p_area text, p_city text,
  p_lat double precision, p_lng double precision, p_specialities text[], p_fee int,
  p_open text, p_close text, p_days text[], p_emergency boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_claimed timestamptz;
  v_source text;
  v_hours jsonb;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Clinic name is required'; end if;
  if coalesce(trim(p_phone), '') = '' then raise exception 'Clinic phone is required'; end if;
  if p_fee is null or p_fee < 0 or p_fee > 100000 then raise exception 'Invalid consultation fee'; end if;
  if p_open !~ '^\d{2}:\d{2}$' or p_close !~ '^\d{2}:\d{2}$' or p_open >= p_close then raise exception 'Invalid opening hours'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Clinic location is required';
  end if;
  if coalesce(array_length(p_days, 1), 0) = 0
     or exists (select 1 from unnest(p_days) d where d not in ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')) then
    raise exception 'Pick the days you are open';
  end if;

  select jsonb_object_agg(d, jsonb_build_array(jsonb_build_array(public._hhmm_minutes(p_open), public._hhmm_minutes(p_close))))
  into v_hours from unnest(p_days) d;

  if p_clinic is not null then
    select claimed_at, source into v_claimed, v_source from public.clinics where id = p_clinic for update;
    if not found or v_source = 'seed' then raise exception 'Clinic not found'; end if;
    if v_claimed is not null and not public.is_clinic_member(p_clinic) then
      raise exception 'This clinic is already registered on Mediflow. Ask its owner to add you.';
    end if;
    update public.clinics set
      name = left(trim(p_name), 120), phone = left(trim(p_phone), 30), whatsapp_phone = nullif(left(trim(coalesce(p_whatsapp, '')), 30), ''),
      address = left(coalesce(p_address, address), 300), area = left(coalesce(p_area, area), 80), city = left(coalesce(p_city, city), 80),
      latitude = p_lat, longitude = p_lng, specialities = coalesce(p_specialities, '{General}'),
      consultation_fee = p_fee, open_time = p_open, close_time = p_close, hours = v_hours,
      is_emergency_ready = coalesce(p_emergency, false), is_active = true, claimed_at = coalesce(claimed_at, now())
    where id = p_clinic;
    v_id := p_clinic;
  else
    insert into public.clinics (
      name, address, area, city, specialities, rating, total_reviews, consultation_fee, wait_time_minutes, phone, whatsapp_phone,
      open_time, close_time, hours, is_active, is_emergency_ready, latitude, longitude, source, claimed_at
    ) values (
      left(trim(p_name), 120), left(coalesce(p_address, ''), 300), left(coalesce(p_area, ''), 80), left(coalesce(p_city, ''), 80),
      coalesce(p_specialities, '{General}'), null, null, p_fee, null, left(trim(p_phone), 30),
      nullif(left(trim(coalesce(p_whatsapp, '')), 30), ''),
      p_open, p_close, v_hours, true, coalesce(p_emergency, false), p_lat, p_lng, 'mediflow', now()
    ) returning id into v_id;
  end if;

  insert into public.clinic_users (user_id, clinic_id, role) values (v_uid, v_id, 'owner') on conflict do nothing;
  return v_id;
end $$;
revoke all on function public.register_clinic(uuid, text, text, text, text, text, text, double precision, double precision,
  text[], int, text, text, text[], boolean) from public, anon;
grant execute on function public.register_clinic(uuid, text, text, text, text, text, text, double precision, double precision,
  text[], int, text, text, text[], boolean) to authenticated;

-- ─────────────────────────────────────────────
-- 2. DOCTORS — managed by the clinic in the portal
-- ─────────────────────────────────────────────
alter table public.doctors add column if not exists is_active boolean not null default true;
alter table public.doctors alter column rating drop not null;
alter table public.doctors alter column total_reviews drop not null;

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
-- 3. APPOINTMENTS — clinics can also cancel
-- ─────────────────────────────────────────────
create or replace function public.clinic_mark_appointment(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_clinic uuid;
begin
  if p_status not in ('arrived', 'no_show', 'completed', 'confirmed', 'cancelled') then raise exception 'Invalid status'; end if;
  select clinic_id into v_clinic from public.appointments where id = p_id;
  if v_clinic is null or not public.is_clinic_member(v_clinic) then raise exception 'Not allowed'; end if;
  update public.appointments set status = p_status where id = p_id;
end $$;

-- ─────────────────────────────────────────────
-- 4. LIVE PLATFORM STATS (home page) — counts only, no personal data
-- ─────────────────────────────────────────────
create or replace function public.platform_stats()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'clinics', (select count(*) from public.clinics where is_active and claimed_at is not null),
    'listed_clinics', (select count(*) from public.clinics where is_active and source in ('google', 'osm')),
    'doctors', (select count(*) from public.doctors d join public.clinics c on c.id = d.clinic_id
                where c.is_active and c.claimed_at is not null and d.is_active),
    'appointments', (select count(*) from public.appointments a join public.clinics c on c.id = a.clinic_id
                     where c.source is distinct from 'seed'),
    'appointments_today', (select count(*) from public.appointments
                           where created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')),
    'completed', (select count(*) from public.appointments where status = 'completed'),
    'patients', (select count(*) from public.patients)
  );
$$;
grant execute on function public.platform_stats() to anon, authenticated;

-- ─────────────────────────────────────────────
-- 5. SAVED HEALTH REPORTS (AI analyses)
-- ─────────────────────────────────────────────
create table if not exists public.health_reports (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source text not null default 'chat' check (source in ('chat', 'fitness')),
  title text,
  analysis text not null,
  created_at timestamptz not null default now()
);
create index if not exists health_reports_patient_idx on public.health_reports (patient_id, created_at desc);
alter table public.health_reports enable row level security;
drop policy if exists "health_reports_own" on public.health_reports;
create policy "health_reports_own" on public.health_reports for all
  using (patient_id = auth.uid()) with check (patient_id = auth.uid());

-- ─────────────────────────────────────────────
-- 6. FITNESS LOGS — one row per patient per day (steps, food, gym)
-- ─────────────────────────────────────────────
create table if not exists public.fitness_logs (
  patient_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  log_date date not null,
  steps int not null default 0,
  calories int not null default 0,
  protein int not null default 0,
  gym_minutes int not null default 0,
  meals jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  primary key (patient_id, log_date)
);
alter table public.fitness_logs enable row level security;
drop policy if exists "fitness_logs_own" on public.fitness_logs;
create policy "fitness_logs_own" on public.fitness_logs for all
  using (patient_id = auth.uid()) with check (patient_id = auth.uid());

notify pgrst, 'reload schema';

-- Check: expect 6 rows
select 'clinics.source_place_id' as item, count(*)::text as ok from information_schema.columns
  where table_schema = 'public' and table_name = 'clinics' and column_name = 'source_place_id'
union all select 'import_place_clinic', count(*)::text from pg_proc where proname = 'import_place_clinic'
union all select 'register_clinic', count(*)::text from pg_proc where proname = 'register_clinic'
union all select 'platform_stats', count(*)::text from pg_proc where proname = 'platform_stats'
union all select 'health_reports', count(*)::text from pg_tables where schemaname = 'public' and tablename = 'health_reports'
union all select 'fitness_logs', count(*)::text from pg_tables where schemaname = 'public' and tablename = 'fitness_logs';
