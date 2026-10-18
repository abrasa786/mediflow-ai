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
  const { data } = await supabase.from("doctors").select("id, name, speciality").eq("clinic_id", clinicId);
  return data ?? [];
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

export async function markAppointment(id: string, status: "arrived" | "no_show" | "completed" | "confirmed") {
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
