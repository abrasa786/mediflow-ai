// Patient profile helpers (Supabase "patients" table, keyed by auth user id).

import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type BodyStats = {
  height?: number | null;
  weight?: number | null;
  age?: number | null;
  gender?: string | null;
  goal?: string | null;
  activity_level?: string | null;
};

export type MediPassDetails = {
  dob?: string | null;
  blood_group?: string | null;
  allergies?: string | null;
  conditions?: string | null;
  medications?: string | null;
  address?: string | null;
  insurance_number?: string | null;
  aadhaar_last4?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
};

export type Patient = BodyStats &
  MediPassDetails & {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    city?: string;
    patient_id?: string | null;
    avatar_url?: string | null;
    onboarded_at?: string | null;
    health_flags?: string[] | null;
  };

export async function updatePatient(userId: string, values: Partial<Patient>) {
  return updateOwnRow(userId, values);
}

/** Local marker so a failed DB write can never trap someone in an onboarding loop. */
export const onboardedKey = (userId: string) => `mediflow_onboarded_${userId}`;

/** Share token for the MediPass QR — valid 15 minutes. */
export async function createMediPassLink(): Promise<{ url: string; expiresAt: string }> {
  const { data, error } = await supabase.rpc("create_medipass_token");
  if (error || !data?.[0]) throw error ?? new Error("No token");
  const { token, expires_at } = data[0] as { token: string; expires_at: string };
  return { url: `${window.location.origin}/medipass/${token}`, expiresAt: expires_at };
}

/** DPDP Act: permanently delete the account and all data. */
export async function deleteMyAccount() {
  // Remove profile photos via the Storage API (direct SQL deletes on storage are blocked)
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: files } = await supabase.storage.from("avatars").list(user.id);
    if (files?.length) await supabase.storage.from("avatars").remove(files.map((f) => `${user.id}/${f.name}`));
  }
  const { error } = await supabase.rpc("delete_my_account");
  if (error) throw error;
  await supabase.auth.signOut();
  try {
    localStorage.clear();
  } catch {}
}

/** Format: MF-2026-XXXXX */
export function generatePatientId(year = new Date().getFullYear()) {
  const n = Math.floor(10000 + Math.random() * 90000);
  return `MF-${year}-${n}`;
}

/**
 * Fetch the logged-in patient's profile. Creates the row if signup couldn't
 * (e.g. email confirmation was pending) and assigns a Patient ID if missing.
 */
export async function getPatientProfile(user: User): Promise<Patient | null> {
  const { data } = await supabase.from("patients").select("*").eq("id", user.id).maybeSingle();
  let patient = data as Patient | null;

  if (!patient) {
    const meta = user.user_metadata || {};
    const row = {
      id: user.id,
      name: meta.name || user.email?.split("@")[0] || "Patient",
      email: user.email,
      phone: meta.phone || null,
      city: meta.city || null,
      patient_id: generatePatientId(),
    };
    const { data: created } = await supabase.from("patients").insert(row).select("*").maybeSingle();
    patient = (created as Patient | null) ?? null;
  }

  if (patient && !patient.patient_id) {
    // Retry a couple of times in case of a (rare) unique-constraint collision
    for (let i = 0; i < 3; i++) {
      const pid = generatePatientId();
      const { error } = await supabase.from("patients").update({ patient_id: pid }).eq("id", user.id);
      if (!error) {
        patient = { ...patient, patient_id: pid };
        break;
      }
    }
  }
  return patient;
}

/** Update the patient's own row. A silent 0-row update (blocked by RLS) is returned as an error. */
async function updateOwnRow(userId: string, values: Record<string, unknown>) {
  const res = await supabase.from("patients").update(values).eq("id", userId).select("id");
  if (!res.error && !res.data?.length) {
    return { ...res, error: { message: "Profile could not be saved (no permission to update)", code: "NO_ROWS" } };
  }
  return res;
}

export async function updateBodyStats(userId: string, stats: BodyStats) {
  return updateOwnRow(userId, stats);
}

export function calculateBMI(heightCm: number, weightKg: number) {
  if (!heightCm || !weightKg) return null;
  return Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10;
}
