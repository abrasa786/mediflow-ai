"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { calculateBMI, getPatientProfile, updateBodyStats, type BodyStats, type Patient } from "@/lib/patient";
import {
  cancelAppointment,
  getBookedTimes,
  getPastAppointments,
  getUpcomingAppointments,
  rescheduleAppointment,
  type Appointment,
} from "@/lib/appointments";
import { hoursFromRange, timeSlots, type Hours } from "@/lib/schedule";
import { deleteHealthReport, listHealthReports, type HealthReport } from "@/lib/reports";
import { ReportCard } from "@/components/chat/cards";
import MediPassSection from "@/components/profile/MediPassSection";
import DeleteAccount from "@/components/profile/DeleteAccount";

type DayOpt = { iso: string; label: string };

function nextDays(count = 7): DayOpt[] {
  const out: DayOpt[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({ iso, label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) });
  }
  return out;
}

/** Slots from the clinic's real opening hours. */
function slotsFor(iso: string, hours: Hours | null, slotMinutes: number) {
  return timeSlots(hours, new Date(iso + "T00:00"), slotMinutes);
}

type ClinicHours = { hours: Hours | null; slotMinutes: number };

async function clinicHours(clinicId: string): Promise<ClinicHours> {
  const { data } = await supabase.from("clinics").select("hours, open_time, close_time, slot_minutes").eq("id", clinicId).maybeSingle();
  const c = data as { hours?: Hours | null; open_time?: string | null; close_time?: string | null; slot_minutes?: number | null } | null;
  return { hours: c?.hours ?? hoursFromRange(c?.open_time, c?.close_time), slotMinutes: c?.slot_minutes ?? 30 };
}

function prettyDate(iso: string) {
  return new Date(iso + "T00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

const STATUS_STYLE: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-red-50 text-red-600",
  completed: "bg-gray-100 text-gray-600",
  arrived: "bg-sky-50 text-sky-700",
  no_show: "bg-amber-50 text-amber-700",
};

export default function ProfilePage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [patient, setPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(true);
  const [upcoming, setUpcoming] = useState<Appointment[]>([]);
  const [past, setPast] = useState<Appointment[]>([]);
  const [apptError, setApptError] = useState("");

  // body stats form
  const [stats, setStats] = useState<BodyStats>({});
  const [savingStats, setSavingStats] = useState(false);
  const [statsMsg, setStatsMsg] = useState("");

  // cancel / reschedule UI
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [resched, setResched] = useState<({ id: string; date: string; time: string; booked: string[] } & ClinicHours) | null>(null);
  const [reports, setReports] = useState<HealthReport[]>([]);
  const [openReport, setOpenReport] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [idCopied, setIdCopied] = useState(false);

  async function loadAppointments(uid: string) {
    try {
      const [u, p] = await Promise.all([getUpcomingAppointments(uid), getPastAppointments(uid)]);
      setUpcoming(u);
      setPast(p);
      setApptError("");
    } catch {
      setApptError("Couldn't load your appointments. Please refresh.");
    }
  }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUserId(user.id);
      const p = await getPatientProfile(user);
      setPatient(p);
      if (p) {
        setStats({ height: p.height, weight: p.weight, age: p.age, gender: p.gender, goal: p.goal, activity_level: p.activity_level });
      }
      setLoading(false);
      loadAppointments(user.id);
      listHealthReports().then(setReports);
    })();
  }, [router]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  async function doCancel(id: string) {
    setBusyId(id);
    const { data, error } = await cancelAppointment(id);
    setBusyId(null);
    setConfirmCancel(null);
    if (error || !data?.length) return flash("Couldn't cancel — please try again.");
    flash("Appointment cancelled");
    loadAppointments(userId);
  }

  async function openReschedule(a: Appointment) {
    setConfirmCancel(null);
    const ch = await clinicHours(a.clinic_id);
    const open = nextDays().filter((d) => slotsFor(d.iso, ch.hours, ch.slotMinutes).length);
    const date = open.find((d) => d.iso === a.appointment_date)?.iso ?? open[0]?.iso ?? nextDays(1)[0].iso;
    const booked = await getBookedTimes(a.clinic_id, a.doctor_id, date);
    setResched({ id: a.id, date, time: "", ...ch, booked: booked.filter((t) => !(date === a.appointment_date && t === a.appointment_time)) });
  }

  async function pickReschedDate(a: Appointment, date: string) {
    if (!resched) return;
    const booked = await getBookedTimes(a.clinic_id, a.doctor_id, date);
    setResched({ ...resched, date, time: "", booked: booked.filter((t) => !(date === a.appointment_date && t === a.appointment_time)) });
  }

  async function doReschedule() {
    if (!resched?.time) return;
    setBusyId(resched.id);
    const { data, error } = await rescheduleAppointment(resched.id, resched.date, resched.time);
    setBusyId(null);
    if (error?.code === "23505") return flash("That slot was just taken — pick another time.");
    if (error || !data?.length) return flash("Couldn't reschedule — please try again.");
    setResched(null);
    flash("Appointment rescheduled ✅");
    loadAppointments(userId);
  }

  async function saveStats() {
    setSavingStats(true);
    setStatsMsg("");
    const clean: BodyStats = {
      height: stats.height ? Number(stats.height) : null,
      weight: stats.weight ? Number(stats.weight) : null,
      age: stats.age ? Number(stats.age) : null,
      gender: stats.gender || null,
      goal: stats.goal || null,
      activity_level: stats.activity_level || null,
    };
    const { error } = await updateBodyStats(userId, clean);
    setSavingStats(false);
    setStatsMsg(error ? "Couldn't save — ask your admin to run the latest database migration." : "Saved ✅");
  }

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const bmi = calculateBMI(Number(stats.height), Number(stats.weight));
  const input = "w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-sky-400";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* NAVBAR */}
      <nav className="bg-sky-500 sticky top-0 z-40 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/home" className="text-white text-xl" aria-label="Back to home">←</Link>
            <span className="font-bold text-white text-lg">My Profile</span>
          </div>
          <button onClick={handleLogout} className="text-xs text-sky-100 hover:text-white">Logout</button>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-5 space-y-5">
        {/* Health passport */}
        <div className="bg-gradient-to-br from-sky-500 to-sky-700 rounded-2xl p-5 text-white shadow-md">
          <div className="flex items-center gap-4">
            {patient?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={patient.avatar_url} alt="" className="w-14 h-14 rounded-full object-cover border-2 border-white flex-shrink-0" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-white text-sky-600 flex items-center justify-center text-2xl font-bold flex-shrink-0">
                {patient?.name?.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-lg font-bold truncate">{patient?.name}</p>
              <p className="text-sky-100 text-xs truncate">{patient?.email}{patient?.phone && ` · ${patient.phone}`}</p>
              {patient?.city && <p className="text-sky-100 text-xs">📍 {patient.city}</p>}
            </div>
          </div>
          <div className="mt-4 bg-white/15 rounded-xl px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-[11px] text-sky-100 uppercase tracking-wide">Mediflow Patient ID</p>
              <p className="text-2xl font-bold tracking-widest">{patient?.patient_id || "Generating…"}</p>
            </div>
            {patient?.patient_id && (
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(patient.patient_id!);
                    setIdCopied(true);
                    setTimeout(() => setIdCopied(false), 2000);
                  }}
                  className="text-xs font-semibold bg-white text-sky-700 rounded-lg px-3 py-1.5"
                >
                  {idCopied ? "Copied ✓" : "Copy"}
                </button>
                <button
                  onClick={() => navigator.share?.({ title: "My Mediflow Patient ID", text: `My Mediflow Patient ID: ${patient.patient_id}` }).catch(() => {})}
                  className="text-xs font-semibold bg-white/20 rounded-lg px-3 py-1.5"
                >
                  Share
                </button>
              </div>
            )}
          </div>
          <p className="text-sky-100 text-xs mt-2">Show this ID at reception in any Mediflow clinic.</p>
        </div>

        {patient && <MediPassSection patient={patient} onSaved={(v) => setPatient({ ...patient, ...v })} />}

        {/* Upcoming appointments */}
        <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-800">Upcoming Appointments</h2>
            <Link href="/chat?start=book" className="text-xs text-sky-600 font-medium">+ Book new</Link>
          </div>
          {apptError && <p className="text-sm text-red-600 mb-2">{apptError}</p>}
          {upcoming.length === 0 && !apptError && (
            <div className="text-center py-6">
              <p className="text-3xl mb-2">📋</p>
              <p className="text-gray-400 text-sm mb-3">No upcoming appointments</p>
              <Link href="/chat?start=book" className="inline-block bg-sky-500 text-white text-xs px-5 py-2.5 rounded-xl hover:bg-sky-600">
                Book with Mediflow AI →
              </Link>
            </div>
          )}
          <div className="space-y-3">
            {upcoming.map((a) => (
              <div key={a.id} className="border border-gray-100 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-800 text-sm">{a.doctor_name}</p>
                    <p className="text-xs text-gray-500">{a.doctor_speciality}{a.doctor_speciality && " · "}{a.clinic_name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">📍 {a.clinic_address || a.clinic_area}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold text-sky-600">{a.appointment_time}</p>
                    <p className="text-xs text-gray-500">{prettyDate(a.appointment_date)}</p>
                    <p className="text-xs text-gray-400">₹{a.consultation_fee}</p>
                  </div>
                </div>
                {a.symptoms && <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 mt-3">📝 {a.symptoms}</p>}

                {/* Actions */}
                {confirmCancel === a.id ? (
                  <div className="mt-3 bg-red-50 rounded-xl p-3">
                    <p className="text-sm text-red-700 mb-2">Cancel this appointment?</p>
                    <div className="flex gap-2">
                      <button onClick={() => doCancel(a.id)} disabled={busyId === a.id}
                        className="flex-1 bg-red-600 text-white text-xs py-2 rounded-lg font-medium disabled:opacity-50">
                        {busyId === a.id ? "Cancelling…" : "Yes, cancel"}
                      </button>
                      <button onClick={() => setConfirmCancel(null)} className="flex-1 border border-gray-200 text-gray-600 text-xs py-2 rounded-lg bg-white">
                        Keep it
                      </button>
                    </div>
                  </div>
                ) : resched?.id === a.id ? (
                  <div className="mt-3 bg-sky-50 rounded-xl p-3 space-y-3">
                    <p className="text-xs font-semibold text-sky-700 uppercase tracking-wide">Pick a new date</p>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {nextDays().filter((d) => slotsFor(d.iso, resched.hours, resched.slotMinutes).length).map((d) => (
                        <button key={d.iso} onClick={() => pickReschedDate(a, d.iso)}
                          className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs border ${resched.date === d.iso ? "bg-sky-500 text-white border-sky-500" : "bg-white text-gray-600 border-gray-200"}`}>
                          {d.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs font-semibold text-sky-700 uppercase tracking-wide">Pick a time</p>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {slotsFor(resched.date, resched.hours, resched.slotMinutes).filter((t) => !resched.booked.includes(t)).map((t) => (
                        <button key={t} onClick={() => setResched({ ...resched, time: t })}
                          className={`py-1.5 rounded-lg text-xs border ${resched.time === t ? "bg-sky-500 text-white border-sky-500" : "bg-white text-gray-600 border-gray-200 hover:border-sky-300"}`}>
                          {t}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={doReschedule} disabled={!resched.time || busyId === a.id}
                        className="flex-1 bg-sky-500 text-white text-xs py-2 rounded-lg font-medium disabled:opacity-40">
                        {busyId === a.id ? "Saving…" : "Confirm new time"}
                      </button>
                      <button onClick={() => setResched(null)} className="flex-1 border border-gray-200 text-gray-600 text-xs py-2 rounded-lg bg-white">
                        Close
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => openReschedule(a)} className="flex-1 border border-sky-300 text-sky-600 text-xs py-2 rounded-lg font-medium hover:bg-sky-50">
                      🕒 Reschedule
                    </button>
                    <button onClick={() => { setResched(null); setConfirmCancel(a.id); }} className="flex-1 border border-gray-200 text-gray-600 text-xs py-2 rounded-lg font-medium hover:bg-gray-50">
                      Cancel
                    </button>
                    {a.clinic_phone && (
                      <a href={`tel:${a.clinic_phone}`} className="px-3 border border-gray-200 text-gray-600 text-xs py-2 rounded-lg" aria-label="Call clinic">📞</a>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Body stats */}
        <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-800">Body Stats</h2>
            {bmi && <span className="text-xs font-semibold bg-sky-50 text-sky-700 px-2.5 py-1 rounded-full">BMI {bmi}</span>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <label className="text-xs text-gray-500">Height (cm)
              <input type="number" value={stats.height ?? ""} onChange={(e) => setStats({ ...stats, height: e.target.value ? Number(e.target.value) : null })} className={input} />
            </label>
            <label className="text-xs text-gray-500">Weight (kg)
              <input type="number" value={stats.weight ?? ""} onChange={(e) => setStats({ ...stats, weight: e.target.value ? Number(e.target.value) : null })} className={input} />
            </label>
            <label className="text-xs text-gray-500">Age
              <input type="number" value={stats.age ?? ""} onChange={(e) => setStats({ ...stats, age: e.target.value ? Number(e.target.value) : null })} className={input} />
            </label>
            <label className="text-xs text-gray-500">Gender
              <select value={stats.gender ?? ""} onChange={(e) => setStats({ ...stats, gender: e.target.value })} className={input}>
                <option value="">—</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
              </select>
            </label>
            <label className="text-xs text-gray-500">Goal
              <select value={stats.goal ?? ""} onChange={(e) => setStats({ ...stats, goal: e.target.value })} className={input}>
                <option value="">—</option><option value="lose_fat">Lose fat</option><option value="build_muscle">Build muscle</option><option value="stay_healthy">Stay healthy</option><option value="improve_diet">Improve diet</option>
              </select>
            </label>
            <label className="text-xs text-gray-500">Activity
              <select value={stats.activity_level ?? ""} onChange={(e) => setStats({ ...stats, activity_level: e.target.value })} className={input}>
                <option value="">—</option><option value="sedentary">Sedentary</option><option value="moderate">Moderate</option><option value="active">Very active</option>
              </select>
            </label>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button onClick={saveStats} disabled={savingStats} className="bg-sky-500 text-white text-sm px-5 py-2.5 rounded-xl hover:bg-sky-600 disabled:opacity-50">
              {savingStats ? "Saving…" : "Save"}
            </button>
            {statsMsg && <p className="text-xs text-gray-500">{statsMsg}</p>}
          </div>
        </section>

        {/* Saved report analyses */}
        <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-800">My Health Reports</h2>
            <Link href="/chat?start=report" className="text-xs text-sky-600 font-medium">+ Analyse a report</Link>
          </div>
          {reports.length === 0 ? (
            <p className="text-sm text-gray-400">No reports yet — upload a blood test and the AI analysis is saved here.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {reports.map((r) => (
                <div key={r.id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <button onClick={() => setOpenReport(openReport === r.id ? null : r.id)} className="text-left min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">🔬 {r.title || "Health report"}</p>
                      <p className="text-xs text-gray-400">{prettyDate(r.created_at.slice(0, 10))} · {r.source === "fitness" ? "Fitness" : "Chat"}</p>
                    </button>
                    <button
                      onClick={async () => { await deleteHealthReport(r.id); setReports((x) => x.filter((y) => y.id !== r.id)); }}
                      className="text-xs text-gray-400 hover:text-red-600 flex-shrink-0"
                    >
                      Delete
                    </button>
                  </div>
                  {openReport === r.id && <div className="mt-2"><ReportCard analysis={r.analysis} /></div>}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Past appointments */}
        {past.length > 0 && (
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <h2 className="font-bold text-gray-800 mb-3">Past & Cancelled</h2>
            <div className="divide-y divide-gray-100">
              {past.map((a) => (
                <div key={a.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{a.doctor_name} · {a.clinic_name}</p>
                    <p className="text-xs text-gray-400">{prettyDate(a.appointment_date)} · {a.appointment_time}</p>
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-1 rounded-full capitalize flex-shrink-0 ${STATUS_STYLE[a.status] ?? STATUS_STYLE.completed}`}>
                    {a.status === "confirmed" ? "visited" : a.status}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="max-w-3xl mx-auto px-4 pb-8">
        <DeleteAccount />
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
