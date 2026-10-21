// Clinic portal data: membership, today's appointments, emergency actions.

import { supabase } from "@/lib/supabase";
import { postJSON } from "@/lib/api";
import { timeToMinutes } from "@/lib/appointments";
import type { EmergencyCase } from "@/lib/emergency";

export type ClinicInfo = { id: string; name: string; area: string; address: string; phone: string };

export type PatientCard = {
  id: string;
  name: string;
  phone?: string | null;
  patient_id?: string | null;
  dob?: string | null;
  gender?: string | null;
  blood_group?: string | null;
  allergies?: string | null;
  conditions?: string | null;
  medications?: string | null;
  address?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  insurance_number?: string | null;
};

export type ClinicAppointment = {
  id: string;
  patient_id: string;
  doctor_id: string | null;
  appointment_date: string;
  appointment_time: string;
  status: string;
  priority?: string;
  symptoms?: string | null;
  consultation_fee: number;
  patient?: PatientCard;
  doctor_name?: string;
};

export type ClinicEmergency = EmergencyCase & { patient?: PatientCard };

const PRIORITY: Record<string, number> = { emergency: 0, urgent: 1, normal: 2 };

/** Clinics this signed-in user staffs (empty → not a clinic account). */
export async function getMyClinics(): Promise<ClinicInfo[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: links } = await supabase.from("clinic_users").select("clinic_id").eq("user_id", user.id);
  const ids = (links ?? []).map((l: { clinic_id: string }) => l.clinic_id);
  if (!ids.length) return [];
  const { data } = await supabase.from("clinics").select("id, name, area, address, phone").in("id", ids);
  return (data as ClinicInfo[]) ?? [];
}

async function patientsById(ids: string[]): Promise<Record<string, PatientCard>> {
  if (!ids.length) return {};
  const { data } = await supabase.from("patients").select("*").in("id", [...new Set(ids)]);
  return Object.fromEntries(((data as PatientCard[]) ?? []).map((p) => [p.id, p]));
}

/** Appointments for a day — emergency > urgent > normal, then by time. */
export async function getClinicAppointments(clinicId: string, date: string): Promise<ClinicAppointment[]> {
  const { data } = await supabase.from("appointments").select("*").eq("clinic_id", clinicId).eq("appointment_date", date);
  const rows = (data as ClinicAppointment[]) ?? [];
  const [patients, { data: doctors }] = await Promise.all([
    patientsById(rows.map((r) => r.patient_id)),
    supabase.from("doctors").select("id, name").eq("clinic_id", clinicId),
  ]);
  return rows
    .map((r) => ({ ...r, patient: patients[r.patient_id], doctor_name: doctors?.find((d) => d.id === r.doctor_id)?.name ?? "Duty doctor" }))
    .sort(
      (a, b) =>
        (PRIORITY[a.priority ?? "normal"] ?? 2) - (PRIORITY[b.priority ?? "normal"] ?? 2) ||
        timeToMinutes(a.appointment_time) - timeToMinutes(b.appointment_time)
    );
}

export async function getActiveEmergencies(clinicId: string): Promise<ClinicEmergency[]> {
  const { data } = await supabase
    .from("emergency_cases")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("status", "assigned")
    .order("created_at", { ascending: true });
  const rows = (data as ClinicEmergency[]) ?? [];
  const patients = await patientsById(rows.map((r) => r.patient_id));
  return rows.map((r) => ({ ...r, patient: patients[r.patient_id] }));
}

export async function getClinicDoctors(clinicId: string): Promise<{ id: string; name: string; speciality: string }[]> {
  const { data } = await supabase.from("doctors").select("*").eq("clinic_id", clinicId);
  return ((data as { id: string; name: string; speciality: string; is_active?: boolean }[]) ?? []).filter((d) => d.is_active !== false);
}

/** "Spoke to Patient" / "Doctor Assigned" — stops all escalation and notifies patient + contact. */
export async function respondToEmergency(caseId: string, action: "spoke_to_patient" | "doctor_assigned", doctor?: string) {
  try {
    await postJSON("/emergency/confirm", { case_id: caseId, action, doctor });
  } catch {
    // Backend down: still stop the escalation in the database
    const { error } = await supabase.rpc("clinic_respond_emergency", { p_case: caseId, p_action: action, p_doctor: doctor ?? null });
    if (error) throw error;
  }
}

export async function markAppointment(id: string, status: "arrived" | "no_show" | "completed" | "confirmed" | "cancelled") {
  const { error } = await supabase.rpc("clinic_mark_appointment", { p_id: id, p_status: status });
  if (error) throw error;
}

export function ageFromDob(dob?: string | null) {
  if (!dob) return null;
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
  return age;
}

// ── Self-serve sign-up & clinic settings ──

export type ClinicRegistration = {
  clinicId: string | null; // an existing map listing being claimed, or null for a new clinic
  name: string;
  phone: string;
  whatsapp: string;
  address: string;
  area: string;
  city: string;
  lat: number;
  lng: number;
  specialities: string[];
  fee: number;
  open: string; // "09:00"
  close: string; // "21:00"
  days: string[]; // ["Mon", …]
  emergency: boolean;
};

/** Claims a map listing (or creates a clinic) and makes the signed-in user its owner. */
export async function registerClinic(r: ClinicRegistration): Promise<string> {
  const { data, error } = await supabase.rpc("register_clinic", {
    p_clinic: r.clinicId,
    p_name: r.name,
    p_phone: r.phone,
    p_whatsapp: r.whatsapp,
    p_address: r.address,
    p_area: r.area,
    p_city: r.city,
    p_lat: r.lat,
    p_lng: r.lng,
    p_specialities: r.specialities,
    p_fee: r.fee,
    p_open: r.open,
    p_close: r.close,
    p_days: r.days,
    p_emergency: r.emergency,
  });
  if (error) throw new Error(/could not find the function|PGRST202/i.test(error.message) ? "Database update pending — run migration 20261019_real_data.sql." : error.message);
  return data as string;
}

export type ClinicProfile = ClinicInfo & {
  city: string;
  whatsapp_phone: string | null;
  consultation_fee: number;
  specialities: string[] | null;
  open_time: string | null;
  close_time: string | null;
  hours: Record<string, [number, number][]> | null;
  slot_minutes: number | null;
  is_emergency_ready: boolean;
  latitude: number | null;
  longitude: number | null;
};

export async function getClinicProfile(id: string): Promise<ClinicProfile | null> {
  const { data } = await supabase.from("clinics").select("*").eq("id", id).maybeSingle();
  return (data as ClinicProfile) ?? null;
}

export async function updateClinicProfile(id: string, values: Partial<ClinicProfile>) {
  const res = await supabase.from("clinics").update(values).eq("id", id).select("id");
  if (res.error) throw res.error;
  if (!res.data?.length) throw new Error("No permission to update this clinic.");
}

export type ClinicDoctor = {
  id: string;
  clinic_id: string;
  name: string;
  speciality: string;
  qualification: string | null;
  experience_years: number | null;
  consultation_fee: number | null;
  available_days: string[] | null;
  is_active: boolean;
};

export async function listClinicDoctors(clinicId: string): Promise<ClinicDoctor[]> {
  const { data } = await supabase.from("doctors").select("*").eq("clinic_id", clinicId).order("name");
  return ((data as ClinicDoctor[]) ?? []).map((d) => ({ ...d, is_active: d.is_active !== false }));
}

export async function saveClinicDoctor(d: Partial<ClinicDoctor> & { clinic_id: string }) {
  const values = {
    clinic_id: d.clinic_id,
    name: d.name?.trim(),
    speciality: d.speciality,
    qualification: d.qualification || null,
    experience_years: d.experience_years ?? null,
    consultation_fee: d.consultation_fee ?? null,
    available_days: d.available_days?.length ? d.available_days : null,
    is_active: d.is_active ?? true,
  };
  const res = d.id
    ? await supabase.from("doctors").update(values).eq("id", d.id).select("id")
    : await supabase.from("doctors").insert({ ...values, rating: null, total_reviews: null }).select("id");
  if (res.error) throw res.error;
  if (!res.data?.length) throw new Error("No permission to change doctors for this clinic.");
}
