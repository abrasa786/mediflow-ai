// Booking logic for the guided chat bot: concern → specialty, budget filter,
// distance estimate, and day / time slot generation. Clinic data comes from Supabase.

import { supabase } from "@/lib/supabase";
import type { LocationData } from "@/hooks/useLocation";

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

// ── Budget ──
export type Budget = { label: string; max: number | null };
export const BUDGETS: Budget[] = [
  { label: "Under ₹300", max: 300 },
  { label: "₹300 – ₹500", max: 500 },
  { label: "₹500 – ₹1000", max: 1000 },
  { label: "No preference", max: null },
];

export function parseBudget(text: string): Budget | null {
  const chip = BUDGETS.find((b) => b.label === text);
  if (chip) return chip;
  if (/no pref|any|doesn'?t matter|no limit/i.test(text)) return BUDGETS[3];
  const nums = text.replace(/,/g, "").match(/\d+/g);
  if (!nums) return null;
  const max = Math.max(...nums.map(Number));
  return max >= 50 ? { label: `Up to ₹${max}`, max } : null;
}

// ── Clinics ──
type ClinicRow = {
  id: string;
  name: string;
  address: string;
  area: string;
  city: string;
  specialities: string[] | null;
  rating: number;
  total_reviews: number;
  consultation_fee: number;
  wait_time_minutes: number;
  phone: string;
  open_time: string | null;
  close_time: string | null;
};

type DoctorRow = {
  id: string;
  clinic_id: string;
  name: string;
  speciality: string;
  qualification: string;
  experience_years: number;
  consultation_fee: number;
  rating: number;
  available_days: string[] | null;
};

export type ClinicOption = {
  clinicId: string;
  clinicName: string;
  area: string;
  address: string;
  phone: string;
  rating: number;
  reviews: number;
  waitMins: number;
  openTime: string;
  closeTime: string;
  doctorId: string | null;
  doctorName: string;
  doctorSpecialty: string;
  qualification: string;
  experience: number | null;
  fee: number;
  availableDays: string[];
  distanceKm: number | null;
};

export type ClinicSearch = {
  options: ClinicOption[];
  note: string | null; // explains any fallback (no specialist / over budget)
};

// Approximate centres of the areas we have clinics in (Bengaluru)
const AREA_COORDS: Record<string, [number, number]> = {
  "MG Road": [12.9756, 77.605],
  Koramangala: [12.9352, 77.6245],
  Indiranagar: [12.9784, 77.6408],
  "JP Nagar": [12.9063, 77.5857],
  Whitefield: [12.9698, 77.75],
  Jayanagar: [12.925, 77.5938],
  HSR: [12.9116, 77.6474],
  "HSR Layout": [12.9116, 77.6474],
  Bellandur: [12.9304, 77.6784],
  "Electronic City": [12.8452, 77.6602],
  Marathahalli: [12.9569, 77.7011],
  Hebbal: [13.0358, 77.597],
  Malleshwaram: [13.0031, 77.5643],
  BTM: [12.9166, 77.6101],
};

function haversineKm(a: [number, number], b: [number, number]) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Approximate km from the user to a clinic's area (null if unknown). */
export function areaDistanceKm(area: string, loc: LocationData | null): number | null {
  const coords = AREA_COORDS[area];
  if (!loc || !coords) return null;
  return Math.round(haversineKm([loc.lat, loc.lng], coords) * 10) / 10;
}

const DOCTOR_TAG: Record<string, SpecialtyTag> = {
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

function toOption(
  clinic: ClinicRow,
  doctors: DoctorRow[],
  tag: SpecialtyTag,
  specialist: string,
  loc: LocationData | null
): ClinicOption {
  // Only ever show a doctor of the right specialty. If the clinic lists the
  // specialty but no named doctor, show "<Specialist> on duty" — never a
  // doctor from an unrelated specialty (e.g. a gynecologist for a child).
  const doctor = doctors.find((d) => DOCTOR_TAG[d.speciality?.toLowerCase()] === tag) || null;
  return {
    clinicId: clinic.id,
    clinicName: clinic.name,
    area: clinic.area,
    address: clinic.address,
    phone: clinic.phone,
    rating: clinic.rating,
    reviews: clinic.total_reviews,
    waitMins: clinic.wait_time_minutes,
    openTime: clinic.open_time || "09:00",
    closeTime: clinic.close_time || "21:00",
    doctorId: doctor?.id ?? null,
    doctorName: doctor?.name ?? `${specialist} on duty`,
    doctorSpecialty: doctor?.speciality ?? specialist,
    qualification: doctor?.qualification ?? "",
    experience: doctor?.experience_years ?? null,
    fee: doctor?.consultation_fee ?? clinic.consultation_fee,
    availableDays: doctor?.available_days?.length ? doctor.available_days : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    distanceKm: areaDistanceKm(clinic.area, loc),
  };
}

function rank(a: ClinicOption, b: ClinicOption) {
  // Nearest first when we know the distance, then best rated, then cheapest
  if (a.distanceKm != null && b.distanceKm != null && Math.abs(a.distanceKm - b.distanceKm) > 1) {
    return a.distanceKm - b.distanceKm;
  }
  return b.rating - a.rating || a.fee - b.fee;
}

/** Find clinics for a specialty within budget, with sensible fallbacks. */
export async function findClinics(
  tag: SpecialtyTag,
  specialist: string,
  budget: Budget,
  loc: LocationData | null
): Promise<ClinicSearch> {
  const [{ data: clinics, error }, { data: doctors }] = await Promise.all([
    supabase.from("clinics").select("*").eq("is_active", true),
    supabase.from("doctors").select("*"),
  ]);
  if (error) throw error;

  const all = (clinics as ClinicRow[] | null) ?? [];
  const docs = (doctors as DoctorRow[] | null) ?? [];
  const docsFor = (id: string) => docs.filter((d) => d.clinic_id === id);
  const withinBudget = (o: ClinicOption) => budget.max == null || o.fee <= budget.max;

  const hasTag = (c: ClinicRow, t: SpecialtyTag) =>
    (c.specialities || []).includes(t) || docsFor(c.id).some((d) => DOCTOR_TAG[d.speciality?.toLowerCase()] === t);

  const specialists = all.filter((c) => hasTag(c, tag)).map((c) => toOption(c, docsFor(c.id), tag, specialist, loc));
  const generals = all.filter((c) => hasTag(c, "General")).map((c) => toOption(c, docsFor(c.id), "General", "General Physician", loc));

  // 1. Right specialist, within budget
  let options = specialists.filter(withinBudget).sort(rank);
  if (options.length) return { options, note: null };

  // 2. General Physician within budget (they can examine and refer)
  options = generals.filter(withinBudget).sort(rank);
  if (options.length) {
    const why = specialists.length
      ? `${specialist}s nearby are above your budget`
      : `We don't have ${/^[aeiou]/i.test(specialist) ? "an" : "a"} ${specialist} listed nearby yet`;
    return {
      options,
      note: tag === "General" ? null : `${why}, so here are General Physicians who can examine you and refer you if needed.`,
    };
  }

  // 3. Nothing within budget — show the closest-priced options
  options = (specialists.length ? specialists : generals).sort((a, b) => a.fee - b.fee || rank(a, b));
  return {
    options,
    note: options.length ? `Nothing fits ${budget.label.toLowerCase()} right now — these are the most affordable options.` : null,
  };
}

// ── Day & time slots ──
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function formatSlot(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function timeSlots(option: ClinicOption, date: Date): string[] {
  const open = toMinutes(option.openTime);
  const close = toMinutes(option.closeTime);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const earliest = isToday ? now.getHours() * 60 + now.getMinutes() + 45 : 0;
  const slots: string[] = [];
  for (let t = Math.ceil(open / 60) * 60; t <= close - 60; t += 60) {
    if (t >= earliest) slots.push(formatSlot(t));
  }
  return slots;
}

export type DayChoice = { label: string; iso: string; date: Date };

export function availableDays(option: ClinicOption, count = 5): DayChoice[] {
  const days: DayChoice[] = [];
  for (let i = 0; i < 14 && days.length < count; i++) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + i);
    if (!option.availableDays.includes(DAY_NAMES[d.getDay()])) continue;
    if (i === 0 && timeSlots(option, d).length === 0) continue;
    const label =
      i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days.push({ label, iso, date: d });
  }
  return days;
}

export function pharmacyLinks(term: string) {
  const q = encodeURIComponent(term.trim());
  return [
    { name: "Tata 1mg", url: `https://www.1mg.com/search/all?name=${q}` },
    { name: "PharmEasy", url: `https://pharmeasy.in/search/all?name=${q}` },
    { name: "Netmeds", url: `https://www.netmeds.com/catalogsearch/result/${q}/all` },
  ];
}
