// Real clinics from the map (Google Places / OpenStreetMap via the backend), merged with
// clinics registered on Mediflow. A map listing is saved as a clinic row on first booking.

import { ApiError, apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { Hours } from "@/lib/schedule";

export type PlaceDoctor = {
  id: string;
  clinic_id: string;
  name: string;
  speciality: string;
  qualification: string | null;
  experience_years: number | null;
  consultation_fee: number | null;
  rating: number | null;
  available_days: string[] | null;
};

export type Place = {
  key: string; // "google:<id>" | "osm:N123" | "mediflow:<uuid>"
  source: string;
  place_id: string | null;
  name: string;
  kind: "clinic" | "hospital" | "dentist";
  lat: number;
  lng: number;
  address: string;
  area: string;
  city: string;
  phone: string;
  rating: number | null;
  reviews: number | null;
  hours: Hours | null;
  hours_known: boolean;
  hours_text: string;
  open_time: string | null;
  close_time: string | null;
  slot_minutes: number;
  specialities: string[];
  fee: number;
  fee_estimated: boolean; // map listing — the clinic hasn't set its own fee yet
  maps_url: string;
  distance_km: number | null;
  clinic_id: string | null; // set once saved in our database
  on_mediflow: boolean; // the clinic has signed up and manages its bookings
  doctors: PlaceDoctor[];
  wait_minutes: number | null;
};

export type PlaceResults = { provider: "google" | "osm"; places: Place[]; fetched_at?: number };

export async function getNearbyPlaces(
  lat: number,
  lng: number,
  opts: { specialty?: string; radiusKm?: number } = {}
): Promise<PlaceResults> {
  const qs = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    radius_km: String(opts.radiusKm ?? 5),
    specialty: opts.specialty ?? "",
  });
  const res = await apiFetch(`/places/nearby?${qs}`);
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
  return res.json();
}

export async function searchPlaces(q: string, loc?: { lat: number; lng: number } | null): Promise<PlaceResults> {
  const qs = new URLSearchParams({ q });
  if (loc) {
    qs.set("lat", String(loc.lat));
    qs.set("lng", String(loc.lng));
  }
  const res = await apiFetch(`/places/search?${qs}`);
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
  return res.json();
}

export async function geocodeAddress(q: string) {
  const res = await apiFetch(`/places/geocode?${new URLSearchParams({ q })}`);
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
  return (await res.json()).results as { label: string; lat: number; lng: number; area: string; city: string }[];
}

/** Clinic row id for a listing — saves the map listing on first use. */
export async function ensureClinicId(place: Pick<Place, "key" | "clinic_id">): Promise<string> {
  if (place.clinic_id) return place.clinic_id;
  const res = await apiFetch("/places/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: place.key }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.clinic_id) throw new ApiError(res.status, body.detail || "Couldn't save this clinic. Please try again.");
  return body.clinic_id as string;
}

export function directionsUrl(p: { lat: number; lng: number; name?: string }) {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
}

export function telHref(phone: string) {
  return `tel:${phone.split(/[;,/]/)[0].replace(/[^\d+]/g, "")}`;
}

// ── Live platform numbers (home page) ──
export type PlatformStats = {
  clinics: number;
  listed_clinics: number;
  doctors: number;
  appointments: number;
  appointments_today: number;
  completed: number;
  patients: number;
};

export async function getPlatformStats(): Promise<PlatformStats | null> {
  const { data, error } = await supabase.rpc("platform_stats");
  if (error) return null; // migration 20261019 not run yet
  return data as PlatformStats;
}

// ── Real health facts (MyHealthfinder, health.gov) ──
export type HealthFact = { text: string; topic: string; category: string; icon: string; url: string };

export async function getHealthFacts(count = 8): Promise<{ source: string; facts: HealthFact[] }> {
  try {
    const res = await apiFetch(`/health/facts?count=${count}`);
    if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
    return await res.json();
  } catch {
    return { source: "", facts: [] };
  }
}
