// Real clinics from the map (Google Places / OpenStreetMap via the backend), merged with
// clinics registered on Mediflow. A map listing is saved as a clinic row on first booking.

import { ApiError, apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { Hours } from "@/lib/schedule";
import { CLINIC_SOURCE, bookingUrl, searchOnboardedClinics, type OnboardedClinic } from "@/lib/clinicApp";

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
  book_url?: string | null; // the clinic's own booking page on Mediflow Clinic
  next_free?: { date: string; time: string } | null;
};

export type PlaceResults = { provider: "google" | "osm"; places: Place[]; fetched_at?: number };

const TAGS: [RegExp, string][] = [
  [/general|physician|family/i, "General"], [/dent|oral/i, "Dental"], [/eye|ophthal|optic/i, "Eye"], [/cardi|heart/i, "Cardio"],
  [/ortho|bone|joint/i, "Ortho"], [/pediat|paediat|child/i, "Pediatric"], [/derma|skin/i, "Skin"], [/neuro/i, "Neuro"],
  [/gyn|obstet|women/i, "Gynecology"], [/\bent\b|otolaryn/i, "ENT"], [/psychi|mental/i, "Psychiatry"], [/physio/i, "Physio"], [/gastro/i, "Gastro"],
];

/** A clinic from Mediflow Clinic, shaped like a Place so every screen shows it the same way. */
function fromOnboarded(c: OnboardedClinic): Place {
  const text = [c.specialty ?? "", ...(c.doctors ?? []).map((d) => d.specialty ?? "")].join(" ");
  const tags = TAGS.filter(([re]) => re.test(text)).map(([, t]) => t);
  const url = bookingUrl(c);
  const hasPin = c.lat != null && c.lng != null;
  return {
    key: `mediflow:${c.slug}`, source: "mediflow", place_id: null, name: c.name, kind: /dent/i.test(c.specialty ?? "") ? "dentist" : "clinic",
    lat: c.lat ?? 0, lng: c.lng ?? 0, address: c.address ?? "", area: c.city ?? "", city: c.city ?? "", phone: c.phone ?? "",
    rating: null, reviews: null, hours: null, hours_known: false, hours_text: "", open_time: null, close_time: null, slot_minutes: 30,
    specialities: tags.length ? tags : ["General"], fee: c.min_fee ?? 0, fee_estimated: false,
    maps_url: hasPin ? `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.name} ${c.address ?? ""}`)}`,
    distance_km: c.distance_km, clinic_id: c.slug, on_mediflow: !!url, book_url: url, next_free: c.next_free ?? null,
    doctors: (c.doctors ?? []).map((d, i) => ({ id: `${c.slug}:${i}`, clinic_id: c.slug, name: d.name, speciality: d.specialty ?? "", qualification: null, experience_years: null, consultation_fee: d.fee ?? null, rating: null, available_days: null })),
    wait_minutes: null,
  };
}

export async function getNearbyPlaces(
  lat: number,
  lng: number,
  opts: { specialty?: string; radiusKm?: number } = {}
): Promise<PlaceResults> {
  if (CLINIC_SOURCE === "mediflow") {
    const list = await searchOnboardedClinics({ lat, lng, radiusKm: opts.radiusKm ?? 25, specialty: opts.specialty });
    return { provider: "osm", places: list.map(fromOnboarded) };
  }
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
  if (CLINIC_SOURCE === "mediflow") {
    const list = await searchOnboardedClinics({ q, lat: loc?.lat, lng: loc?.lng, radiusKm: 500 });
    return { provider: "osm", places: list.map(fromOnboarded) };
  }
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
  if (CLINIC_SOURCE === "mediflow") throw new ApiError(400, "This clinic is not available for booking.");
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

/** Opens the clinic's own booking page (on Mediflow Clinic). Returns false when the clinic doesn't take online bookings. */
export function openBooking(place: Pick<Place, "book_url">): boolean {
  if (!place.book_url) return false;
  window.location.assign(place.book_url);
  return true;
}
