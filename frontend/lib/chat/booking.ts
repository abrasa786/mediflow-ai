// Booking logic for the guided chat bot: concern → specialty, fee / rating filters, and day / time
// slots. Clinics are real: map listings (Google Places / OpenStreetMap) + clinics on Mediflow.

import type { LocationData } from "@/hooks/useLocation";
import { ensureClinicId, getNearbyPlaces, type Place } from "@/lib/places";
import {
  TYPICAL_HOURS,
  bookableDays,
  formatSlot,
  timeSlots as scheduleSlots,
  type DayChoice,
  type Hours,
} from "@/lib/schedule";

export type SpecialtyTag =
  | "General" | "Pediatric" | "Cardio" | "Ortho" | "Skin" | "Neuro" | "Gynecology"
  | "Dental" | "Eye" | "ENT" | "Gastro" | "Psychiatry" | "Oncology" | "Other";

export type Concern = { label: string; tag: SpecialtyTag; specialist: string };

// Chips shown for "What's bothering you today?"
export const CONCERNS: Concern[] = [
  { label: "🤒 Fever / Cold / Cough", tag: "General", specialist: "General Physician" },
  { label: "🤢 Stomach / Digestion", tag: "Gastro", specialist: "Gastroenterologist" },
  { label: "🧴 Skin / Hair", tag: "Skin", specialist: "Dermatologist" },
  { label: "🦴 Bone / Joint Pain", tag: "Ortho", specialist: "Orthopedic" },
  { label: "❤️ Heart / BP", tag: "Cardio", specialist: "Cardiologist" },
  { label: "🧠 Headache / Nerves", tag: "Neuro", specialist: "Neurologist" },
  { label: "👶 Child Health", tag: "Pediatric", specialist: "Pediatrician" },
  { label: "🤰 Women's Health", tag: "Gynecology", specialist: "Gynecologist" },
  { label: "🦷 Teeth / Dental", tag: "Dental", specialist: "Dentist" },
  { label: "👁️ Eye Problem", tag: "Eye", specialist: "Ophthalmologist" },
  { label: "🩺 General Checkup", tag: "General", specialist: "General Physician" },
];
export const OTHER_CONCERN = "✍️ Something else";

// Quick keyword match for typed concerns (falls back to AI triage)
const KEYWORDS: [RegExp, Concern][] = [
  [/fever|cold|cough|flu|viral|throat infection|body ache|weak/i, CONCERNS[0]],
  [/stomach|acidity|gas|vomit|diarr|loose motion|constipat|digest|piles/i, CONCERNS[1]],
  [/skin|rash|itch|acne|pimple|hair|dandruff|allerg/i, CONCERNS[2]],
  [/bone|joint|knee|back pain|neck pain|fracture|sprain|shoulder/i, CONCERNS[3]],
  [/heart|bp|blood pressure|palpitat|cholesterol/i, CONCERNS[4]],
  [/headache|migraine|nerve|dizz|numb|seizure|brain/i, CONCERNS[5]],
  [/child|baby|kid|infant|toddler/i, CONCERNS[6]],
  [/period|pregnan|pcos|pcod|gyn|women|menstru/i, CONCERNS[7]],
  [/tooth|teeth|dental|gum|cavity/i, CONCERNS[8]],
  [/eye|vision|spectacle|blurr/i, CONCERNS[9]],
  [/check ?up|health check|routine/i, CONCERNS[10]],
];

export function matchConcern(text: string): Concern | null {
  const exact = CONCERNS.find((c) => c.label === text);
  if (exact) return exact;
  for (const [re, concern] of KEYWORDS) if (re.test(text)) return concern;
  return null;
}

// Fallback red flags (lib/emergency.ts detectEmergency has the typed, fuller list)
export const EMERGENCY_RE =
  /chest pain|heart attack|can'?t breathe|cannot breathe|not breathing|difficulty breathing|breathless|accident|labou?r pain|stroke|faint|unconscious|seizure|heavy bleeding|suicid|kill myself|poison|overdose/i;

// ── Filters (fee slider + minimum rating) ──
export type Filters = { maxFee: number | null; minRating: number | null }; // null = any
export const FEE_LIMIT = 10000;
export const FEE_STEP = 100;
export const RATING_CHOICES = [null, 3, 3.5, 4, 4.5] as const;
export const DEFAULT_FILTERS: Filters = { maxFee: null, minRating: null };

export const feeLabel = (max: number | null) =>
  max == null || max >= FEE_LIMIT ? "Any fee" : `Up to ₹${max.toLocaleString("en-IN")}`;
export const ratingLabel = (min: number | null) => (min == null ? "Any rating" : `${min}★ & above`);
export const filtersLabel = (f: Filters) => `${feeLabel(f.maxFee)} · ${ratingLabel(f.minRating)}`;

/** Typed filters, e.g. "under 800", "4 star", "no preference". */
export function parseFilters(text: string): Filters | null {
  if (/no pref|any|doesn'?t matter|no limit|skip/i.test(text)) return { ...DEFAULT_FILTERS };
  const t = text.replace(/,/g, "");
  const rating = t.match(/(\d(?:\.\d)?)\s*(?:\+|★|⭐|stars?|rating)/i);
  const minRating = rating ? Math.min(5, Number(rating[1])) : null;
  const fees = t.replace(rating?.[0] ?? "", "").match(/\d+/g)?.map(Number).filter((n) => n >= 50) ?? [];
  const maxFee = fees.length ? Math.min(FEE_LIMIT, Math.max(...fees)) : null;
  return rating || fees.length ? { maxFee, minRating } : null;
}

// ── Clinics (real, from the map + clinics registered on Mediflow) ──
export type ClinicOption = {
  key: string; // listing key — used to save the clinic on first booking
  clinicId: string | null; // null until the listing is saved in our database
  clinicName: string;
  area: string;
  address: string;
  phone: string;
  rating: number | null;
  reviews: number | null;
  doctorRating: number | null;
  waitMins: number | null;
  hours: Hours;
  hoursKnown: boolean;
  slotMinutes: number;
  doctorId: string | null;
  doctorName: string;
  doctorSpecialty: string;
  qualification: string;
  experience: number | null;
  fee: number;
  feeEstimated: boolean;
  availableDays: string[] | null; // doctor's working days (registered clinics)
  distanceKm: number | null;
  onMediflow: boolean;
  mapsUrl: string;
  lat: number;
  lng: number;
};

export type ClinicSearch = {
  options: ClinicOption[];
  note: string | null; // explains any fallback (no specialist / no match for the filters / wider radius)
};

export const DOCTOR_TAG: Record<string, SpecialtyTag> = {
  "general physician": "General",
  pediatrician: "Pediatric",
  gynecologist: "Gynecology",
  dermatologist: "Skin",
  orthopedic: "Ortho",
  cardiologist: "Cardio",
  neurologist: "Neuro",
  dentist: "Dental",
  ophthalmologist: "Eye",
  ent: "ENT",
  gastroenterologist: "Gastro",
  psychiatrist: "Psychiatry",
  oncologist: "Oncology",
};

export function toOption(place: Place, tag: SpecialtyTag, specialist: string): ClinicOption {
  // Only ever show a doctor of the right specialty. Map listings (and clinics without a
  // matching doctor) show "<Specialist> on duty" — never a doctor from an unrelated specialty.
  const doctor = place.doctors.find((d) => DOCTOR_TAG[d.speciality?.toLowerCase()] === tag) || null;
  const hours = place.hours ?? TYPICAL_HOURS;
  return {
    key: place.key,
    clinicId: place.clinic_id,
    clinicName: place.name,
    area: place.area || place.city,
    address: place.address,
    phone: place.phone,
    rating: place.rating,
    reviews: place.reviews,
    doctorRating: doctor?.rating ?? null,
    waitMins: place.wait_minutes,
    hours,
    hoursKnown: place.hours_known,
    slotMinutes: place.slot_minutes || 30,
    doctorId: doctor?.id ?? null,
    doctorName: doctor?.name ?? `${specialist} on duty`,
    doctorSpecialty: doctor?.speciality ?? specialist,
    qualification: doctor?.qualification ?? "",
    experience: doctor?.experience_years ?? null,
    fee: doctor?.consultation_fee ?? place.fee,
    feeEstimated: doctor ? false : place.fee_estimated,
    availableDays: doctor?.available_days?.length ? doctor.available_days : null,
    distanceKm: place.distance_km,
    onMediflow: place.on_mediflow,
    mapsUrl: place.maps_url,
    lat: place.lat,
    lng: place.lng,
  };
}

function rank(a: ClinicOption, b: ClinicOption) {
  // Nearest first (clinics that manage bookings on Mediflow get a 1 km head start), then rating, then fee
  const da = (a.distanceKm ?? 99) - (a.onMediflow ? 1 : 0);
  const db = (b.distanceKm ?? 99) - (b.onMediflow ? 1 : 0);
  if (Math.abs(da - db) > 0.5) return da - db;
  return (b.rating ?? 0) - (a.rating ?? 0) || a.fee - b.fee;
}

/** The rating a patient filters on: the doctor's own rating once we have one, else the clinic's. */
export const optionRating = (o: ClinicOption) => o.doctorRating ?? o.rating;

/** Real clinics near the patient for a specialty that match the filters, with sensible fallbacks. */
export async function findClinics(
  tag: SpecialtyTag,
  specialist: string,
  filters: Filters,
  loc: LocationData | null
): Promise<ClinicSearch> {
  if (!loc) return { options: [], note: null };

  let { places } = await getNearbyPlaces(loc.lat, loc.lng, { specialty: tag, radiusKm: 5 });
  let widened = false;
  if (places.filter((p) => p.specialities.includes(tag)).length < 2) {
    // Add the wider results to the nearby ones — never drop clinics that are close by
    const seen = new Set(places.map((p) => p.key));
    const wider = (await getNearbyPlaces(loc.lat, loc.lng, { specialty: tag, radiusKm: 15 })).places;
    places = [...places, ...wider.filter((p) => !seen.has(p.key))];
    widened = true;
  }

  const matches = (o: ClinicOption) =>
    (filters.maxFee == null || filters.maxFee >= FEE_LIMIT || o.fee <= filters.maxFee) &&
    (filters.minRating == null || (optionRating(o) ?? 0) >= filters.minRating);
  // Hospitals are multi-specialty; a specialty clinic only counts for its own specialty
  const specialists = places.filter((p) => p.specialities.includes(tag)).map((p) => toOption(p, tag, specialist));
  const generals = places.filter((p) => p.specialities.includes("General")).map((p) => toOption(p, "General", "General Physician"));
  const wide = widened ? " (I looked a little further out to find these)" : "";

  // 1. Right specialist, matching the filters
  let options = specialists.filter(matches).sort(rank);
  if (options.length) return { options, note: wide ? `Nothing close by, so I searched wider${wide}.` : null };

  // 2. General Physician matching the filters (they can examine and refer)
  options = generals.filter(matches).sort(rank);
  if (options.length) {
    const why = specialists.length
      ? `${specialist}s nearby don't match your filters`
      : `I couldn't find ${/^[aeiou]/i.test(specialist) ? "an" : "a"} ${specialist} near you on the map`;
    return {
      options,
      note: tag === "General" ? null : `${why}, so here are General Physicians who can examine you and refer you if needed.`,
    };
  }

  // 3. Nothing matches — show the nearest options and say why
  options = (specialists.length ? specialists : generals).sort(rank);
  const unrated = filters.minRating != null && options.every((o) => optionRating(o) == null);
  return {
    options,
    note: !options.length
      ? null
      : unrated
        ? "These clinics don't have ratings yet, so I couldn't filter by rating — here are the nearest ones."
        : `Nothing matches ${filtersLabel(filters).toLowerCase()} right now — here are the nearest options.`,
  };
}

/** Saved clinic id for an option (saves the map listing on first booking). */
export async function ensureOptionClinic(option: ClinicOption): Promise<string> {
  if (!option.clinicId) option.clinicId = await ensureClinicId({ key: option.key, clinic_id: null });
  return option.clinicId;
}

// ── Day & time slots (from the clinic's real opening hours) ──
export type { DayChoice };
export { formatSlot };

export function timeSlots(option: ClinicOption, date: Date): string[] {
  return scheduleSlots(option.hours, date, option.slotMinutes);
}

export function availableDays(option: ClinicOption, count = 5): DayChoice[] {
  return bookableDays(option.hours, { doctorDays: option.availableDays, slotMinutes: option.slotMinutes, count });
}

export function pharmacyLinks(term: string) {
  const q = encodeURIComponent(term.trim());
  return [
    { name: "Tata 1mg", url: `https://www.1mg.com/search/all?name=${q}` },
    { name: "PharmEasy", url: `https://pharmeasy.in/search/all?name=${q}` },
    { name: "Netmeds", url: `https://www.netmeds.com/products?q=${q}` },
  ];
}
