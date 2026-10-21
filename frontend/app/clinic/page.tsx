"use client";

// Clinic Business Portal — clinic.mediflowai.in (rewritten to /clinic by proxy.ts)

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  ageFromDob,
  getActiveEmergencies,
  getClinicAppointments,
  getClinicDoctors,
  getMyClinics,
  markAppointment,
  respondToEmergency,
  type ClinicAppointment,
  type ClinicEmergency,
  type ClinicInfo,
  type PatientCard,
} from "@/lib/clinic";
import { dispatchAmbulance, type EmergencyCase } from "@/lib/emergency";
import { todayIso } from "@/lib/appointments";
import ClinicSettings from "@/components/clinic/ClinicSettings";
import DoctorsManager from "@/components/clinic/DoctorsManager";

const REASSIGN_AFTER_S = 180;

function isoPlus(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function useNow(everyMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

const STATUS_STYLE: Record<string, string> = {
  confirmed: "bg-sky-50 text-sky-700",
  arrived: "bg-emerald-50 text-emerald-700",
  completed: "bg-slate-100 text-slate-600",
  no_show: "bg-amber-50 text-amber-700",
  cancelled: "bg-red-50 text-red-600",
};

export default function ClinicPortal() {
  const router = useRouter();
  const now = useNow();
  const [state, setState] = useState<"loading" | "not_member" | "ready">("loading");
  const [clinics, setClinics] = useState<ClinicInfo[]>([]);
  const [clinicId, setClinicId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [appointments, setAppointments] = useState<ClinicAppointment[]>([]);
  const [emergencies, setEmergencies] = useState<ClinicEmergency[]>([]);
  const [enRoute, setEnRoute] = useState<EmergencyCase[]>([]);
  const [doctors, setDoctors] = useState<{ id: string; name: string; speciality: string }[]>([]);
  const [medipass, setMedipass] = useState<PatientCard | null>(null);
  const [toast, setToast] = useState("");
  const [soundOn, setSoundOn] = useState(false);
  const [tab, setTab] = useState<"appointments" | "doctors" | "settings">("appointments");
  const audio = useRef<AudioContext | null>(null);

  const clinic = clinics.find((c) => c.id === clinicId);

  // ── Auth + membership ──
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/clinic/login"); return; }
      const mine = await getMyClinics();
      if (!mine.length) { setState("not_member"); return; }
      setClinics(mine);
      setClinicId(mine[0].id);
      setState("ready");
    })();
  }, [router]);

  const load = useCallback(async () => {
    if (!clinicId) return;
    const [appts, ems, docs, route] = await Promise.all([
      getClinicAppointments(clinicId, date),
      getActiveEmergencies(clinicId),
      getClinicDoctors(clinicId),
      supabase
        .from("emergency_cases")
        .select("*")
        .eq("clinic_id", clinicId)
        .eq("status", "ambulance_dispatched")
        .neq("ambulance_status", "completed")
        .order("created_at", { ascending: false }),
    ]);
    setAppointments(appts);
    setEmergencies(ems);
    setDoctors(docs);
    setEnRoute((route.data as EmergencyCase[]) ?? []);
  }, [clinicId, date]);

  // ── Realtime: emergencies + appointments for this clinic ──
  useEffect(() => {
    if (!clinicId) return;
    const first = setTimeout(load, 0);
    const channel = supabase
      .channel(`clinic-${clinicId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "emergency_cases", filter: `clinic_id=eq.${clinicId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `clinic_id=eq.${clinicId}` }, load)
      .subscribe();
    const poll = setInterval(load, 20000); // fallback if Realtime drops
    return () => {
      clearTimeout(first);
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [clinicId, load]);

  // ── Alarm: flashing title + beep while an emergency is unanswered ──
  useEffect(() => {
    if (!emergencies.length) {
      document.title = "Mediflow Clinic";
      return;
    }
    let flip = false;
    const t = setInterval(() => {
      flip = !flip;
      document.title = flip ? `🚨 ${emergencies.length} EMERGENCY` : "Mediflow Clinic";
      if (soundOn && audio.current) {
        const ctx = audio.current;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = flip ? 880 : 660;
        gain.gain.value = 0.15;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      }
    }, 900);
    return () => clearInterval(t);
  }, [emergencies.length, soundOn]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  async function respond(id: string, action: "spoke_to_patient" | "doctor_assigned", doctor?: string) {
    try {
      await respondToEmergency(id, action, doctor);
      flash(action === "doctor_assigned" ? "Doctor assigned — alerts stopped ✅" : "Marked as spoke to patient — alerts stopped ✅");
      load();
    } catch {
      flash("Couldn't update — it may have been re-assigned to another clinic.");
      load();
    }
  }

  async function mark(id: string, status: "arrived" | "no_show" | "completed" | "cancelled") {
    try {
      await markAppointment(id, status);
      load();
    } catch {
      flash("Couldn't update the appointment.");
    }
  }

  if (state === "loading") {
    return <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">Loading clinic portal…</div>;
  }
  if (state === "not_member") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-sm text-center">
          <p className="font-semibold text-slate-800 mb-2">This account isn&apos;t linked to a clinic yet</p>
          <p className="text-sm text-slate-500 mb-4">Register your clinic (free) — find it on the map or add it, and bookings start appearing here.</p>
          <button onClick={() => router.push("/clinic/signup")} className="w-full bg-slate-900 text-white text-sm font-semibold py-2.5 rounded-xl mb-3">
            Register my clinic
          </button>
          <button
            onClick={async () => { await supabase.auth.signOut(); router.push("/clinic/login"); }}
            className="text-sm text-sky-600 font-medium"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-slate-900 text-white sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 bg-sky-500 rounded-lg flex items-center justify-center font-bold text-sm">M</div>
            <div className="min-w-0">
              <p className="font-semibold leading-tight truncate">{clinic?.name}</p>
              <p className="text-[11px] text-slate-400">Mediflow Clinic Portal</p>
            </div>
            {clinics.length > 1 && (
              <select value={clinicId} onChange={(e) => setClinicId(e.target.value)} className="ml-2 bg-slate-800 text-sm rounded-lg px-2 py-1 text-white">
                {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (!audio.current) audio.current = new AudioContext();
                setSoundOn((s) => !s);
              }}
              className={`text-xs px-3 py-1.5 rounded-lg ${soundOn ? "bg-red-600" : "bg-slate-700"}`}
            >
              {soundOn ? "🔔 Sound on" : "🔕 Enable sound alerts"}
            </button>
            <button onClick={async () => { await supabase.auth.signOut(); router.push("/clinic/login"); }} className="text-xs text-slate-300">
              Logout
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 py-5 space-y-5">
        {/* ── EMERGENCY BANNER ── */}
        {emergencies.map((e) => {
          const elapsed = Math.floor((now - new Date(e.assigned_at).getTime()) / 1000);
          const left = Math.max(0, REASSIGN_AFTER_S - elapsed);
          return (
            <EmergencyAlert
              key={e.id}
              e={e}
              left={left}
              doctors={doctors}
              onRespond={respond}
              onDispatched={(token) => {
                flash("Ambulance dispatched — share the driver link 🚑");
                load();
                return token;
              }}
              onMedipass={() => e.patient && setMedipass(e.patient)}
            />
          );
        })}

        {/* ── AMBULANCES EN ROUTE ── */}
        {enRoute.length > 0 && (
          <section className="bg-white rounded-2xl border border-sky-200 p-4">
            <h2 className="font-bold text-slate-800 mb-3">🚑 Ambulances in progress</h2>
            <div className="space-y-2">
              {enRoute.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border border-slate-100 rounded-xl p-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{c.ambulance_vehicle || "Ambulance"} · {c.case_type}</p>
                    <p className="text-xs text-slate-500">
                      {c.ambulance_driver_name || "Driver"} · {(c.ambulance_status || "dispatched").replace("_", " ")} ·{" "}
                      {c.ambulance_updated_at ? `GPS ${Math.round((now - new Date(c.ambulance_updated_at).getTime()) / 1000)}s ago` : "waiting for driver GPS"}
                    </p>
                  </div>
                  {c.ambulance_token && <DriverLinkButtons token={c.ambulance_token} phone={c.ambulance_driver_phone} />}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── TABS ── */}
        <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 w-fit">
          {([["appointments", "📅 Appointments"], ["doctors", "👨‍⚕️ Doctors"], ["settings", "⚙️ Clinic settings"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`text-sm px-3 py-1.5 rounded-lg ${tab === id ? "bg-slate-900 text-white font-semibold" : "text-slate-600"}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === "doctors" && <DoctorsManager clinicId={clinicId} onChange={load} />}
        {tab === "settings" && <ClinicSettings clinicId={clinicId} onSaved={flash} />}

        {/* ── APPOINTMENTS ── */}
        {tab === "appointments" && (
        <section className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="font-bold text-slate-800">
              Appointments{" "}
              <span className="text-sm font-normal text-slate-400">
                {appointments.filter((a) => a.status !== "cancelled").length} booked
              </span>
            </h2>
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1 overflow-x-auto max-w-full">
              {Array.from({ length: 7 }, (_, i) => {
                const iso = isoPlus(i);
                const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : new Date(iso + "T00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric" });
                return (
                  <button key={iso} onClick={() => setDate(iso)} className={`text-xs px-3 py-1.5 rounded-md whitespace-nowrap ${date === iso ? "bg-white shadow-sm font-semibold text-slate-800" : "text-slate-500"}`}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {appointments.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No appointments for this day yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                    <th className="py-2 pr-3">Time</th>
                    <th className="py-2 pr-3">Patient</th>
                    <th className="py-2 pr-3">Complaint</th>
                    <th className="py-2 pr-3">Doctor</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {appointments.map((a) => (
                    <tr key={a.id} className="border-b border-slate-50 align-top">
                      <td className="py-2.5 pr-3 font-semibold text-slate-800 whitespace-nowrap">
                        {a.appointment_time}
                        {a.priority && a.priority !== "normal" && (
                          <span className={`block text-[10px] font-bold uppercase ${a.priority === "emergency" ? "text-red-600" : "text-amber-600"}`}>{a.priority}</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <button onClick={() => a.patient && setMedipass(a.patient)} className="text-left">
                          <span className="font-medium text-slate-800 hover:text-sky-600">{a.patient?.name || "Patient"}</span>
                          <span className="block text-[11px] text-slate-400 font-mono">{a.patient?.patient_id || "—"}</span>
                        </button>
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-slate-600 max-w-[220px]">{a.symptoms || "—"}</td>
                      <td className="py-2.5 pr-3 text-xs text-slate-600">{a.doctor_name}</td>
                      <td className="py-2.5 pr-3">
                        <span className={`text-[11px] font-semibold px-2 py-1 rounded-full capitalize ${STATUS_STYLE[a.status] ?? STATUS_STYLE.confirmed}`}>
                          {a.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="py-2.5 whitespace-nowrap">
                        {a.status === "confirmed" && (
                          <div className="flex gap-1.5">
                            <button onClick={() => mark(a.id, "arrived")} className="text-xs px-2.5 py-1 rounded-lg bg-emerald-500 text-white">Arrived</button>
                            <button onClick={() => mark(a.id, "no_show")} className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600">No-show</button>
                            <button onClick={() => { if (confirm("Cancel this appointment? The patient will see it as cancelled.")) mark(a.id, "cancelled"); }}
                              className="text-xs px-2.5 py-1 rounded-lg border border-red-200 text-red-600">Cancel</button>
                          </div>
                        )}
                        {a.status === "arrived" && (
                          <button onClick={() => mark(a.id, "completed")} className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600">Mark done</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        )}
      </div>

      {medipass && <MediPassDrawer p={medipass} onClose={() => setMedipass(null)} />}
      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg z-50">{toast}</div>}
    </div>
  );
}

function EmergencyAlert({
  e,
  left,
  doctors,
  onRespond,
  onDispatched,
  onMedipass,
}: {
  e: ClinicEmergency;
  left: number;
  doctors: { id: string; name: string }[];
  onRespond: (id: string, action: "spoke_to_patient" | "doctor_assigned", doctor?: string) => void;
  onDispatched: (token: string) => string;
  onMedipass: () => void;
}) {
  const [doctor, setDoctor] = useState("");
  const [showDispatch, setShowDispatch] = useState(false);
  const [driver, setDriver] = useState({ name: "", phone: "", vehicle: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const p = e.patient;
  const age = ageFromDob(p?.dob);

  return (
    <section className="rounded-2xl border-2 border-red-500 bg-red-600 text-white shadow-lg overflow-hidden">
      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 bg-red-700 animate-pulse">
        <p className="font-bold text-lg">🚨 EMERGENCY CASE ASSIGNED — {e.case_type}</p>
        <p className="text-sm font-semibold">
          {left > 0 ? `Respond within ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} or it moves to the next clinic` : "Re-assigning now…"}
        </p>
      </div>
      <div className="p-4 grid md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <p className="text-xl font-bold">{p?.name || "Patient"}{age != null && <span className="text-sm font-normal text-white/85"> · {age} yrs</span>}</p>
          <p className="text-sm font-mono">{p?.patient_id || "—"}</p>
          {e.message && <p className="text-sm text-white/90">“{e.message}”</p>}
          <p className="text-sm text-white/90">📍 {e.area || "Location shared"}{e.distance_km != null && ` · ${e.distance_km} km away`}</p>
          {p?.blood_group && <p className="text-sm">🩸 {p.blood_group}{p.allergies && ` · Allergies: ${p.allergies}`}</p>}
          <div className="flex flex-wrap gap-2 pt-2">
            {p?.phone && <a href={`tel:${p.phone}`} className="text-xs font-semibold bg-white text-red-700 rounded-lg px-3 py-1.5">📞 Call patient</a>}
            {e.latitude != null && (
              <a href={`https://www.google.com/maps?q=${e.latitude},${e.longitude}`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold bg-white/15 rounded-lg px-3 py-1.5">
                🗺️ Patient location
              </a>
            )}
            <button onClick={onMedipass} className="text-xs font-semibold bg-white/15 rounded-lg px-3 py-1.5">🪪 MediPass</button>
          </div>
        </div>
        <div className="bg-white rounded-xl p-3 text-slate-800 space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Respond to stop the alerts</p>
          <button onClick={() => onRespond(e.id, "spoke_to_patient")} className="w-full bg-slate-800 text-white text-sm font-semibold py-2.5 rounded-lg">
            📞 Spoke to Patient
          </button>
          <div className="flex gap-2">
            <select value={doctor} onChange={(ev) => setDoctor(ev.target.value)} className="flex-1 border border-slate-200 rounded-lg px-2 text-sm text-slate-800 bg-white">
              <option value="">Choose doctor…</option>
              {doctors.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
            <button onClick={() => onRespond(e.id, "doctor_assigned", doctor || undefined)} className="bg-emerald-600 text-white text-sm font-semibold px-3 py-2.5 rounded-lg">
              👨‍⚕️ Doctor Assigned
            </button>
          </div>
          {!showDispatch ? (
            <button onClick={() => setShowDispatch(true)} className="w-full border-2 border-red-500 text-red-600 text-sm font-semibold py-2 rounded-lg">
              🚑 Dispatch Ambulance
            </button>
          ) : (
            <div className="border border-red-200 rounded-lg p-2 space-y-1.5">
              {(["name", "phone", "vehicle"] as const).map((k) => (
                <input
                  key={k}
                  value={driver[k]}
                  onChange={(ev) => setDriver({ ...driver, [k]: ev.target.value })}
                  placeholder={k === "name" ? "Driver name" : k === "phone" ? "Driver phone" : "Vehicle no. (e.g. KA01 AB 1234)"}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-800"
                />
              ))}
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const token = await dispatchAmbulance(e.id, driver.name, driver.phone, driver.vehicle);
                    onDispatched(token);
                  } catch {
                    setError("Couldn't dispatch — please try again.");
                  } finally {
                    setBusy(false);
                  }
                }}
                className="w-full bg-red-600 text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-50"
              >
                {busy ? "Dispatching…" : "Dispatch & get driver link"}
              </button>
              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function DriverLinkButtons({ token, phone }: { token: string; phone?: string | null }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin.replace("clinic.", "")}/driver/${token}` : "";
  const wa = phone
    ? `https://wa.me/${phone.replace(/\D/g, "").replace(/^(\d{10})$/, "91$1")}?text=${encodeURIComponent(`🚑 Mediflow emergency trip. Open this link and tap "Start sharing live location": ${url}`)}`
    : null;
  return (
    <div className="flex gap-2">
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="text-xs font-semibold border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700"
      >
        {copied ? "Copied ✓" : "Copy driver link"}
      </button>
      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold bg-emerald-500 text-white rounded-lg px-3 py-1.5">
          Send on WhatsApp
        </a>
      )}
    </div>
  );
}

function MediPassDrawer({ p, onClose }: { p: PatientCard; onClose: () => void }) {
  const age = ageFromDob(p.dob);
  const rows: [string, string | null | undefined][] = [
    ["Mediflow ID", p.patient_id],
    ["Phone", p.phone],
    ["Age / Gender", [age != null ? `${age} yrs` : null, p.gender].filter(Boolean).join(" · ") || null],
    ["Blood group", p.blood_group],
    ["Allergies", p.allergies],
    ["Conditions", p.conditions],
    ["Medications", p.medications],
    ["Address", p.address],
    ["Emergency contact", [p.emergency_contact_name, p.emergency_contact_phone].filter(Boolean).join(" · ") || null],
    ["Insurance", p.insurance_number],
  ];
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-sm h-full bg-white p-5 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <p className="font-bold text-slate-800">🪪 MediPass</p>
          <button onClick={onClose} className="text-slate-400 text-xl" aria-label="Close">×</button>
        </div>
        <p className="text-xl font-bold text-slate-800">{p.name}</p>
        <div className="mt-3 divide-y divide-slate-100">
          {rows.map(([k, v]) => (
            <div key={k} className="py-2 flex justify-between gap-3 text-sm">
              <span className="text-slate-500">{k}</span>
              <span className="text-right font-medium text-slate-800">{v || "—"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
