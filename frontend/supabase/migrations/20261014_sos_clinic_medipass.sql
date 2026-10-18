-- Mediflow AI — Emergency SOS, Clinic Portal, MediPass, Onboarding, Account deletion
-- Run AFTER 20261013_booking_profile.sql, in Supabase Dashboard → SQL Editor. Safe to re-run.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────
-- 1. PATIENTS — onboarding, emergency contact, MediPass details
-- ─────────────────────────────────────────────
alter table public.patients
  add column if not exists avatar_url text,
  add column if not exists onboarded_at timestamptz,
  add column if not exists health_flags text[] default '{}',
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add column if not exists dob date,
  add column if not exists blood_group text,
  add column if not exists allergies text,
  add column if not exists conditions text,
  add column if not exists medications text,
  add column if not exists address text,
  add column if not exists insurance_number text,
  add column if not exists aadhaar_last4 text check (aadhaar_last4 is null or aadhaar_last4 ~ '^[0-9]{4}$');
-- Only the last 4 digits of Aadhaar are stored (Aadhaar Act limits storing full numbers).

-- Existing patients skip the new onboarding (only rows created before this migration)
update public.patients set onboarded_at = coalesce(onboarded_at, now())
where onboarded_at is null and not exists (select 1 from pg_class where relname = 'mediflow_onboarding_marker');
create table if not exists public.mediflow_onboarding_marker (done boolean);
alter table public.mediflow_onboarding_marker enable row level security;

-- ─────────────────────────────────────────────
-- 2. CLINICS — emergency readiness, coordinates, WhatsApp
-- ─────────────────────────────────────────────
alter table public.clinics
  add column if not exists is_emergency_ready boolean not null default false,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists whatsapp_phone text;

-- Approximate coordinates for existing Bengaluru areas (edit with exact clinic pins later)
update public.clinics c set latitude = v.lat, longitude = v.lng
from (values
  ('MG Road', 12.9756, 77.6050), ('Koramangala', 12.9352, 77.6245), ('Indiranagar', 12.9784, 77.6408),
  ('JP Nagar', 12.9063, 77.5857), ('Whitefield', 12.9698, 77.7500), ('Jayanagar', 12.9250, 77.5938)
) as v(area, lat, lng)
where c.area = v.area and c.latitude is null;

-- DEMO DATA: mark current clinics emergency-ready so SOS can be tested. Adjust per real capability.
update public.clinics set is_emergency_ready = true where is_active = true and is_emergency_ready = false;

-- ─────────────────────────────────────────────
-- 3. APPOINTMENTS — priority, confirmation, reminders, arrival
-- ─────────────────────────────────────────────
alter table public.appointments
  add column if not exists priority text not null default 'normal',
  add column if not exists escalation_count int not null default 0,
  add column if not exists confirmed_at timestamptz,
  add column if not exists reminder_sent_at timestamptz;

do $$ begin
  alter table public.appointments add constraint appointments_priority_chk
    check (priority in ('normal', 'urgent', 'emergency'));
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────
-- 4. CLINIC USERS — staff accounts linked to a clinic
-- ─────────────────────────────────────────────
create table if not exists public.clinic_users (
  user_id uuid not null references auth.users (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  role text not null default 'staff' check (role in ('owner', 'staff', 'doctor')),
  created_at timestamptz not null default now(),
  primary key (user_id, clinic_id)
);
alter table public.clinic_users enable row level security;

create or replace function public.is_clinic_member(p_clinic uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.clinic_users where user_id = auth.uid() and clinic_id = p_clinic);
$$;

drop policy if exists "clinic_users_select_own" on public.clinic_users;
create policy "clinic_users_select_own" on public.clinic_users for select using (user_id = auth.uid());

-- To link a clinic staff login (run per staff member):
--   insert into public.clinic_users (user_id, clinic_id, role)
--   select id, '<clinic uuid>', 'owner' from auth.users where email = 'staff@clinic.com';

-- ─────────────────────────────────────────────
-- 5. EMERGENCY CASES + live event timeline
-- ─────────────────────────────────────────────
create table if not exists public.emergency_cases (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references auth.users (id) on delete cascade,
  case_type text not null default 'Emergency',
  message text,
  latitude double precision,
  longitude double precision,
  area text,
  clinic_id uuid references public.clinics (id),
  distance_km numeric,
  status text not null default 'assigned'
    check (status in ('unassigned', 'assigned', 'spoke_to_patient', 'doctor_assigned', 'cancelled')),
  escalation_count int not null default 0,
  tried_clinic_ids uuid[] not null default '{}',
  assigned_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid,
  doctor_name text,
  last_clinic_alert_at timestamptz,
  last_clinic_call_at timestamptz,
  last_contact_alert_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists emergency_cases_active_idx on public.emergency_cases (status, assigned_at);

create table if not exists public.emergency_events (
  id bigserial primary key,
  case_id uuid not null references public.emergency_cases (id) on delete cascade,
  kind text not null,
  message text not null,
  data jsonb not null default '{}',
  needs_notify boolean not null default false, -- outbound WhatsApp still to be sent by the backend
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists emergency_events_case_idx on public.emergency_events (case_id, created_at);

alter table public.emergency_cases enable row level security;
alter table public.emergency_events enable row level security;

drop policy if exists "emergency_cases_patient" on public.emergency_cases;
create policy "emergency_cases_patient" on public.emergency_cases for select using (patient_id = auth.uid());
drop policy if exists "emergency_cases_clinic" on public.emergency_cases;
create policy "emergency_cases_clinic" on public.emergency_cases for select using (public.is_clinic_member(clinic_id));
drop policy if exists "emergency_events_visible" on public.emergency_events;
create policy "emergency_events_visible" on public.emergency_events for select using (
  exists (select 1 from public.emergency_cases e
          where e.id = case_id and (e.patient_id = auth.uid() or public.is_clinic_member(e.clinic_id)))
);
-- No insert/update policies: cases change only through the functions below.

-- Nearest emergency-ready clinic, excluding clinics already tried
create or replace function public.nearest_emergency_clinic(p_lat double precision, p_lng double precision, p_exclude uuid[])
returns table (clinic_id uuid, distance_km numeric)
language sql stable security definer set search_path = public as $$
  select c.id,
         case when p_lat is null or c.latitude is null then null
              else round((6371 * 2 * asin(sqrt(
                     power(sin(radians(c.latitude - p_lat) / 2), 2) +
                     cos(radians(p_lat)) * cos(radians(c.latitude)) * power(sin(radians(c.longitude - p_lng) / 2), 2)
                   )))::numeric, 1) end as distance_km
  from public.clinics c
  where c.is_active and c.is_emergency_ready and not (c.id = any (coalesce(p_exclude, '{}')))
  order by distance_km nulls last, c.wait_time_minutes nulls last, c.rating desc nulls last
  limit 1;
$$;

-- Patient (or chat) creates an SOS case — auto-assigned, no confirmation
create or replace function public.create_emergency_case(
  p_type text, p_message text, p_lat double precision, p_lng double precision, p_area text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_case uuid;
  v_clinic uuid;
  v_dist numeric;
  v_name text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  -- Re-use an active case from the last 30 minutes instead of creating duplicates
  select id into v_case from public.emergency_cases
  where patient_id = v_uid and status in ('assigned', 'unassigned') and created_at > now() - interval '30 minutes'
  order by created_at desc limit 1;
  if v_case is not null then return v_case; end if;

  select n.clinic_id, n.distance_km into v_clinic, v_dist from public.nearest_emergency_clinic(p_lat, p_lng, '{}') n;

  insert into public.emergency_cases (patient_id, case_type, message, latitude, longitude, area, clinic_id, distance_km, status, tried_clinic_ids)
  values (v_uid, coalesce(nullif(p_type, ''), 'Emergency'), left(p_message, 500), p_lat, p_lng, p_area, v_clinic, v_dist,
          case when v_clinic is null then 'unassigned' else 'assigned' end,
          case when v_clinic is null then '{}' else array[v_clinic] end)
  returning id into v_case;

  insert into public.emergency_events (case_id, kind, message) values (v_case, 'created', 'Emergency case created');

  if v_clinic is null then
    insert into public.emergency_events (case_id, kind, message)
    values (v_case, 'no_clinic', 'No emergency-ready clinic found nearby — please call 108 now');
  else
    select name into v_name from public.clinics where id = v_clinic;
    insert into public.emergency_events (case_id, kind, message, data, needs_notify)
    values (v_case, 'assigned', 'Assigned to ' || v_name || coalesce(', ' || v_dist || ' km away', ''),
            jsonb_build_object('clinic_id', v_clinic, 'distance_km', v_dist), true);
  end if;
  return v_case;
end $$;

-- Re-assign cases not confirmed within 3 minutes (run by pg_cron, the backend, and open status pages)
create or replace function public.escalate_emergencies()
returns int language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_next uuid;
  v_dist numeric;
  v_name text;
  v_count int := 0;
begin
  for r in
    select * from public.emergency_cases
    where status = 'assigned' and assigned_at < now() - interval '3 minutes'
    for update skip locked
  loop
    select n.clinic_id, n.distance_km into v_next, v_dist
    from public.nearest_emergency_clinic(r.latitude, r.longitude, r.tried_clinic_ids) n;

    insert into public.emergency_events (case_id, kind, message, data, needs_notify)
    values (r.id, 'cancel_notice', 'Previous clinic did not confirm in 3 minutes',
            jsonb_build_object('clinic_id', r.clinic_id), true);

    if v_next is null then
      update public.emergency_cases set status = 'unassigned', escalation_count = escalation_count + 1 where id = r.id;
      insert into public.emergency_events (case_id, kind, message)
      values (r.id, 'no_clinic', 'No other clinic confirmed — please call 108 for an ambulance now');
    else
      select name into v_name from public.clinics where id = v_next;
      update public.emergency_cases
      set clinic_id = v_next, distance_km = v_dist, assigned_at = now(), escalation_count = escalation_count + 1,
          tried_clinic_ids = tried_clinic_ids || v_next,
          last_clinic_alert_at = null, last_clinic_call_at = null
      where id = r.id;
      insert into public.emergency_events (case_id, kind, message, data, needs_notify)
      values (r.id, 'reassigned', 'Trying next clinic — ' || v_name || coalesce(', ' || v_dist || ' km away', ''),
              jsonb_build_object('clinic_id', v_next, 'distance_km', v_dist), true);
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Clinic staff stop the escalation: "Spoke to Patient" or "Doctor Assigned"
create or replace function public.clinic_respond_emergency(p_case uuid, p_action text, p_doctor text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_clinic uuid;
begin
  if p_action not in ('spoke_to_patient', 'doctor_assigned') then raise exception 'Invalid action'; end if;
  select clinic_id into v_clinic from public.emergency_cases where id = p_case and status = 'assigned' for update;
  if v_clinic is null or not public.is_clinic_member(v_clinic) then raise exception 'Not allowed'; end if;

  update public.emergency_cases
  set status = p_action, confirmed_at = now(), confirmed_by = auth.uid(), doctor_name = nullif(p_doctor, '')
  where id = p_case;
  insert into public.emergency_events (case_id, kind, message, data, needs_notify)
  values (p_case, p_action,
          case when p_action = 'doctor_assigned'
               then '✅ ' || coalesce(nullif(p_doctor, ''), 'A doctor') || ' assigned — you''re expected'
               else '✅ Clinic spoke to the patient' end,
          jsonb_build_object('doctor', p_doctor), true);
end $$;

-- Backend records each alert it sends (timeline + throttling timestamps)
create or replace function public.record_emergency_alert(p_case uuid, p_kind text, p_message text, p_mode text)
returns void language plpgsql security definer set search_path = public as $$
declare v_case public.emergency_cases;
begin
  select * into v_case from public.emergency_cases where id = p_case;
  if v_case.id is null then return; end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and auth.uid() is distinct from v_case.patient_id
     and not public.is_clinic_member(v_case.clinic_id) then
    raise exception 'Not allowed';
  end if;
  if p_kind not in ('whatsapp_clinic', 'call_clinic', 'whatsapp_contact') then raise exception 'Invalid kind'; end if;

  update public.emergency_cases set
    last_clinic_alert_at = case when p_kind = 'whatsapp_clinic' then now() else last_clinic_alert_at end,
    last_clinic_call_at = case when p_kind = 'call_clinic' then now() else last_clinic_call_at end,
    last_contact_alert_at = case when p_kind = 'whatsapp_contact' then now() else last_contact_alert_at end
  where id = p_case;

  if p_mode <> 'no_number' then
    insert into public.emergency_events (case_id, kind, message, data)
    values (p_case, p_kind, p_message, jsonb_build_object('mode', p_mode));
  end if;
end $$;

-- Patient says they're safe
create or replace function public.cancel_emergency(p_case uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.emergency_cases set status = 'cancelled'
  where id = p_case and patient_id = auth.uid() and status in ('assigned', 'unassigned');
  if found then
    insert into public.emergency_events (case_id, kind, message, needs_notify)
    values (p_case, 'cancelled', 'Patient marked themselves safe — case cancelled', true);
  end if;
end $$;

-- ─────────────────────────────────────────────
-- 5b. AMBULANCE DISPATCH + live tracking
--     Clinic dispatches its ambulance → driver opens a secret link that streams GPS →
--     patient's status page shows the ambulance moving on a map (Realtime on emergency_cases).
-- ─────────────────────────────────────────────
alter table public.emergency_cases
  add column if not exists ambulance_token text unique,
  add column if not exists ambulance_driver_name text,
  add column if not exists ambulance_driver_phone text,
  add column if not exists ambulance_vehicle text,
  add column if not exists ambulance_status text
    check (ambulance_status is null or ambulance_status in ('dispatched', 'arrived_patient', 'to_hospital', 'completed')),
  add column if not exists ambulance_lat double precision,
  add column if not exists ambulance_lng double precision,
  add column if not exists ambulance_speed_kmh numeric,
  add column if not exists ambulance_updated_at timestamptz,
  add column if not exists ambulance_dispatched_at timestamptz;

-- Dispatching an ambulance also stops the escalation chain
alter table public.emergency_cases drop constraint if exists emergency_cases_status_check;
alter table public.emergency_cases add constraint emergency_cases_status_check
  check (status in ('unassigned', 'assigned', 'spoke_to_patient', 'doctor_assigned', 'ambulance_dispatched', 'cancelled'));

create or replace function public.clinic_dispatch_ambulance(p_case uuid, p_driver text, p_phone text, p_vehicle text)
returns text language plpgsql security definer set search_path = public as $$
declare v_clinic uuid; v_token text := encode(gen_random_bytes(18), 'hex');
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

-- Driver page (no login — the secret token is the credential)
create or replace function public.get_ambulance_job(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'case_id', e.id, 'case_type', e.case_type, 'status', e.status, 'ambulance_status', e.ambulance_status,
    'patient_name', p.name, 'patient_phone', p.phone, 'patient_lat', e.latitude, 'patient_lng', e.longitude,
    'area', e.area, 'clinic_name', c.name, 'clinic_lat', c.latitude, 'clinic_lng', c.longitude,
    'vehicle', e.ambulance_vehicle, 'driver', e.ambulance_driver_name)
  from public.emergency_cases e
  left join public.patients p on p.id = e.patient_id
  left join public.clinics c on c.id = e.clinic_id
  where e.ambulance_token = p_token and e.status = 'ambulance_dispatched'
    and coalesce(e.ambulance_status, 'dispatched') <> 'completed';
$$;

create or replace function public.update_ambulance_location(p_token text, p_lat double precision, p_lng double precision, p_speed_kmh numeric)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then return false; end if;
  update public.emergency_cases
  set ambulance_lat = p_lat, ambulance_lng = p_lng, ambulance_speed_kmh = p_speed_kmh, ambulance_updated_at = now()
  where ambulance_token = p_token and status = 'ambulance_dispatched'
    and coalesce(ambulance_status, 'dispatched') <> 'completed'
    and (ambulance_updated_at is null or ambulance_updated_at < now() - interval '2 seconds'); -- throttle
  return found;
end $$;

create or replace function public.ambulance_set_status(p_token text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_case uuid;
begin
  if p_status not in ('arrived_patient', 'to_hospital', 'completed') then raise exception 'Invalid status'; end if;
  update public.emergency_cases set ambulance_status = p_status
  where ambulance_token = p_token and status = 'ambulance_dispatched' returning id into v_case;
  if v_case is not null then
    insert into public.emergency_events (case_id, kind, message)
    values (v_case, 'ambulance_' || p_status,
            case p_status when 'arrived_patient' then '🚑 Ambulance has reached you'
                          when 'to_hospital' then '🚑 On the way to the hospital'
                          else '✅ Ambulance trip completed' end);
  end if;
end $$;

grant execute on function public.clinic_dispatch_ambulance(uuid, text, text, text) to authenticated;
grant execute on function public.get_ambulance_job(text) to anon, authenticated;
grant execute on function public.update_ambulance_location(text, double precision, double precision, numeric) to anon, authenticated;
grant execute on function public.ambulance_set_status(text, text) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 6. CLINIC DASHBOARD access
-- ─────────────────────────────────────────────
drop policy if exists "appointments_clinic_select" on public.appointments;
create policy "appointments_clinic_select" on public.appointments for select using (public.is_clinic_member(clinic_id));

-- Clinic sees the profile (MediPass details) of patients who booked with / were assigned to them
drop policy if exists "patients_clinic_select" on public.patients;
create policy "patients_clinic_select" on public.patients for select using (
  exists (select 1 from public.appointments a where a.patient_id = patients.id and public.is_clinic_member(a.clinic_id))
  or exists (select 1 from public.emergency_cases e where e.patient_id = patients.id and public.is_clinic_member(e.clinic_id))
);

create or replace function public.clinic_mark_appointment(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_clinic uuid;
begin
  if p_status not in ('arrived', 'no_show', 'completed', 'confirmed') then raise exception 'Invalid status'; end if;
  select clinic_id into v_clinic from public.appointments where id = p_id;
  if v_clinic is null or not public.is_clinic_member(v_clinic) then raise exception 'Not allowed'; end if;
  update public.appointments set status = p_status where id = p_id;
end $$;

-- ─────────────────────────────────────────────
-- 7. MEDIPASS — 15-minute share tokens (data never copied/stored elsewhere)
-- ─────────────────────────────────────────────
create table if not exists public.medipass_tokens (
  token text primary key default encode(gen_random_bytes(18), 'hex'),
  patient_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '15 minutes',
  created_at timestamptz not null default now()
);
alter table public.medipass_tokens enable row level security; -- no policies: functions only

drop function if exists public.create_medipass_token();
create or replace function public.create_medipass_token()
returns table (token text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_token text; v_exp timestamptz;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  delete from public.medipass_tokens m where m.expires_at < now();
  insert into public.medipass_tokens (patient_id) values (auth.uid())
  returning public.medipass_tokens.token, public.medipass_tokens.expires_at into v_token, v_exp;
  return query select v_token, v_exp;
end $$;

create or replace function public.get_medipass(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'patient_id', p.patient_id, 'name', p.name, 'phone', p.phone, 'dob', p.dob, 'gender', p.gender,
    'blood_group', p.blood_group, 'allergies', p.allergies, 'conditions', p.conditions,
    'medications', p.medications, 'address', p.address, 'city', p.city,
    'emergency_contact_name', p.emergency_contact_name, 'emergency_contact_phone', p.emergency_contact_phone,
    'insurance_number', p.insurance_number, 'aadhaar_last4', p.aadhaar_last4, 'avatar_url', p.avatar_url,
    'expires_at', t.expires_at)
  from public.medipass_tokens t join public.patients p on p.id = t.patient_id
  where t.token = p_token and t.expires_at > now();
$$;

-- ─────────────────────────────────────────────
-- 8. DELETE MY ACCOUNT — full wipe (DPDP Act 2023)
-- ─────────────────────────────────────────────
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, storage as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  delete from public.medipass_tokens where patient_id = v_uid;
  delete from public.emergency_cases where patient_id = v_uid;   -- events cascade
  delete from public.appointments where patient_id = v_uid;
  delete from public.clinic_users where user_id = v_uid;
  -- Photos are removed through the Storage API by the app first; this is a best-effort fallback
  -- (newer Supabase versions block direct deletes from storage.objects).
  begin
    delete from storage.objects where bucket_id = 'avatars' and (storage.foldername(name))[1] = v_uid::text;
  exception when others then null;
  end;
  delete from public.patients where id = v_uid;
  delete from auth.users where id = v_uid;                        -- auth record last
end $$;

-- ─────────────────────────────────────────────
-- 9. AVATARS bucket (profile photos) — users write only their own folder
-- ─────────────────────────────────────────────
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do nothing;

drop policy if exists "avatars_read" on storage.objects;
create policy "avatars_read" on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists "avatars_write_own" on storage.objects;
create policy "avatars_write_own" on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ─────────────────────────────────────────────
-- 10. GRANTS, REALTIME, SCHEDULER
-- ─────────────────────────────────────────────
revoke all on function public.escalate_emergencies() from public;
grant execute on function public.create_emergency_case(text, text, double precision, double precision, text) to authenticated;
grant execute on function public.escalate_emergencies() to authenticated, service_role;
grant execute on function public.clinic_respond_emergency(uuid, text, text) to authenticated;
grant execute on function public.cancel_emergency(uuid) to authenticated;
grant execute on function public.record_emergency_alert(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.clinic_mark_appointment(uuid, text) to authenticated;
grant execute on function public.create_medipass_token() to authenticated;
grant execute on function public.get_medipass(text) to anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;

do $$ begin alter publication supabase_realtime add table public.emergency_cases; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.emergency_events; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.appointments; exception when duplicate_object then null; end $$;

-- Server-side escalation every minute (works even if nobody has the app open)
do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('mediflow-escalate-emergencies', '* * * * *', 'select public.escalate_emergencies()');
exception when others then
  raise notice 'pg_cron unavailable (%). Enable it under Database → Extensions; the backend worker also escalates.', sqlerrm;
end $$;
