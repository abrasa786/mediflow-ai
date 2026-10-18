// Clinic Suite data layer: register, calendar booking + auto-assign, prescriptions, billing,
// files/storage, branding & settings, dashboard stats.

import { supabase } from "@/lib/supabase";
import { formatSlot } from "@/lib/chat/booking";
import { timeToMinutes, todayIso } from "@/lib/appointments";

// ── Types ──
export type Clinic = {
  id: string;
  name: string;
  area: string;
  address: string;
  city?: string;
  phone: string;
  consultation_fee: number;
  open_time: string | null;
  close_time: string | null;
  slug: string | null;
  brand_name: string | null;
  logo_url: string | null;
  brand_color: string;
  custom_domain: string | null;
  about: string | null;
  storage_quota_mb: number;
  slot_minutes: number;
  gstin: string | null;
  specialities: string[] | null;
  rating: number;
};

export type Doctor = {
  id: string;
  clinic_id: string;
  name: string;
  speciality: string;
  qualification: string | null;
  experience_years: number | null;
  consultation_fee: number;
  available_days: string[] | null;
  is_active: boolean;
  phone?: string | null;
};

export type ClinicPatient = {
  id: string;
  clinic_id: string;
  user_id: string | null;
  name: string;
  phone: string | null;
  gender: string | null;
  dob: string | null;
  blood_group: string | null;
  allergies: string | null;
  conditions: string | null;
  notes: string | null;
  created_at: string;
};

export type Appt = {
  id: string;
  clinic_id: string;
  patient_id: string | null;
  clinic_patient_id: string | null;
  doctor_id: string | null;
  appointment_date: string;
  appointment_time: string;
  status: string;
  priority?: string;
  mode: "in_clinic" | "video";
  video_room: string | null;
  symptoms?: string | null;
  notes?: string | null;
  source?: string;
  consultation_fee: number;
  created_at?: string;
  patient?: ClinicPatient;
  doctor?: Doctor;
};

export type Medicine = {
  name: string;
  dose: string;
  morning: boolean;
  afternoon: boolean;
  night: boolean;
  food: "before" | "after" | "";
  days: number | "";
  notes: string;
};

export type Prescription = {
  id: string;
  clinic_id: string;
  clinic_patient_id: string;
  appointment_id: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  complaints: string | null;
  diagnosis: string | null;
  vitals: { bp?: string; pulse?: string; temp?: string; spo2?: string; weight?: string };
  medicines: Medicine[];
  tests: string | null;
  advice: string | null;
  follow_up: string | null;
  created_at: string;
};

export type InvoiceItem = { description: string; qty: number; rate: number };

export type Invoice = {
  id: string;
  clinic_id: string;
  clinic_patient_id: string;
  appointment_id: string | null;
  number: string;
  items: InvoiceItem[];
  subtotal: number;
  discount: number;
  gst_percent: number;
  gst_amount: number;
  total: number;
  status: "unpaid" | "paid" | "partial" | "void";
  paid_amount: number;
  payment_method: string | null;
  paid_at: string | null;
  created_at: string;
};

export type ClinicFile = {
  id: string;
  clinic_id: string;
  clinic_patient_id: string | null;
  name: string;
  path: string;
  size_bytes: number;
  mime: string | null;
  created_at: string;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00");
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

export function rupees(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

// ── Clinic + doctors ──
export async function getClinic(id: string): Promise<Clinic | null> {
  const { data } = await supabase.from("clinics").select("*").eq("id", id).maybeSingle();
  return data as Clinic | null;
}

export async function updateClinic(id: string, values: Partial<Clinic>) {
  const res = await supabase.from("clinics").update(values).eq("id", id).select("id");
  if (!res.error && !res.data?.length) return { error: { message: "Not allowed to update this clinic" } };
  return res;
}

export async function getDoctors(clinicId: string, includeInactive = false): Promise<Doctor[]> {
  let q = supabase.from("doctors").select("*").eq("clinic_id", clinicId).order("name");
  if (!includeInactive) q = q.eq("is_active", true);
  const { data } = await q;
  return (data as Doctor[]) ?? [];
}

export async function saveDoctor(d: Partial<Doctor> & { clinic_id: string }) {
  const values = {
    clinic_id: d.clinic_id,
    name: d.name,
    speciality: d.speciality,
    qualification: d.qualification ?? null,
    experience_years: d.experience_years ?? null,
    consultation_fee: d.consultation_fee ?? 0,
    available_days: d.available_days ?? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    is_active: d.is_active ?? true,
    phone: d.phone ?? null,
  };
  return d.id ? supabase.from("doctors").update(values).eq("id", d.id).select("id") : supabase.from("doctors").insert(values).select("id");
}

/** Bookable slots for a clinic on a date (clinic hours, slot length). */
export function clinicSlots(clinic: Pick<Clinic, "open_time" | "close_time" | "slot_minutes">, date: string): string[] {
  const [oh, om] = (clinic.open_time || "09:00").split(":").map(Number);
  const [ch, cm] = (clinic.close_time || "21:00").split(":").map(Number);
  const step = clinic.slot_minutes || 30;
  const now = new Date();
  const earliest = date === todayIso() ? now.getHours() * 60 + now.getMinutes() + 15 : 0;
  const out: string[] = [];
  for (let t = oh * 60 + (om || 0); t + step <= ch * 60 + (cm || 0); t += step) if (t >= earliest) out.push(formatSlot(t));
  return out;
}

export function doctorWorksOn(d: Doctor, date: string) {
  const day = DAY_NAMES[new Date(date + "T00:00").getDay()];
  return !d.available_days?.length || d.available_days.includes(day);
}

// ── Appointments ──
async function attach(rows: Appt[], clinicId: string): Promise<Appt[]> {
  const cpIds = [...new Set(rows.map((r) => r.clinic_patient_id).filter(Boolean))] as string[];
  const [{ data: pats }, doctors] = await Promise.all([
    cpIds.length ? supabase.from("clinic_patients").select("*").in("id", cpIds) : Promise.resolve({ data: [] }),
    getDoctors(clinicId, true),
  ]);
  return rows.map((r) => ({
    ...r,
    patient: (pats as ClinicPatient[] | null)?.find((p) => p.id === r.clinic_patient_id),
    doctor: doctors.find((d) => d.id === r.doctor_id),
  }));
}

export async function getAppointmentsRange(clinicId: string, from: string, to: string): Promise<Appt[]> {
  const { data } = await supabase
    .from("appointments")
    .select("*")
    .eq("clinic_id", clinicId)
    .gte("appointment_date", from)
    .lte("appointment_date", to)
    .limit(1000);
  const rows = ((data as Appt[]) ?? []).sort(
    (a, b) => a.appointment_date.localeCompare(b.appointment_date) || timeToMinutes(a.appointment_time) - timeToMinutes(b.appointment_time)
  );
  return attach(rows, clinicId);
}

export async function getAppointment(id: string): Promise<Appt | null> {
  const { data } = await supabase.from("appointments").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  return (await attach([data as Appt], (data as Appt).clinic_id))[0];
}

/**
 * Auto-assign: among active doctors of the right specialty working that day and free at that time,
 * pick the one with the fewest appointments that day (ties → lower fee).
 */
export async function autoAssignDoctor(clinicId: string, date: string, time: string, speciality?: string): Promise<Doctor | null> {
  const doctors = (await getDoctors(clinicId)).filter(
    (d) => doctorWorksOn(d, date) && (!speciality || d.speciality.toLowerCase().includes(speciality.toLowerCase()))
  );
  if (!doctors.length) return null;
  const { data } = await supabase
    .from("appointments")
    .select("doctor_id, appointment_time, status")
    .eq("clinic_id", clinicId)
    .eq("appointment_date", date)
    .in("status", ["confirmed", "arrived"]);
  const rows = (data as { doctor_id: string | null; appointment_time: string }[]) ?? [];
  const free = doctors.filter((d) => !rows.some((r) => r.doctor_id === d.id && r.appointment_time === time));
  if (!free.length) return null;
  const load = (id: string) => rows.filter((r) => r.doctor_id === id).length;
  return free.sort((a, b) => load(a.id) - load(b.id) || a.consultation_fee - b.consultation_fee)[0];
}

export async function bookFromClinic(input: {
  clinicId: string;
  clinicPatientId: string;
  patientUserId: string | null;
  doctor: Doctor;
  date: string;
  time: string;
  mode: "in_clinic" | "video";
  complaint?: string;
  priority?: "normal" | "urgent";
}) {
  return supabase
    .from("appointments")
    .insert({
      clinic_id: input.clinicId,
      clinic_patient_id: input.clinicPatientId,
      patient_id: input.patientUserId,
      doctor_id: input.doctor.id,
      appointment_date: input.date,
      appointment_time: input.time,
      status: "confirmed",
      consultation_fee: input.doctor.consultation_fee,
      mode: input.mode,
      symptoms: input.complaint || null,
      priority: input.priority || "normal",
      source: "clinic",
    })
    .select("id, video_room")
    .single();
}

export async function updateAppointment(id: string, values: Partial<Appt>) {
  const res = await supabase.from("appointments").update(values).eq("id", id).select("id");
  if (!res.error && !res.data?.length) return { error: { message: "Not allowed" } };
  return res;
}

// ── Patient register ──
export async function searchRegister(clinicId: string, q: string): Promise<ClinicPatient[]> {
  let query = supabase.from("clinic_patients").select("*").eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(200);
  const s = q.trim();
  if (s) query = query.or(`name.ilike.%${s.replace(/[%,()]/g, "")}%,phone.ilike.%${s.replace(/\D/g, "") || s}%`);
  const { data } = await query;
  return (data as ClinicPatient[]) ?? [];
}

export async function findAppPatient(clinicId: string, q: string) {
  const { data, error } = await supabase.rpc("clinic_find_patient", { p_clinic: clinicId, p_query: q });
  if (error) throw error;
  return data as { user_id: string; name: string; patient_id: string; phone: string | null; gender: string | null; dob: string | null } | null;
}

export async function linkAppPatient(clinicId: string, userId: string): Promise<string> {
  const { data, error } = await supabase.rpc("clinic_link_patient", { p_clinic: clinicId, p_user: userId });
  if (error) throw error;
  return data as string;
}

export async function addWalkIn(clinicId: string, p: { name: string; phone?: string; gender?: string; dob?: string }) {
  return supabase
    .from("clinic_patients")
    .insert({ clinic_id: clinicId, name: p.name, phone: p.phone || null, gender: p.gender || null, dob: p.dob || null })
    .select("*")
    .single();
}

export async function getRegisterPatient(id: string): Promise<ClinicPatient | null> {
  const { data } = await supabase.from("clinic_patients").select("*").eq("id", id).maybeSingle();
  return data as ClinicPatient | null;
}

export async function updateRegisterPatient(id: string, values: Partial<ClinicPatient>) {
  return supabase.from("clinic_patients").update(values).eq("id", id).select("id");
}

export async function getPatientHistory(clinicPatientId: string) {
  const [{ data: appts }, { data: rx }, { data: inv }, { data: files }] = await Promise.all([
    supabase.from("appointments").select("*").eq("clinic_patient_id", clinicPatientId).order("appointment_date", { ascending: false }),
    supabase.from("prescriptions").select("*").eq("clinic_patient_id", clinicPatientId).order("created_at", { ascending: false }),
    supabase.from("invoices").select("*").eq("clinic_patient_id", clinicPatientId).order("created_at", { ascending: false }),
    supabase.from("clinic_files").select("*").eq("clinic_patient_id", clinicPatientId).order("created_at", { ascending: false }),
  ]);
  return {
    appointments: (appts as Appt[]) ?? [],
    prescriptions: (rx as Prescription[]) ?? [],
    invoices: (inv as Invoice[]) ?? [],
    files: (files as ClinicFile[]) ?? [],
  };
}

// ── Prescriptions ──
export const emptyMedicine = (): Medicine => ({ name: "", dose: "", morning: true, afternoon: false, night: true, food: "after", days: 5, notes: "" });

export function dosePattern(m: Medicine) {
  return `${m.morning ? 1 : 0}-${m.afternoon ? 1 : 0}-${m.night ? 1 : 0}`;
}

export async function savePrescription(rx: Omit<Prescription, "id" | "created_at"> & { id?: string }) {
  const { id, ...values } = rx;
  const clean = { ...values, medicines: values.medicines.filter((m) => m.name.trim()) };
  return id
    ? supabase.from("prescriptions").update(clean).eq("id", id).select("id").single()
    : supabase.from("prescriptions").insert(clean).select("id").single();
}

export async function getPrescription(id: string): Promise<Prescription | null> {
  const { data } = await supabase.from("prescriptions").select("*").eq("id", id).maybeSingle();
  return data as Prescription | null;
}

export async function getPrescriptionForAppointment(appointmentId: string): Promise<Prescription | null> {
  const { data } = await supabase.from("prescriptions").select("*").eq("appointment_id", appointmentId).maybeSingle();
  return data as Prescription | null;
}

// ── Billing ──
export function invoiceTotals(items: InvoiceItem[], discount: number, gstPercent: number) {
  const subtotal = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0);
  const taxable = Math.max(0, subtotal - (Number(discount) || 0));
  const gst = Math.round(taxable * (Number(gstPercent) || 0)) / 100;
  return { subtotal, gst_amount: gst, total: Math.round((taxable + gst) * 100) / 100 };
}

export async function saveInvoice(inv: {
  id?: string;
  clinic_id: string;
  clinic_patient_id: string;
  appointment_id: string | null;
  items: InvoiceItem[];
  discount: number;
  gst_percent: number;
  status: Invoice["status"];
  paid_amount: number;
  payment_method: string | null;
}) {
  const items = inv.items.filter((i) => i.description.trim());
  const totals = invoiceTotals(items, inv.discount, inv.gst_percent);
  const values = {
    clinic_id: inv.clinic_id,
    clinic_patient_id: inv.clinic_patient_id,
    appointment_id: inv.appointment_id,
    items,
    discount: inv.discount,
    gst_percent: inv.gst_percent,
    ...totals,
    status: inv.status,
    paid_amount: inv.status === "paid" ? totals.total : inv.paid_amount,
    payment_method: inv.status === "unpaid" ? null : inv.payment_method,
    paid_at: inv.status === "paid" || inv.status === "partial" ? new Date().toISOString() : null,
  };
  return inv.id
    ? supabase.from("invoices").update(values).eq("id", inv.id).select("id, number").single()
    : supabase.from("invoices").insert(values).select("id, number").single();
}

export async function getInvoices(clinicId: string, from: string, to: string): Promise<(Invoice & { patient_name?: string })[]> {
  const { data } = await supabase
    .from("invoices")
    .select("*")
    .eq("clinic_id", clinicId)
    .gte("created_at", from + "T00:00:00")
    .lte("created_at", to + "T23:59:59")
    .order("created_at", { ascending: false });
  const rows = (data as Invoice[]) ?? [];
  const ids = [...new Set(rows.map((r) => r.clinic_patient_id))];
  const { data: pats } = ids.length ? await supabase.from("clinic_patients").select("id, name").in("id", ids) : { data: [] };
  return rows.map((r) => ({ ...r, patient_name: (pats as { id: string; name: string }[] | null)?.find((p) => p.id === r.clinic_patient_id)?.name }));
}

export async function getInvoice(id: string): Promise<Invoice | null> {
  const { data } = await supabase.from("invoices").select("*").eq("id", id).maybeSingle();
  return data as Invoice | null;
}

export async function getInvoiceForAppointment(appointmentId: string): Promise<Invoice | null> {
  const { data } = await supabase.from("invoices").select("*").eq("appointment_id", appointmentId).neq("status", "void").maybeSingle();
  return data as Invoice | null;
}

// ── Files & storage ──
export async function uploadPatientFile(clinicId: string, clinicPatientId: string, file: File) {
  const path = `${clinicId}/${clinicPatientId}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
  const up = await supabase.storage.from("clinic-files").upload(path, file);
  if (up.error) return { error: up.error };
  return supabase
    .from("clinic_files")
    .insert({ clinic_id: clinicId, clinic_patient_id: clinicPatientId, name: file.name, path, size_bytes: file.size, mime: file.type })
    .select("*")
    .single();
}

export async function fileUrl(path: string) {
  const { data } = await supabase.storage.from("clinic-files").createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? null;
}

export async function deletePatientFile(f: ClinicFile) {
  await supabase.storage.from("clinic-files").remove([f.path]);
  return supabase.from("clinic_files").delete().eq("id", f.id);
}

export async function storageUsage(clinicId: string) {
  const { data } = await supabase.from("clinic_files").select("size_bytes, mime").eq("clinic_id", clinicId);
  const rows = (data as { size_bytes: number; mime: string | null }[]) ?? [];
  const used = rows.reduce((s, r) => s + Number(r.size_bytes || 0), 0);
  const byType: Record<string, number> = {};
  for (const r of rows) {
    const k = r.mime?.startsWith("image/") ? "Images" : r.mime === "application/pdf" ? "PDFs" : "Other";
    byType[k] = (byType[k] || 0) + Number(r.size_bytes || 0);
  }
  return { usedBytes: used, files: rows.length, byType };
}

export function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

export async function uploadLogo(clinicId: string, file: File) {
  const path = `${clinicId}/logo-${Date.now()}.${file.name.split(".").pop() || "png"}`;
  const up = await supabase.storage.from("clinic-branding").upload(path, file, { upsert: true });
  if (up.error) return { error: up.error, url: null };
  return { error: null, url: supabase.storage.from("clinic-branding").getPublicUrl(path).data.publicUrl };
}

// ── Video visits (Jitsi) ──
export function videoUrl(room: string, displayName?: string) {
  const name = displayName ? `#userInfo.displayName=${encodeURIComponent(JSON.stringify(displayName))}` : "";
  return `https://meet.jit.si/${room}${name}`;
}

// ── Dashboard stats ──
export type DashboardStats = {
  today: Appt[];
  last30: Appt[];
  invoices30: Invoice[];
  registerCount: number;
};

export async function getDashboard(clinicId: string): Promise<DashboardStats> {
  const today = todayIso();
  const from = addDays(today, -29);
  const [last30, invoices30, { count }] = await Promise.all([
    getAppointmentsRange(clinicId, from, addDays(today, 7)),
    supabase
      .from("invoices")
      .select("*")
      .eq("clinic_id", clinicId)
      .gte("created_at", from + "T00:00:00")
      .then((r) => (r.data as Invoice[]) ?? []),
    supabase.from("clinic_patients").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId),
  ]);
  return { today: last30.filter((a) => a.appointment_date === today), last30, invoices30, registerCount: count ?? 0 };
}
