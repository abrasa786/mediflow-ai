// Clinics that joined Mediflow Clinic, read from the clinic app's public search service.
// The patient app never touches the clinic app's database: it only asks this one web service,
// and a booking is made on the clinic's own booking page, so one clinic can never be mixed up with another.

export const CLINIC_APP_URL = (process.env.NEXT_PUBLIC_CLINIC_APP_URL || "https://sas-mediflow.vercel.app").replace(/\/$/, "");

/**
 * Where the clinic list comes from.
 *  "mediflow" (default): only clinics onboarded on Mediflow Clinic, booked on the clinic's own page.
 *  "map": the older map listing (Google / OpenStreetMap) that books into this app's own database. Development only.
 */
export const CLINIC_SOURCE: "mediflow" | "map" = process.env.NEXT_PUBLIC_CLINIC_SOURCE === "map" ? "map" : "mediflow";

export type OnboardedClinic = {
  slug: string;
  name: string;
  specialty: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  logo_url: string | null;
  lat: number | null;
  lng: number | null;
  distance_km: number | null;
  min_fee: number | null;
  doctors: { name: string; specialty?: string | null; fee?: number | null }[] | null;
  online_booking: boolean;
  booking_fee: number | null;
  next_free?: { date: string; time: string } | null;
  book_url: string | null;
};

export type ClinicQuery = { lat?: number | null; lng?: number | null; radiusKm?: number | null; maxFee?: number | null; specialty?: string | null; q?: string; limit?: number };

export async function searchOnboardedClinics(p: ClinicQuery = {}): Promise<OnboardedClinic[]> {
  const u = new URL(`${CLINIC_APP_URL}/api/public/clinics/search`);
  if (p.lat != null && p.lng != null) { u.searchParams.set("lat", String(p.lat)); u.searchParams.set("lng", String(p.lng)); u.searchParams.set("radiusKm", String(p.radiusKm ?? 100)); }
  if (p.maxFee != null) u.searchParams.set("maxFee", String(p.maxFee));
  if (p.specialty && p.specialty !== "All") u.searchParams.set("specialty", p.specialty);
  if (p.q) u.searchParams.set("q", p.q);
  u.searchParams.set("limit", String(p.limit ?? 30));
  const res = await fetch(u.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Clinic search is not available right now.");
  const body = await res.json();
  return (body.clinics ?? []) as OnboardedClinic[];
}

/** The clinic's own booking page. Opens in the clinic app, where the booking, payment and patient record happen. */
export function bookingUrl(c: Pick<OnboardedClinic, "book_url" | "slug">): string | null {
  if (!c.book_url) return null;
  const path = /^https?:\/\//i.test(c.book_url) ? c.book_url : `${CLINIC_APP_URL}${c.book_url}`;
  return `${path}${path.includes("?") ? "&" : "?"}from=patient-app`;
}

export function formatNextFree(n: OnboardedClinic["next_free"]): string | null {
  if (!n) return null;
  const d = new Date(`${n.date}T00:00:00`);
  return `${d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}, ${n.time}`;
}
