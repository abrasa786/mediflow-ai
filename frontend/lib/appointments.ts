// Appointment helpers (Supabase "appointments" table).
// Used by the AI chat, /book, /home and /profile so booking logic lives in one place.

import { supabase } from "@/lib/supabase";

export type AppointmentStatus = "confirmed" | "cancelled" | "completed";

export type Appointment = {
  id: string;
  patient_id: string;
  clinic_id: string;
  doctor_id: string | null;
  appointment_date: string; // YYYY-MM-DD
  appointment_time: string; // "10:00 AM"
  status: AppointmentStatus;
  consultation_fee: number;
  symptoms?: string | null;
  // joined client-side
  clinic_name?: string;
  clinic_area?: string;
  clinic_address?: string;
  clinic_phone?: string;
  doctor_name?: string;
  doctor_speciality?: string;
};

export type NewAppointment = {
  patientId: string;
  clinicId: string;
  doctorId: string | null;
  date: string;
  time: string;
  fee: number;
  symptoms?: string;
};

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "10:30 AM" → minutes since midnight (for sorting / comparisons). */
export function timeToMinutes(t: string) {
  const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return 0;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === "PM") h += 12;
  return h * 60 + Number(m[2]);
}

function byDateTime(a: Appointment, b: Appointment) {
  return a.appointment_date.localeCompare(b.appointment_date) || timeToMinutes(a.appointment_time) - timeToMinutes(b.appointment_time);
}

export async function createAppointment(a: NewAppointment) {
  const row: Record<string, unknown> = {
    patient_id: a.patientId,
    clinic_id: a.clinicId,
    doctor_id: a.doctorId,
    appointment_date: a.date,
    appointment_time: a.time,
    status: "confirmed",
    consultation_fee: a.fee,
  };
  if (a.symptoms) row.symptoms = a.symptoms;

  let res = await supabase.from("appointments").insert(row).select("id").maybeSingle();
  // The optional "symptoms" column may not exist yet (see supabase/migrations) — retry without it
  if (res.error && row.symptoms && /symptoms/i.test(res.error.message)) {
    delete row.symptoms;
    res = await supabase.from("appointments").insert(row).select("id").maybeSingle();
  }
  return res;
}

/** Attach clinic & doctor names (separate queries — no FK join assumptions). */
async function withNames(rows: Appointment[]): Promise<Appointment[]> {
  if (!rows.length) return rows;
  const clinicIds = [...new Set(rows.map((r) => r.clinic_id).filter(Boolean))];
  const doctorIds = [...new Set(rows.map((r) => r.doctor_id).filter(Boolean))] as string[];
  const [{ data: clinics }, { data: doctors }] = await Promise.all([
    supabase.from("clinics").select("id, name, area, address, phone").in("id", clinicIds),
    doctorIds.length
      ? supabase.from("doctors").select("id, name, speciality").in("id", doctorIds)
      : Promise.resolve({ data: [] as { id: string; name: string; speciality: string }[] }),
  ]);
  return rows.map((r) => {
    const c = clinics?.find((x) => x.id === r.clinic_id);
    const d = doctors?.find((x) => x.id === r.doctor_id);
    return {
      ...r,
      clinic_name: c?.name,
      clinic_area: c?.area,
      clinic_address: c?.address,
      clinic_phone: c?.phone,
      doctor_name: d?.name ?? "Duty Doctor",
      doctor_speciality: d?.speciality,
    };
  });
}

export async function getUpcomingAppointments(patientId: string): Promise<Appointment[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("patient_id", patientId)
    .eq("status", "confirmed")
    .gte("appointment_date", todayIso())
    .order("appointment_date", { ascending: true })
    .limit(20);
  if (error) throw error;
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const upcoming = ((data as Appointment[]) ?? []).filter(
    (a) => a.appointment_date > todayIso() || timeToMinutes(a.appointment_time) >= nowMins
  );
  return withNames(upcoming.sort(byDateTime));
}

export async function getPastAppointments(patientId: string): Promise<Appointment[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("patient_id", patientId)
    .order("appointment_date", { ascending: false })
    .limit(30);
  if (error) throw error;
  const today = todayIso();
  const past = ((data as Appointment[]) ?? []).filter((a) => a.status !== "confirmed" || a.appointment_date < today);
  return withNames(past.sort((a, b) => -byDateTime(a, b)));
}

export async function cancelAppointment(appointmentId: string) {
  return supabase.from("appointments").update({ status: "cancelled" }).eq("id", appointmentId).select("id");
}

export async function rescheduleAppointment(appointmentId: string, date: string, time: string) {
  return supabase
    .from("appointments")
    .update({ appointment_date: date, appointment_time: time, status: "confirmed" })
    .eq("id", appointmentId)
    .select("id");
}

let bookedTimesRpc = true;

/** Times already taken for a doctor (or clinic, when no doctor) on a date. */
export async function getBookedTimes(clinicId: string, doctorId: string | null, date: string): Promise<string[]> {
  // Preferred: security-definer RPC (sees all patients' slots, returns only times)
  if (bookedTimesRpc) {
    const rpc = await supabase.rpc("booked_times", { p_clinic: clinicId, p_doctor: doctorId, p_date: date });
    if (!rpc.error && Array.isArray(rpc.data)) {
      return (rpc.data as (string | { booked_times: string })[]).map((r) => (typeof r === "string" ? r : r.booked_times));
    }
    // Function not created yet (migration pending) — stop asking for this session
    if (rpc.error && /could not find|does not exist|PGRST202/i.test(`${rpc.error.code} ${rpc.error.message}`)) bookedTimesRpc = false;
  }
  // Fallback before the migration is run: only the patient's own bookings are visible
  let q = supabase
    .from("appointments")
    .select("appointment_time")
    .eq("clinic_id", clinicId)
    .eq("appointment_date", date)
    .eq("status", "confirmed");
  q = doctorId ? q.eq("doctor_id", doctorId) : q.is("doctor_id", null);
  const { data } = await q;
  return (data ?? []).map((r: { appointment_time: string }) => r.appointment_time);
}
