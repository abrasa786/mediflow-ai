// Emergency SOS: detection, case creation and live status (Supabase Realtime).

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { postJSON } from "@/lib/api";
import type { LocationData } from "@/hooks/useLocation";

// detectEmergency — ordered: first match wins
const EMERGENCY_TYPES: [RegExp, string][] = [
  [/suicid|kill myself|end my life|want to die/i, "Mental health crisis"],
  [/chest pain|heart attack|cardiac arrest/i, "Cardiac"],
  [/can'?t breathe|cannot breathe|not breathing|difficulty breathing|breathless|choking/i, "Breathing difficulty"],
  [/accident|crash|hit by|fell from|head injury/i, "Accident"],
  [/labou?r pain|in labou?r|water broke|contractions/i, "Labour"],
  [/unconscious|fainted|not responding|unresponsive|collapsed/i, "Unconscious"],
  [/stroke|face droop|slurred speech/i, "Stroke"],
  [/seizure|fits|convulsion/i, "Seizure"],
  [/heavy bleeding|bleeding a lot|severe bleeding|won'?t stop bleeding/i, "Severe bleeding"],
  [/poison|overdose|snake ?bite|scorpion/i, "Poisoning / bite"],
  [/severe burn|burnt badly|burns? on/i, "Burns"],
];

export function detectEmergency(text: string): string | null {
  for (const [re, type] of EMERGENCY_TYPES) if (re.test(text)) return type;
  return null;
}

export type EmergencyStatus = "unassigned" | "assigned" | "spoke_to_patient" | "doctor_assigned" | "ambulance_dispatched" | "cancelled";

/** Straight-line km between two points. */
export function distanceKm(a: [number, number], b: [number, number]) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Rough city ETA: road ≈ 1.4× straight line, at GPS speed (or 25 km/h in traffic). */
export function etaMinutes(km: number, speedKmh?: number | null) {
  const speed = speedKmh && speedKmh > 10 ? speedKmh : 25;
  return Math.max(1, Math.round(((km * 1.4) / speed) * 60));
}

export type EmergencyCase = {
  id: string;
  patient_id: string;
  case_type: string;
  message: string | null;
  area: string | null;
  latitude: number | null;
  longitude: number | null;
  clinic_id: string | null;
  distance_km: number | null;
  status: EmergencyStatus;
  escalation_count: number;
  assigned_at: string;
  confirmed_at: string | null;
  doctor_name: string | null;
  created_at: string;
  ambulance_driver_name?: string | null;
  ambulance_driver_phone?: string | null;
  ambulance_vehicle?: string | null;
  ambulance_status?: "dispatched" | "arrived_patient" | "to_hospital" | "completed" | null;
  ambulance_lat?: number | null;
  ambulance_lng?: number | null;
  ambulance_speed_kmh?: number | null;
  ambulance_updated_at?: string | null;
  ambulance_token?: string | null;
};

export type EmergencyEvent = {
  id: number;
  kind: string;
  message: string;
  data: { mode?: string; clinic_id?: string; distance_km?: number };
  created_at: string;
};

export type EmergencyClinic = {
  id: string;
  name: string;
  area: string;
  address: string;
  phone: string;
  latitude: number | null;
  longitude: number | null;
};

export const ACTIVE: EmergencyStatus[] = ["assigned", "unassigned"];

/** Create (or re-use) an SOS case — auto-assigned to the nearest emergency-ready clinic. */
export async function triggerEmergency(type: string, message: string, loc: LocationData | null): Promise<string> {
  const body = {
    type,
    message,
    lat: loc?.lat ?? null,
    lng: loc?.lng ?? null,
    area: loc ? [loc.area, loc.city].filter((x) => x && x !== "your area").join(", ") : "",
  };
  try {
    // Backend also fires the WhatsApp / missed-call alerts immediately
    const res = await postJSON<{ case_id: string }>("/emergency", body);
    return res.case_id;
  } catch {
    // Backend unreachable — create the case directly so assignment still happens
    const { data, error } = await supabase.rpc("create_emergency_case", {
      p_type: body.type,
      p_message: body.message,
      p_lat: body.lat,
      p_lng: body.lng,
      p_area: body.area,
    });
    if (error) throw error;
    return data as string;
  }
}

/** Clinic dispatches its ambulance; returns the driver's secret tracking token. */
export async function dispatchAmbulance(caseId: string, driver: string, phone: string, vehicle: string): Promise<string> {
  try {
    const res = await postJSON<{ token: string }>("/emergency/dispatch", { case_id: caseId, driver, phone, vehicle });
    return res.token;
  } catch {
    const { data, error } = await supabase.rpc("clinic_dispatch_ambulance", { p_case: caseId, p_driver: driver, p_phone: phone, p_vehicle: vehicle });
    if (error) throw error;
    return data as string;
  }
}

export async function cancelEmergency(caseId: string) {
  try {
    await postJSON("/emergency/cancel", { case_id: caseId });
  } catch {
    const { error } = await supabase.rpc("cancel_emergency", { p_case: caseId });
    if (error) throw error;
  }
}

export async function findActiveEmergency(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("emergency_cases")
    .select("id")
    .eq("patient_id", userId)
    .in("status", ACTIVE)
    .gte("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0]?.id ?? null;
}

/** Live case + clinic + timeline via Supabase Realtime (with a polling fallback). */
export function useEmergencyCase(caseId: string | null) {
  const [ec, setCase] = useState<EmergencyCase | null>(null);
  const [clinic, setClinic] = useState<EmergencyClinic | null>(null);
  const [events, setEvents] = useState<EmergencyEvent[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!caseId) return;
    const { data, error: err } = await supabase.from("emergency_cases").select("*").eq("id", caseId).maybeSingle();
    if (err || !data) {
      setError("We couldn't load this emergency. Please call 112 / 108 directly.");
      return;
    }
    setCase(data as EmergencyCase);
    if (data.clinic_id) {
      const { data: c } = await supabase
        .from("clinics")
        .select("id, name, area, address, phone, latitude, longitude")
        .eq("id", data.clinic_id)
        .maybeSingle();
      setClinic((c as EmergencyClinic) ?? null);
    } else {
      setClinic(null);
    }
    const { data: ev } = await supabase
      .from("emergency_events")
      .select("*")
      .eq("case_id", caseId)
      .order("created_at", { ascending: true });
    setEvents((ev as EmergencyEvent[]) ?? []);
  }, [caseId]);

  useEffect(() => {
    if (!caseId) return;
    const first = setTimeout(load, 0); // initial fetch (async, outside the effect body)
    const channel = supabase
      .channel(`sos-${caseId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "emergency_cases", filter: `id=eq.${caseId}` }, load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "emergency_events", filter: `case_id=eq.${caseId}` }, load)
      .subscribe();
    // Fallback heartbeat: nudge server-side re-assignment and refresh, even without Realtime / pg_cron
    const timer = setInterval(async () => {
      await supabase.rpc("escalate_emergencies");
      load();
    }, 20000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [caseId, load]);

  return { ec, clinic, events, error, reload: load };
}
