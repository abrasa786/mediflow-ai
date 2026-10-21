// Opening hours → bookable days and time slots.
// Hours come from the map (Google / OpenStreetMap) or from the clinic's own settings:
//   { "Mon": [[540, 780], [1020, 1260]], … }  (minutes from midnight, multiple spans per day)

export type DayName = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export type Hours = Partial<Record<DayName, [number, number][]>>;

export const WEEK: DayName[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const JS_DAYS: DayName[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Used when a listing has no published hours (the patient is told to call and confirm). */
export const TYPICAL_HOURS: Hours = Object.fromEntries(WEEK.slice(0, 6).map((d) => [d, [[540, 1260]]])) as Hours;

export function dayName(d: Date): DayName {
  return JS_DAYS[d.getDay()];
}

export function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function hhmmToMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function minutesToHhmm(mins: number) {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

export function formatSlot(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Hours from a clinic row's open/close time when it has no per-day hours. */
export function hoursFromRange(open?: string | null, close?: string | null, days: DayName[] = WEEK.slice(0, 6)): Hours | null {
  if (!open || !close) return null;
  const o = hhmmToMinutes(open.slice(0, 5));
  const c = hhmmToMinutes(close.slice(0, 5));
  if (!(c > o)) return null;
  return Object.fromEntries(days.map((d) => [d, [[o, c]]])) as Hours;
}

/** "Mon–Sat 9:00 AM – 9:00 PM" style summary. */
export function describeHours(hours: Hours | null | undefined): string {
  if (!hours) return "Hours not listed";
  const open = WEEK.filter((d) => hours[d]?.length);
  if (!open.length) return "Hours not listed";
  const spans = (d: DayName) => (hours[d] ?? []).map(([a, b]) => `${formatSlot(a)} – ${formatSlot(Math.min(b, 1439))}`).join(", ");
  const same = open.every((d) => spans(d) === spans(open[0]));
  const days = open.length === 7 ? "Every day" : open.length > 2 && same ? `${open[0]}–${open[open.length - 1]}` : open.join(", ");
  return same ? `${days} · ${spans(open[0])}` : `${open.join(", ")} (varies)`;
}

/**
 * Bookable slots on a date: every `slotMinutes` inside the opening spans, ending before close,
 * and at least 45 minutes from now when the date is today.
 */
export function timeSlots(hours: Hours | null | undefined, date: Date, slotMinutes = 30): string[] {
  const spans = (hours ?? TYPICAL_HOURS)[dayName(date)] ?? [];
  const now = new Date();
  const earliest = date.toDateString() === now.toDateString() ? now.getHours() * 60 + now.getMinutes() + 45 : 0;
  const step = Math.max(10, slotMinutes || 30);
  const slots: string[] = [];
  for (const [start, end] of spans) {
    const first = Math.ceil(start / step) * step;
    for (let t = first; t + step <= Math.min(end, 1440); t += step) {
      if (t >= earliest) slots.push(formatSlot(t));
    }
  }
  return slots;
}

export type DayChoice = { label: string; iso: string; date: Date };

/** Next `count` days the clinic (and doctor, if given) is open and still has slots. */
export function bookableDays(
  hours: Hours | null | undefined,
  opts: { doctorDays?: string[] | null; slotMinutes?: number; count?: number; horizon?: number } = {}
): DayChoice[] {
  const { doctorDays, slotMinutes = 30, count = 5, horizon = 14 } = opts;
  const days: DayChoice[] = [];
  for (let i = 0; i < horizon && days.length < count; i++) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + i);
    if (doctorDays?.length && !doctorDays.includes(dayName(d))) continue;
    if (!timeSlots(hours, d, slotMinutes).length) continue;
    const label =
      i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
    days.push({ label, iso: isoDate(d), date: d });
  }
  return days;
}
