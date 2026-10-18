"use client";

// Ambulance driver page — opened from the secret link the clinic sends.
// Streams the phone's GPS so the patient can track the ambulance live.

import { use, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { distanceKm, etaMinutes } from "@/lib/emergency";

const AmbulanceMap = dynamic(() => import("@/components/emergency/AmbulanceMap"), {
  ssr: false,
  loading: () => <div className="w-full h-56 rounded-xl bg-slate-100 animate-pulse" />,
});

type Job = {
  case_id: string;
  case_type: string;
  ambulance_status: string | null;
  patient_name: string | null;
  patient_phone: string | null;
  patient_lat: number | null;
  patient_lng: number | null;
  area: string | null;
  clinic_name: string | null;
  clinic_lat: number | null;
  clinic_lng: number | null;
  vehicle: string | null;
  driver: string | null;
};

const SEND_EVERY_MS = 4000;

export default function DriverPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [job, setJob] = useState<Job | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [me, setMe] = useState<[number, number] | null>(null);
  const [lastSent, setLastSent] = useState<Date | null>(null);
  const [gpsError, setGpsError] = useState("");
  const watchId = useRef<number | null>(null);
  const lastSentAt = useRef(0);
  const wakeLock = useRef<WakeLockSentinel | null>(null);

  const loadJob = useCallback(async () => {
    const { data } = await supabase.rpc("get_ambulance_job", { p_token: token });
    if (!data) setNotFound(true);
    else setJob(data as Job);
  }, [token]);

  useEffect(() => {
    const t = setTimeout(loadJob, 0);
    return () => {
      clearTimeout(t);
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
      wakeLock.current?.release().catch(() => {});
    };
  }, [loadJob]);

  async function startSharing() {
    setGpsError("");
    if (!navigator.geolocation) return setGpsError("This phone can't share location.");
    try {
      wakeLock.current = await navigator.wakeLock?.request("screen"); // keep the screen on
    } catch {}
    watchId.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const pt: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setMe(pt);
        if (Date.now() - lastSentAt.current < SEND_EVERY_MS) return;
        lastSentAt.current = Date.now();
        const speed = pos.coords.speed != null ? Math.round(pos.coords.speed * 3.6) : null;
        const { data, error } = await supabase.rpc("update_ambulance_location", {
          p_token: token,
          p_lat: pt[0],
          p_lng: pt[1],
          p_speed_kmh: speed,
        });
        if (!error && data) setLastSent(new Date());
      },
      (err) => setGpsError(err.code === err.PERMISSION_DENIED ? "Please allow location access to share the ambulance position." : "GPS signal lost — retrying…"),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
    setSharing(true);
  }

  async function setStatus(status: "arrived_patient" | "to_hospital" | "completed") {
    await supabase.rpc("ambulance_set_status", { p_token: token, p_status: status });
    if (status === "completed") {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
      setSharing(false);
    }
    loadJob();
  }

  if (notFound) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-50 px-6 text-center">
        <p className="text-slate-600 text-sm">This trip link has expired or the trip is complete. Ask the clinic for a new link.</p>
      </div>
    );
  }
  if (!job) {
    return <div className="min-h-[100dvh] flex items-center justify-center bg-slate-50 text-sm text-slate-500">Loading trip…</div>;
  }

  const patientPt: [number, number] | null = job.patient_lat != null ? [job.patient_lat, job.patient_lng!] : null;
  const clinicPt: [number, number] | null = job.clinic_lat != null ? [job.clinic_lat, job.clinic_lng!] : null;
  const km = me && patientPt ? distanceKm(me, patientPt) : null;
  const navTarget = job.ambulance_status === "to_hospital" ? clinicPt : patientPt;

  return (
    <div className="min-h-[100dvh] bg-slate-50">
      <nav className="bg-red-600 text-white px-4 py-3">
        <p className="font-bold">🚑 Mediflow Ambulance Trip</p>
        <p className="text-xs text-white/85">{job.vehicle || "Ambulance"}{job.driver && ` · ${job.driver}`}</p>
      </nav>
      <div className="max-w-md mx-auto px-4 py-4 space-y-3">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">Patient · {job.case_type}</p>
          <p className="font-semibold text-slate-800">{job.patient_name || "Patient"}</p>
          <p className="text-xs text-slate-500">📍 {job.area || "Location shared"}{km != null && ` · ${km.toFixed(1)} km · ~${etaMinutes(km)} min`}</p>
          <div className="grid grid-cols-2 gap-2 mt-3">
            {job.patient_phone && (
              <a href={`tel:${job.patient_phone}`} className="text-center text-sm font-semibold border border-slate-200 rounded-xl py-2 text-slate-700">📞 Call patient</a>
            )}
            {navTarget && (
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${navTarget[0]},${navTarget[1]}&travelmode=driving`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-center text-sm font-semibold bg-sky-500 text-white rounded-xl py-2"
              >
                🧭 Navigate
              </a>
            )}
          </div>
        </div>

        <AmbulanceMap patient={patientPt} ambulance={me} clinic={clinicPt} />

        {!sharing ? (
          <button onClick={startSharing} className="w-full bg-red-600 text-white font-bold py-4 rounded-2xl text-base shadow">
            ▶ Start sharing live location
          </button>
        ) : (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-sm text-emerald-800">
            ● Sharing live location{lastSent && ` · last sent ${lastSent.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`}
            <p className="text-xs text-emerald-700 mt-0.5">Keep this page open during the trip.</p>
          </div>
        )}
        {gpsError && <p className="text-sm text-red-600">{gpsError}</p>}

        <div className="grid grid-cols-3 gap-2">
          <button onClick={() => setStatus("arrived_patient")} className="bg-white border border-slate-200 rounded-xl py-2.5 text-xs font-semibold text-slate-700">Reached patient</button>
          <button onClick={() => setStatus("to_hospital")} className="bg-white border border-slate-200 rounded-xl py-2.5 text-xs font-semibold text-slate-700">To hospital</button>
          <button onClick={() => setStatus("completed")} className="bg-white border border-slate-200 rounded-xl py-2.5 text-xs font-semibold text-slate-700">Trip complete</button>
        </div>
        {job.ambulance_status && job.ambulance_status !== "dispatched" && (
          <p className="text-center text-xs text-slate-500">Current status: {job.ambulance_status.replace("_", " ")}</p>
        )}
      </div>
    </div>
  );
}
