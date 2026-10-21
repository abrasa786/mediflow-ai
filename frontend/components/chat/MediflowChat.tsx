"use client";

// Mediflow AI guided chat bot (Salesforce-style): structured flows with quick-reply chips
// and rich cards for booking, medicines and reports; free-text questions go to the AI.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getPatientProfile } from "@/lib/patient";
import { detectEmergency, triggerEmergency } from "@/lib/emergency";
import EmergencyStatus from "@/components/emergency/EmergencyStatus";
import { createAppointment, getBookedTimes, timeToMinutes } from "@/lib/appointments";
import { useLocation, type LocationData } from "@/hooks/useLocation";
import { ApiError, apiFetch, postJSON } from "@/lib/api";
import { extractOptions, normalize } from "@/lib/chat/format";
import { saveHealthReport } from "@/lib/reports";
import {
  CONCERNS,
  DEFAULT_FILTERS,
  EMERGENCY_RE,
  OTHER_CONCERN,
  availableDays,
  ensureOptionClinic,
  findClinics,
  filtersLabel,
  matchConcern,
  parseFilters,
  timeSlots,
  type Filters,
  type ClinicOption,
  type DayChoice,
  type SpecialtyTag,
} from "@/lib/chat/booking";
import {
  BookingSummaryCard,
  ClinicCards,
  EmergencyCard,
  FiltersCard,
  MedicineCard,
  ReportCard,
  RichText,
  UploadCard,
  type BookingDraft,
  type MedicineInfo,
} from "./cards";

// ── Types ──
type Card =
  | { type: "clinics"; options: ClinicOption[]; startIndex: number }
  | { type: "filters"; initial: Filters }
  | { type: "summary"; draft: BookingDraft; booked?: boolean; patientId?: string }
  | { type: "medicine"; data: MedicineInfo; showLinks: boolean }
  | { type: "report"; analysis: string }
  | { type: "emergency" }
  | { type: "sos"; caseId: string }
  | { type: "upload"; kind: "report" | "prescription" };

type Msg = {
  id: number;
  role: "bot" | "user";
  text?: string;
  card?: Card;
  chips?: string[];
  time: Date;
  turn: number;
  greeting?: boolean; // text is personalised with the patient's name at render time
};
type NewMsg = Omit<Msg, "id" | "time" | "turn">;

type Step =
  | "menu" | "free"
  | "book_concern" | "book_filters" | "book_pick" | "book_day" | "book_period" | "book_time" | "book_confirm" | "book_done"
  | "med_name" | "med_rx" | "med_after"
  | "report_how" | "report_text" | "report_after";

type Ctx = {
  concern?: { tag: SpecialtyTag; specialist: string };
  concernLabel?: string;
  filters?: Filters;
  results: ClinicOption[];
  shown: number;
  option?: ClinicOption;
  days: DayChoice[];
  day?: DayChoice;
  daySlots?: string[]; // all free slots on the chosen day
  slots: string[]; // free slots in the chosen part of the day
  time?: string;
  medicine?: MedicineInfo;
};

type Triage = { tag: SpecialtyTag; specialist: string; emergency: boolean; empathy: string };

// ── Labels ──
const MENU = { book: "🏥 Book Appointment", medicine: "💊 Order Medicine", report: "🔬 Analyse My Report" };
const MAIN_MENU = "🏠 Main menu";
const TRY_AGAIN = "🔁 Try again";
const CONFIRM = "✅ Confirm booking";
const CHANGE_TIME = "🕒 Change time";
const CHANGE_CLINIC = "🏥 Change clinic";
const CHANGE_DAY = "📅 Change day";
const SHOW_MORE = "🔄 Show more clinics";
const CHANGE_FILTERS = "🎚️ Change filters";
const ANOTHER_MED = "🔄 Check another medicine";
const UPLOAD_RX = "📤 Upload prescription";
const CONSULT = "🩺 Consult a doctor";
const UPLOAD_REPORT = "📎 Upload PDF";
const TYPE_VALUES = "⌨️ Type the values";
const FOLLOW_UP = "🏥 Book follow-up";
const ANOTHER_REPORT = "🔬 Analyse another report";
const LOGIN = "🔐 Log in";
const CONTINUE = "↩️ Continue";
const POPULAR_MEDICINES = ["Dolo 650", "Cetirizine", "Digene", "Vitamin D3", "Azithromycin"];

// askTimeSlot — part of the day first, then the exact slot
const PERIODS = [
  { label: "🌅 Morning", from: 0, to: 12 * 60 },
  { label: "☀️ Afternoon", from: 12 * 60, to: 16 * 60 },
  { label: "🌆 Evening", from: 16 * 60, to: 24 * 60 },
];

const MENU_LIKE: Step[] = ["menu", "free", "book_done", "med_after", "report_after"];
// Steps that expect free text (a concern, a medicine name, report values)
const FREE_TEXT_STEPS: Step[] = ["book_concern", "med_name", "report_text"];
const HISTORY_LIMIT = 10;

function greetingText(name: string) {
  return `Hi ${name || "there"}! 👋 I'm Mediflow AI, your personal health assistant. I can book a doctor near you, help you order medicines, or explain your health reports.`;
}

function initialMessages(turn: number): Msg[] {
  const time = new Date();
  return [
    { id: 1, role: "bot", text: "", greeting: true, time, turn },
    { id: 2, role: "bot", text: "How can I help you today?", chips: [MENU.book, MENU.medicine, MENU.report], time, turn },
  ];
}

function locationLabel(loc: LocationData | null) {
  if (!loc || loc.area === "your area") return "";
  return loc.city && loc.city !== loc.area ? `${loc.area}, ${loc.city}` : loc.area;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Whole-word / phrase match on normalised text (so "normal" never matches "no")
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (n: string, ...words: string[]) =>
  words.some((w) => new RegExp(`(^|\\s)${escapeRe(w)}(\\s|$)`).test(n));
const isQuestion = (text: string, n: string) =>
  /\?\s*$/.test(text) || /^(what|why|how|when|where|which|who|is|are|can|could|should|does|do|will|tell me|explain)\b/.test(n);
const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

export type ChatStart = "book" | "medicine" | "report";

export default function MediflowChat({
  variant = "page",
  onClose,
  start,
}: {
  variant?: "page" | "widget";
  onClose?: () => void;
  start?: ChatStart; // deep link, e.g. /chat?start=report
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>(() => initialMessages(0));
  const [turn, setTurn] = useState(0);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const { location, status: locStatus, requestLocation } = useLocation({ auto: true });

  const messagesRef = useRef<Msg[]>(messages);
  const idRef = useRef(2);
  const turnRef = useRef(0);
  const busyRef = useRef(false);
  const stepRef = useRef<Step>("menu");
  const ctx = useRef<Ctx>({ results: [], shown: 0, days: [], slots: [] });
  const lastFailed = useRef<string | null>(null);
  const patient = useRef<{ name: string; patientId?: string; userId?: string }>({ name: "" });
  const locRef = useRef<LocationData | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    locRef.current = location;
  }, [location]);

  // Load patient profile (creates the row / Patient ID if missing)
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const data = await getPatientProfile(user);
      if (data?.name) {
        patient.current = { name: data.name, patientId: data.patient_id ?? undefined, userId: user.id };
        setFirstName(data.name.split(" ")[0]);
      }
    })();
  }, []);

  // Deep link: jump straight into a flow (once, even under React Strict Mode)
  const started = useRef(false);
  useEffect(() => {
    if (!start || started.current) return;
    started.current = true;
    handle(start === "book" ? MENU.book : start === "medicine" ? MENU.medicine : MENU.report);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  // ── Message helpers ──
  function push(m: NewMsg) {
    const msg: Msg = { ...m, id: ++idRef.current, time: new Date(), turn: turnRef.current };
    messagesRef.current = [...messagesRef.current, msg];
    setMessages(messagesRef.current);
  }

  async function bot(...parts: NewMsg[]) {
    await wait(450);
    parts.forEach((p) => push({ ...p, role: "bot" }));
  }

  const say = (text: string, chips?: string[]): NewMsg => ({ role: "bot", text, chips });

  // ── Entry point for every user action (typed text, chip, card button, upload) ──
  async function handle(text: string, action?: () => Promise<void>) {
    text = text.trim();
    if (!text || busyRef.current) return;
    setMenuOpen(false);
    turnRef.current += 1;
    setTurn(turnRef.current);
    push({ role: "user", text });
    busyRef.current = true;
    setBusy(true);
    try {
      if (action) await action();
      else await route(text);
      lastFailed.current = null;
    } catch (err) {
      console.warn("Mediflow chat error:", err);
      if (!action) lastFailed.current = text;
      if (err instanceof ApiError && err.status === 401) {
        push({ role: "bot", text: "Please log in so I can help you securely 🔐 Would you like to log in now?", chips: [LOGIN, MAIN_MENU] });
      } else if (err instanceof ApiError && err.status === 429) {
        push({ role: "bot", text: `${err.message} Would you like me to try again?`, chips: [TRY_AGAIN, MAIN_MENU] });
      } else {
        push({
          role: "bot",
          text: "I'm having a bit of trouble connecting right now 😅 Would you like me to try again?",
          chips: lastFailed.current ? [TRY_AGAIN, MAIN_MENU] : [MAIN_MENU],
        });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (variant === "page") inputRef.current?.focus();
    }
  }

  function restart() {
    turnRef.current += 1;
    stepRef.current = "menu";
    ctx.current = { results: [], shown: 0, days: [], slots: [] };
    const fresh = initialMessages(turnRef.current);
    idRef.current = fresh.length;
    messagesRef.current = fresh;
    setMessages(fresh);
    setTurn(turnRef.current);
    setMenuOpen(false);
  }

  // ── Router ──
  async function route(text: string) {
    const n = normalize(text);
    const step = stepRef.current;

    if (n === normalize(TRY_AGAIN) && lastFailed.current) return route(lastFailed.current);
    if (/^(main menu|menu|start over|restart|cancel|go to home|home)$/.test(n)) return showMenu();
    if (n === normalize(LOGIN)) {
      router.push("/login");
      return;
    }

    // Emergency red flags always win
    // Emergency red flags always win — act immediately, no questions
    const emergencyType = detectEmergency(text) ?? (EMERGENCY_RE.test(text) ? "Emergency" : null);
    if (emergencyType) return emergency(emergencyType, text);

    // Main menu choices work from anywhere
    if (n === normalize(MENU.book) || n === "book appointment") return startBooking();
    if (n === normalize(MENU.medicine) || n === "order medicine") return startMedicine();
    if (n === normalize(MENU.report) || n === "analyse my report" || n === "analyze my report") return startReport();

    if (n === normalize(CONTINUE)) return reask();
    // A real question mid-flow: answer it, then offer to continue where we were
    if (!MENU_LIKE.includes(step) && !FREE_TEXT_STEPS.includes(step) && isQuestion(text, n)) {
      return askAI(text, true);
    }

    switch (step) {
      case "book_concern": return onConcern(text);
      case "book_filters": return onFilters(text);
      case "book_pick": return onPick(n);
      case "book_day": return onDay(n);
      case "book_period": return onPeriod(n);
      case "book_time": return onTime(n);
      case "book_confirm": return onConfirm(n);
      case "med_name": return onMedicine(text);
      case "med_rx": return onRx(n);
      case "report_how": return onReportHow(text, n);
      case "report_text": return onReportText(text);
    }

    // Menu-like steps: step-specific follow-ups, then intent detection, then AI
    if (step === "med_after" && has(n, "another medicine", "check another")) return askMedicineName();
    if (step === "report_after" && has(n, "another report")) return startReport();
    if (has(n, "follow-up", "follow up")) return startBooking();
    if (MENU_LIKE.includes(step)) {
      if (/^ask( a)? question/.test(n)) {
        stepRef.current = "free";
        return bot(say("Sure! What would you like to know?"));
      }
      if (/\b(book|appointment|consult|clinic)\b/.test(n) && n.split(" ").length <= 8) return startBooking();
      if (/\b(order|buy)\b.*\b(medicine|tablet|syrup)\b|^(medicine|order medicine)$/.test(n)) return startMedicine();
      if (/\b(blood (test|report)|lab report|cbc|analy[sz]e (my )?report)\b/.test(n)) return startReport();
    }
    return askAI(text);
  }

  /** Repeat the current step's question (after a side question). */
  async function reask() {
    const c = ctx.current;
    switch (stepRef.current) {
      case "book_filters": return askFilters();
      case "book_pick": return bot(say("Which clinic would you like to book?", pickChips()));
      case "book_day": return bot(say("Which day works best for you?", [...c.days.map((d) => d.label), CHANGE_CLINIC]));
      case "book_period": return askPeriod();
      case "book_time": return bot(say("Which time slot would you prefer?", [...c.slots, CHANGE_TIME]));
      case "book_confirm": return bot(say("Shall I confirm this appointment?", [CONFIRM, CHANGE_TIME, CHANGE_CLINIC]));
      case "med_rx": return bot(say("Do you have a valid prescription?", [UPLOAD_RX, CONSULT, ANOTHER_MED]));
      case "report_how": return bot(say("How would you like to share your report?", [UPLOAD_REPORT, TYPE_VALUES]));
      default: return showMenu();
    }
  }

  // ── Menu & emergency ──
  async function showMenu() {
    stepRef.current = "menu";
    await bot(say("What would you like to do next?", [MENU.book, MENU.medicine, MENU.report]));
  }

  /** Auto-detected emergency: create + auto-assign an SOS case right away (no confirmation). */
  async function emergency(type: string, message: string) {
    stepRef.current = "menu";
    const mental = type === "Mental health crisis";
    // Check the session directly — the profile may still be loading when the message arrives
    const { data: { session } } = await supabase.auth.getSession();
    const signedIn = !!session?.user;
    if (signedIn) {
      try {
        const loc = locRef.current ?? (await requestLocation());
        const caseId = await triggerEmergency(type, message, loc);
        return bot(
          say(
            mental
              ? "I'm really glad you told me 💙 You're not alone. I've alerted a nearby clinic and your emergency contact. Please call Tele-MANAS on 14416 — they're there for you right now."
              : "🚨 This sounds like an emergency. I've alerted the nearest emergency-ready clinic and your emergency contact — you don't need to do anything else."
          ),
          { role: "bot", card: { type: "sos", caseId } }
        );
      } catch (err) {
        console.warn("SOS creation failed:", err);
      }
    }
    await bot(
      { role: "bot", card: { type: "emergency" } },
      say(
        signedIn
          ? "I couldn't reach the clinic network just now — please call 112 or 108 immediately."
          : "Please call 112 or 108 right away. Log in so next time I can alert the nearest clinic for you automatically.",
        signedIn ? [MAIN_MENU] : [LOGIN, MAIN_MENU]
      )
    );
  }

  // ── BOOKING ──
  async function startBooking() {
    ctx.current = { results: [], shown: 0, days: [], slots: [] };
    stepRef.current = "book_concern";
    const area = locationLabel(locRef.current);
    await bot(
      say(area ? `Sure, let's find a doctor near you 📍 ${area}.` : "Sure, let's find a doctor near you 🩺"),
      say("What's bothering you today?", [...CONCERNS.map((c) => c.label), OTHER_CONCERN])
    );
  }

  async function onConcern(text: string) {
    if (text === OTHER_CONCERN) {
      return bot(say("No problem. What symptoms or health concern do you have?"));
    }
    let concern = matchConcern(text);
    let lead = concern?.tag === "General" ? "" : "Got it. ";
    if (!concern) {
      const t = await postJSON<Triage>("/triage", { concern: text });
      if (t.emergency) return emergency(t.specialist ? `${t.specialist} emergency` : "Emergency", text);
      const known = t.tag && t.tag !== "Other";
      concern = {
        label: text,
        tag: known ? t.tag : "General",
        specialist: known ? t.specialist || "General Physician" : "General Physician",
      };
      lead = t.empathy ? `${t.empathy} ` : "";
    }
    const c = ctx.current;
    c.concern = { tag: concern.tag, specialist: concern.specialist };
    c.concernLabel = concern.label.replace(/^\P{L}+/u, "");
    const art = article(concern.specialist);
    await askFilters(`${lead}${art[0].toUpperCase()}${art.slice(1)} **${concern.specialist}** is the right doctor for this.`);
  }

  /** One-line summary saved with the appointment for the doctor. */
  function symptomSummary() {
    return ctx.current.concernLabel ?? "";
  }

  async function askFilters(lead?: string) {
    stepRef.current = "book_filters";
    const parts: NewMsg[] = [];
    if (lead) parts.push(say(lead));
    parts.push(
      say("Set your consultation fee and rating, then tap **Show clinics** 👇"),
      { role: "bot", card: { type: "filters", initial: ctx.current.filters ?? DEFAULT_FILTERS } }
    );
    await bot(...parts);
  }

  async function onFilters(text: string) {
    const filters = parseFilters(text);
    if (!filters) {
      return bot(say("Sorry, I didn't catch that. Use the slider above, or type something like “under ₹800, 4 star”."));
    }
    return applyFilters(filters);
  }

  async function applyFilters(filters: Filters) {
    ctx.current.filters = filters;
    await searchClinics();
  }

  async function searchClinics() {
    const c = ctx.current;
    const concern = c.concern ?? { tag: "General" as SpecialtyTag, specialist: "General Physician" };
    const loc = locRef.current ?? (await requestLocation());
    if (!loc) {
      stepRef.current = "book_filters";
      return bot(
        say("I need your location to find real clinics near you 📍 Please allow location access in your browser (or tap “Enable location” at the top), then tap **Show clinics** again."),
        { role: "bot", card: { type: "filters", initial: c.filters ?? DEFAULT_FILTERS } }
      );
    }
    const result = await findClinics(concern.tag, concern.specialist, c.filters ?? DEFAULT_FILTERS, loc);
    // Urgent cases: strictly nearest first
    c.results = result.options;
    c.shown = 0;
    if (!result.options.length) {
      return askFilters("Sorry, I couldn't find any clinics for that right now 😕 Try changing the filters.");
    }
    const area = locationLabel(loc) || "you";
    const filtered = c.filters && (c.filters.maxFee != null || c.filters.minRating != null) && !result.note ? ", matching your filters" : "";
    const intro = `Here are real clinics near ${area}${filtered} 👇`;
    await showResults(result.note ? `${intro}\n\n${result.note}` : intro);
  }

  async function showResults(intro: string) {
    const c = ctx.current;
    const start = c.shown;
    const slice = c.results.slice(start, start + 2);
    c.shown = start + slice.length;
    stepRef.current = "book_pick";
    await bot(
      say(intro),
      { role: "bot", card: { type: "clinics", options: slice, startIndex: start } },
      say("Which clinic would you like to book?", pickChips())
    );
  }

  function pickChips() {
    const c = ctx.current;
    const chips = c.results.slice(0, c.shown).map((_, i) => `Book Option ${i + 1}`);
    if (c.shown < c.results.length) chips.push(SHOW_MORE);
    chips.push(CHANGE_FILTERS);
    return chips;
  }

  async function onPick(n: string) {
    const c = ctx.current;
    if (has(n, "show more", "more clinic", "more option")) {
      if (c.shown < c.results.length) return showResults("Here are more options 👇");
      return bot(say("That's every clinic I have for this right now. Which clinic would you like to book?", pickChips()));
    }
    if (has(n, "change filters", "filters", "filter", "change budget", "budget")) return askFilters();

    const words: Record<string, number> = { first: 1, one: 1, second: 2, two: 2, third: 3, three: 3, fourth: 4, four: 4 };
    let idx = Number(n.match(/\d+/)?.[0] ?? 0);
    if (!idx) for (const [w, v] of Object.entries(words)) if (n.split(" ").includes(w)) idx = v;
    if (!idx) {
      const byName = c.results
        .slice(0, c.shown)
        .findIndex((o) => n.includes(normalize(o.clinicName)) || (!!o.area && n.includes(normalize(o.area))));
      if (byName >= 0) idx = byName + 1;
    }
    const option = idx >= 1 && idx <= c.shown ? c.results[idx - 1] : null;
    if (!option) return bot(say("Which clinic would you like to book?", pickChips()));

    c.option = option;
    c.days = availableDays(option);
    if (!c.days.length) {
      return bot(say(`Sorry, ${option.doctorName} has no free slots this week 😕 Which other clinic would you like?`, pickChips()));
    }
    stepRef.current = "book_day";
    await bot(
      say(`Great choice! 👍 ${option.doctorName} at ${option.clinicName}.`),
      say("Which day works best for you?", [...c.days.map((d) => d.label), CHANGE_CLINIC])
    );
  }

  async function onDay(n: string) {
    const c = ctx.current;
    if (has(n, "change clinic")) return showResultsAgain();
    const day = c.days.find((d) => normalize(d.label) === n) ?? c.days.find((d) => n.includes(normalize(d.label)));
    if (!day || !c.option) return bot(say("Which day works best for you?", [...c.days.map((d) => d.label), CHANGE_CLINIC]));
    c.day = day;
    // Hide slots that are already booked (a map listing nobody has booked yet has none)
    const booked = new Set(c.option.clinicId ? await getBookedTimes(c.option.clinicId, c.option.doctorId, day.iso) : []);
    c.daySlots = timeSlots(c.option, day.date).filter((s) => !booked.has(s));
    if (!c.daySlots.length) {
      return bot(say(`Sorry, ${day.label} is fully booked 😕 Which other day works for you?`, [...c.days.filter((d) => d !== day).map((d) => d.label), CHANGE_CLINIC]));
    }
    return askPeriod();
  }

  function periodSlots(label: string) {
    const p = PERIODS.find((x) => x.label === label)!;
    return (ctx.current.daySlots ?? []).filter((s) => {
      const m = timeToMinutes(s);
      return m >= p.from && m < p.to;
    });
  }

  // askTimeSlot: Morning / Afternoon / Evening first
  async function askPeriod() {
    const c = ctx.current;
    stepRef.current = "book_period";
    const available = PERIODS.filter((p) => periodSlots(p.label).length > 0).map((p) => p.label);
    const when = c.day && (c.day.label === "Today" || c.day.label === "Tomorrow") ? c.day.label.toLowerCase() : `on ${c.day?.label}`;
    await bot(say(`Which time of day suits you ${when}?`, [...available, CHANGE_DAY]));
  }

  async function onPeriod(n: string): Promise<void> {
    const c = ctx.current;
    if (has(n, "change day")) {
      stepRef.current = "book_day";
      return bot(say("Which day works best for you?", [...c.days.map((d) => d.label), CHANGE_CLINIC]));
    }
    const period = PERIODS.find((p) => n.includes(normalize(p.label)));
    // Typed an exact time instead? Accept it directly.
    if (!period) {
      c.slots = c.daySlots ?? [];
      return onTime(n);
    }
    c.slots = periodSlots(period.label);
    if (!c.slots.length) return askPeriod();
    stepRef.current = "book_time";
    await bot(say("Which time slot would you prefer?", [...c.slots, CHANGE_TIME]));
  }

  async function onTime(n: string): Promise<void> {
    const c = ctx.current;
    if (has(n, "change day")) {
      stepRef.current = "book_day";
      return bot(say("Which day works best for you?", [...c.days.map((d) => d.label), CHANGE_CLINIC]));
    }
    if (has(n, "change time", "morning", "afternoon", "evening")) {
      if (has(n, "morning", "afternoon", "evening")) return onPeriod(n);
      return askPeriod();
    }
    const compact = (s: string) => normalize(s).replace(/\s|:00/g, "").replace(/^0/, "");
    const slot = c.slots.find((s) => normalize(s) === n) ?? c.slots.find((s) => compact(s) === compact(n));
    if (!slot || !c.option || !c.day) return bot(say("Which time slot would you prefer?", [...c.slots, CHANGE_TIME]));
    c.time = slot;
    stepRef.current = "book_confirm";
    await bot(
      { role: "bot", card: { type: "summary", draft: draft()! } },
      say("Shall I confirm this appointment?", [CONFIRM, CHANGE_TIME, CHANGE_CLINIC])
    );
  }

  function draft(): BookingDraft | null {
    const c = ctx.current;
    if (!c.option || !c.day || !c.time) return null;
    return { option: c.option, dayLabel: `${c.day.label} (${c.day.date.toLocaleDateString("en-IN", { day: "numeric", month: "short" })})`, dateIso: c.day.iso, time: c.time };
  }

  async function showResultsAgain() {
    ctx.current.shown = 0;
    return showResults("Here are your options again 👇");
  }

  async function onConfirm(n: string) {
    const c = ctx.current;
    if (has(n, "change time")) return askPeriod();
    if (has(n, "change clinic")) return showResultsAgain();
    if (!has(n, "confirm", "yes", "ok", "book")) return bot(say("Shall I confirm this appointment?", [CONFIRM, CHANGE_TIME, CHANGE_CLINIC]));

    const d = draft();
    if (!d) return startBooking();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return bot(say("Please log in so I can save this booking to your account. Would you like to log in now?", [LOGIN, MAIN_MENU]));

    // confirmBooking → save the map listing (first booking) → createAppointment
    let clinicId: string;
    try {
      clinicId = await ensureOptionClinic(d.option);
    } catch (e) {
      console.warn("Saving clinic failed:", e);
      const call = d.option.phone ? ` You can also call the clinic directly at ${d.option.phone}.` : "";
      return bot(say(`I couldn't reserve this slot right now 😟${call} Would you like me to try again?`, [CONFIRM, MAIN_MENU]));
    }
    const { error } = await createAppointment({
      patientId: user.id,
      clinicId,
      doctorId: d.option.doctorId,
      date: d.dateIso,
      time: d.time,
      fee: d.option.fee,
      symptoms: symptomSummary(),
    });
    if (error?.code === "23505") {
      // Unique index: someone just took this slot
      c.daySlots = (c.daySlots ?? []).filter((s) => s !== d.time);
      await bot(say(`Oh no — ${d.time} was just booked by someone else 😕`));
      return askPeriod();
    }
    if (error) {
      console.warn("Booking insert failed:", error);
      const call = d.option.phone ? ` You can also call the clinic directly at ${d.option.phone}.` : "";
      return bot(say(`I couldn't save your booking 😟${call} Would you like me to try again?`, [CONFIRM, MAIN_MENU]));
    }
    stepRef.current = "book_done";
    const confirmNote = d.option.onMediflow
      ? "The clinic has your booking on its Mediflow dashboard ✅"
      : d.option.phone
      ? `Heads-up: ${d.option.clinicName} isn't on Mediflow yet, so please call ${d.option.phone} to confirm this slot 📞`
      : `Heads-up: ${d.option.clinicName} isn't on Mediflow yet and hasn't listed a phone number — please confirm in person before you go.`;
    await bot(
      { role: "bot", card: { type: "summary", draft: d, booked: true, patientId: patient.current.patientId } },
      say(confirmNote),
      say("You're all set! 🎉 Get well soon 💙 Is there anything else I can help you with?", [MENU.medicine, MENU.report, MAIN_MENU])
    );
  }

  // ── MEDICINE ──
  async function startMedicine() {
    stepRef.current = "med_name";
    await bot(
      say("I'll check if it needs a prescription, compare allopathy & ayurvedic options, and show you where to order 💊 You can also type a symptom, like “headache”."),
      say("Which medicine are you looking for?", POPULAR_MEDICINES)
    );
  }

  async function askMedicineName() {
    stepRef.current = "med_name";
    await bot(say("Which medicine would you like to check?", POPULAR_MEDICINES));
  }

  async function onMedicine(text: string) {
    const data = await postJSON<MedicineInfo>("/medicine-check", { query: text });
    if (!data.found || !data.name) {
      return bot(say(`Hmm, I couldn't find “${text}” 🤔 Could you check the spelling and type the medicine name again?`, POPULAR_MEDICINES));
    }
    ctx.current.medicine = data;
    if (data.requires_prescription) {
      stepRef.current = "med_rx";
      return bot(
        say(`**${data.name}** needs a doctor's prescription 🔒 It's safest taken under medical supervision.`),
        { role: "bot", card: { type: "medicine", data, showLinks: false } },
        say("Do you have a valid prescription?", [UPLOAD_RX, CONSULT, ANOTHER_MED])
      );
    }
    stepRef.current = "med_after";
    await bot(
      say(`Good news — **${data.name}** doesn't need a prescription ✅`),
      { role: "bot", card: { type: "medicine", data, showLinks: true } },
      say("What would you like to do next?", [ANOTHER_MED, MENU.book, MAIN_MENU])
    );
  }

  async function onRx(n: string) {
    if (has(n, "upload", "yes", "i have")) {
      return bot(
        say("Please upload a photo or PDF of your prescription 👇"),
        { role: "bot", card: { type: "upload", kind: "prescription" } }
      );
    }
    if (has(n, "consult", "doctor", "no")) {
      ctx.current = { results: [], shown: 0, days: [], slots: [], concern: { tag: "General", specialist: "General Physician" } };
      return askFilters("A **General Physician** can examine you and prescribe the right medicine.");
    }
    if (has(n, "another")) return askMedicineName();
    return bot(say("Do you have a valid prescription?", [UPLOAD_RX, CONSULT, ANOTHER_MED]));
  }

  async function onPrescriptionFile() {
    const data = ctx.current.medicine;
    stepRef.current = "med_after";
    await bot(
      say("Thanks, prescription received ✅ Keep this file handy — the pharmacy will verify it at checkout."),
      ...(data ? [{ role: "bot" as const, card: { type: "medicine" as const, data, showLinks: true } }] : []),
      say("What would you like to do next?", [ANOTHER_MED, MENU.book, MAIN_MENU])
    );
  }

  // ── REPORT ──
  async function startReport() {
    stepRef.current = "report_how";
    await bot(
      say("I'll explain your blood test in simple language — what's abnormal, what to eat, exercise, supplements and when to see a doctor 🔬"),
      say("How would you like to share your report?", [UPLOAD_REPORT, TYPE_VALUES])
    );
  }

  const looksLikeValues = (t: string) => (t.match(/\d+(\.\d+)?/g) || []).length >= 1 && t.length >= 6;

  async function onReportHow(text: string, n: string) {
    if (has(n, "upload", "pdf")) {
      return bot(
        say("Please upload your report (PDF or text file) 👇"),
        { role: "bot", card: { type: "upload", kind: "report" } }
      );
    }
    if (has(n, "type", "paste", "values")) {
      stepRef.current = "report_text";
      return bot(say("What are your report values? Type or paste them, e.g. “Hb 10.2, Vitamin D 14, TSH 5.8”."));
    }
    if (looksLikeValues(text)) return analyseReport(text);
    return bot(say("How would you like to share your report?", [UPLOAD_REPORT, TYPE_VALUES]));
  }

  async function onReportText(text: string) {
    if (!looksLikeValues(text)) {
      return bot(say("Could you share the values with their numbers? For example: “Hb 10.2, Vitamin D 14, TSH 5.8”."));
    }
    return analyseReport(text);
  }

  async function onReportFile(file: File) {
    const form = new FormData();
    form.append("file", file);
    const res = await apiFetch(`/extract-report`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { text } = (await res.json()) as { text: string };
    if (!text || text.replace(/\s/g, "").length < 20) {
      stepRef.current = "report_text";
      return bot(say("I couldn't read the text in that file 😕 (scanned photos aren't supported yet). Could you type the key values instead?"));
    }
    return analyseReport(text);
  }

  async function analyseReport(reportText: string) {
    const data = await postJSON<{ analysis: string; error?: string }>("/analyze-blood-report", {
      report_text: reportText,
      bodyStats: {},
      bmi: null,
    });
    if (data.error || !data.analysis) throw new Error(data.error || "No analysis");
    saveHealthReport(data.analysis, "chat");
    stepRef.current = "report_after";
    await bot(
      say("Here's what your report says 👇"),
      { role: "bot", card: { type: "report", analysis: data.analysis } },
      say("Would you like to book a follow-up with a doctor?", [FOLLOW_UP, ANOTHER_REPORT, MAIN_MENU])
    );
  }

  // ── Uploads ──
  function onFile(kind: "report" | "prescription", file: File) {
    handle(`📎 ${file.name}`, kind === "report" ? () => onReportFile(file) : onPrescriptionFile);
  }

  // ── Free-form AI ──
  async function askAI(text: string, keepStep = false) {
    const prior = messagesRef.current.slice(0, -1); // exclude the message we just pushed
    const history = prior
      .map((m) => ({ role: m.role === "bot" ? "assistant" : "user", content: m.greeting ? greetingText(firstName) : m.text || "" }))
      .filter((m) => m.content.trim())
      .slice(-HISTORY_LIMIT);
    const data = await postJSON<{ reply: string }>("/chat", {
      message: text,
      history,
      location: locationLabel(locRef.current),
    });
    const { clean, options } = extractOptions((data.reply || "").trim());
    if (!clean) throw new Error("Empty reply");
    if (keepStep) return bot(say(clean, [CONTINUE, MAIN_MENU]));
    stepRef.current = "free";
    await bot(say(clean, options.length ? options : [MENU.book, MENU.medicine, MENU.report]));
  }

  // ── Render ──
  const area = locationLabel(location);
  const isWidget = variant === "widget";

  function timeLabel(d: Date) {
    return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  }

  function renderCard(msg: Msg, active: boolean) {
    const card = msg.card!;
    switch (card.type) {
      case "clinics":
        return <ClinicCards options={card.options} startIndex={card.startIndex} active={active} onSelect={(_, n) => handle(`Book Option ${n}`)} />;
      case "filters":
        return <FiltersCard initial={card.initial} active={active} onApply={(f) => handle(filtersLabel(f), () => applyFilters(f))} />;
      case "summary":
        return <BookingSummaryCard draft={card.draft} booked={card.booked} patientId={card.patientId} />;
      case "medicine":
        return <MedicineCard data={card.data} showLinks={card.showLinks} />;
      case "report":
        return <ReportCard analysis={card.analysis} />;
      case "emergency":
        return <EmergencyCard />;
      case "sos":
        return <EmergencyStatus caseId={card.caseId} patientId={patient.current.patientId} compact />;
      case "upload":
        return card.kind === "report" ? (
          <UploadCard title="Upload blood report" hint="PDF or .txt · max 10 pages" accept=".pdf,.txt" active={active} onFile={(f) => onFile("report", f)} />
        ) : (
          <UploadCard title="Upload prescription" hint="Photo or PDF" accept="image/*,.pdf" active={active} onFile={(f) => onFile("prescription", f)} />
        );
    }
  }

  return (
    <div className={`flex flex-col h-full bg-slate-50 text-slate-800 ${isWidget ? "rounded-2xl overflow-hidden" : ""}`}>
      {/* ── Header ── */}
      <div className="bg-gradient-to-r from-sky-500 to-sky-600 text-white px-3 py-3 flex items-center gap-2.5 shadow-sm flex-shrink-0">
        {!isWidget && (
          <button
            onClick={() => (window.history.length > 1 ? router.back() : router.push("/home"))}
            aria-label="Go back"
            className="w-8 h-8 rounded-full hover:bg-white/15 flex items-center justify-center"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <div className="relative flex-shrink-0">
          <div className="w-9 h-9 rounded-full bg-white text-sky-600 flex items-center justify-center font-bold text-sm">M</div>
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-sky-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[15px] leading-tight">Mediflow Assistant</p>
          <p className="text-[11px] text-sky-100 truncate">
            {locStatus === "loading" && "📍 Detecting your location…"}
            {area && `📍 ${area}`}
            {!area && locStatus !== "loading" && (
              <button onClick={() => requestLocation()} className="underline underline-offset-2">
                📍 Location off — tap to enable
              </button>
            )}
          </p>
        </div>
        <button onClick={restart} aria-label="Start over" title="Start over" className="w-8 h-8 rounded-full hover:bg-white/15 flex items-center justify-center">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M5.1 15a7 7 0 0011.9 2.9L20 15M4 9l3-2.9A7 7 0 0118.9 9" />
          </svg>
        </button>
        {isWidget && (
          <>
            <Link href="/chat" aria-label="Open full screen" title="Open full screen" className="w-8 h-8 rounded-full hover:bg-white/15 flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
              </svg>
            </Link>
            <button onClick={onClose} aria-label="Close chat" className="w-8 h-8 rounded-full hover:bg-white/15 flex items-center justify-center text-lg leading-none">
              ✕
            </button>
          </>
        )}
      </div>

      {/* ── Conversation ── */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {messages.map((msg, i) => {
          const prev = messages[i - 1];
          const firstInGroup = !prev || prev.role !== msg.role;
          const active = msg.turn === turn && !busy;
          const text = msg.greeting ? greetingText(firstName) : msg.text;

          if (msg.role === "user") {
            return (
              <div key={msg.id} className={`flex flex-col items-end ${firstInGroup ? "pt-3" : ""}`}>
                <div className="max-w-[80%] bg-sky-500 text-white text-sm leading-relaxed px-3.5 py-2 rounded-2xl rounded-br-md shadow-sm whitespace-pre-wrap break-words">
                  {text}
                </div>
                <span className="text-[10px] text-slate-400 mt-1 px-1" suppressHydrationWarning>
                  {timeLabel(msg.time)}
                </span>
              </div>
            );
          }

          return (
            <div key={msg.id} className={`flex gap-2 ${firstInGroup ? "pt-3" : ""}`}>
              <div className="w-7 flex-shrink-0">
                {firstInGroup && (
                  <div className="w-7 h-7 rounded-full bg-sky-500 text-white flex items-center justify-center text-[11px] font-bold">M</div>
                )}
              </div>
              <div className="flex-1 min-w-0 flex flex-col items-start">
                {firstInGroup && (
                  <span className="text-[11px] text-slate-400 mb-1" suppressHydrationWarning>
                    Mediflow AI · {timeLabel(msg.time)}
                  </span>
                )}
                {text && (
                  <div className="max-w-[92%] bg-white border border-slate-200 text-slate-800 text-sm leading-relaxed px-3.5 py-2 rounded-2xl rounded-tl-md shadow-sm whitespace-pre-wrap break-words">
                    <RichText text={text} />
                  </div>
                )}
                {msg.card && <div className="w-full max-w-[92%]">{renderCard(msg, active)}</div>}
                {msg.chips && msg.chips.length > 0 && active && (
                  <div className="flex flex-wrap gap-1.5 mt-2 max-w-full">
                    {msg.chips.map((chip) => (
                      <button
                        key={chip}
                        onClick={() => handle(chip)}
                        className="text-[13px] font-medium px-3.5 py-1.5 rounded-full border border-sky-500 text-sky-600 bg-white hover:bg-sky-500 hover:text-white active:scale-95 transition-all"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {busy && (
          <div className="flex gap-2 pt-3">
            <div className="w-7 h-7 rounded-full bg-sky-500 text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0">M</div>
            <div className="bg-white border border-slate-200 shadow-sm rounded-2xl rounded-tl-md px-4 py-3 flex items-center gap-1.5" aria-label="Mediflow AI is typing">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Composer ── */}
      <div className="relative bg-white border-t border-slate-200 px-3 pt-2.5 pb-2 flex-shrink-0">
        {menuOpen && (
          <div className="absolute bottom-full left-3 mb-2 w-60 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-10">
            {[MENU.book, MENU.medicine, MENU.report, MAIN_MENU].map((item) => (
              <button
                key={item}
                onClick={() => handle(item)}
                className="block w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-sky-50 border-b border-slate-100 last:border-0"
              >
                {item}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const t = input;
            setInput("");
            handle(t);
          }}
          className="flex items-center gap-2"
        >
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Open menu"
            className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 border transition-colors ${
              menuOpen ? "bg-sky-50 border-sky-300 text-sky-600" : "border-slate-200 text-slate-500 hover:text-sky-600"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message…"
            className="flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-full px-4 py-2 text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
          />
          <button
            type="submit"
            disabled={!input.trim() || busy}
            aria-label="Send message"
            className="w-9 h-9 rounded-full bg-sky-500 hover:bg-sky-600 text-white flex items-center justify-center flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </form>
        <p className="text-center text-[10px] text-slate-400 mt-1.5">Mediflow AI · For guidance only · Always consult a doctor</p>
      </div>
    </div>
  );
}
