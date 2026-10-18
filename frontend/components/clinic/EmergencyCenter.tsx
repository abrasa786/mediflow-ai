"use client";

// Emergency Center — shown on every clinic portal page: red SOS banners (Realtime),
// sound + flashing title alarm, respond / doctor-assign / ambulance dispatch, ambulances en route.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ageFromDob, getActiveEmergencies, getClinicDoctors, respondToEmergency, type ClinicEmergency, type PatientCard } from "@/lib/clinic";
import { dispatchAmbulance, type EmergencyCase } from "@/lib/emergency";
import MediPassDrawer from "./MediPassDrawer";

const REASSIGN_AFTER_S = 180;

function useNow(everyMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

export default function EmergencyCenter({ clinicId, soundOn, flash }: { clinicId: string; soundOn: boolean; flash: (m: string) => void }) {
  const now = useNow();
  const [emergencies, setEmergencies] = useState<ClinicEmergency[]>([]);
  const [enRoute, setEnRoute] = useState<EmergencyCase[]>([]);
  const [doctors, setDoctors] = useState<{ id: string; name: string; speciality: string }[]>([]);
  const [medipass, setMedipass] = useState<PatientCard | null>(null);
  const audio = useRef<AudioContext | null>(null);

  const load = useCallback(async () => {
    const [ems, docs, route] = await Promise.all([
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
    setEmergencies(ems);
    setDoctors(docs);
    setEnRoute((route.data as EmergencyCase[]) ?? []);
  }, [clinicId]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const channel = supabase
      .channel(`clinic-sos-${clinicId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "emergency_cases", filter: `clinic_id=eq.${clinicId}` }, load)
      .subscribe();
    const poll = setInterval(load, 20000);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [clinicId, load]);

  // Alarm: flashing tab title + beep while an emergency is unanswered
  useEffect(() => {
    if (!emergencies.length) return;
    if (soundOn && !audio.current) audio.current = new AudioContext();
    let flip = false;
    const original = document.title;
    const t = setInterval(() => {
      flip = !flip;
      document.title = flip ? `🚨 ${emergencies.length} EMERGENCY` : original;
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
    return () => {
      clearInterval(t);
      document.title = original;
    };
  }, [emergencies.length, soundOn]);

  async function respond(id: string, action: "spoke_to_patient" | "doctor_assigned", doctor?: string) {
    try {
      await respondToEmergency(id, action, doctor);
      flash(action === "doctor_assigned" ? "Doctor assigned — alerts stopped ✅" : "Marked as spoke to patient — alerts stopped ✅");
    } catch {
      flash("Couldn't update — it may have been re-assigned to another clinic.");
    }
    load();
  }

  if (!emergencies.length && !enRoute.length) return null;

  return (
    <div className="space-y-4 mb-5">
      {emergencies.map((e) => {
        const elapsed = Math.floor((now - new Date(e.assigned_at).getTime()) / 1000);
        return (
          <EmergencyAlert
            key={e.id}
            e={e}
            left={Math.max(0, REASSIGN_AFTER_S - elapsed)}
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
      {medipass && <MediPassDrawer p={medipass} onClose={() => setMedipass(null)} />}
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
