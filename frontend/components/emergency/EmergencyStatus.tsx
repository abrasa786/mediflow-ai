"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { cancelEmergency, distanceKm, etaMinutes, useEmergencyCase, type EmergencyCase, type EmergencyEvent } from "@/lib/emergency";

const AmbulanceMap = dynamic(() => import("./AmbulanceMap"), {
  ssr: false,
  loading: () => <div className="w-full h-56 rounded-xl bg-slate-100 animate-pulse" />,
});

const NUMBERS = [
  { label: "112", hint: "Emergency" },
  { label: "108", hint: "Ambulance" },
  { label: "102", hint: "Maternity / Ambulance" },
];

const MENTAL_HEALTH = [
  { label: "14416", hint: "Tele-MANAS (24×7)" },
  { label: "18005990019", hint: "KIRAN helpline" },
];

type Step = { label: string; state: "done" | "active" | "todo" };

function steps(ec: EmergencyCase, events: EmergencyEvent[]): Step[] {
  const status = ec.status;
  const notified = events.some((e) => e.kind === "whatsapp_clinic" || e.kind === "assigned" || e.kind === "reassigned");
  const ambulance = status === "ambulance_dispatched";
  const responded = status === "spoke_to_patient" || status === "doctor_assigned" || ambulance;
  const s = (done: boolean, active = false): Step["state"] => (done ? "done" : active ? "active" : "todo");
  if (ambulance) {
    const reached = ec.ambulance_status && ec.ambulance_status !== "dispatched";
    return [
      { label: "Case created", state: "done" },
      { label: "Clinic confirmed", state: "done" },
      { label: "Ambulance dispatched", state: "done" },
      { label: "On the way", state: s(!!reached, !reached) },
      { label: "Reached you", state: s(!!reached) },
    ];
  }
  return [
    { label: "Case created", state: "done" },
    { label: "Clinic notified", state: s(notified || responded, status === "assigned") },
    { label: "Awaiting confirmation", state: s(responded, status === "assigned" && notified) },
    { label: status === "spoke_to_patient" ? "Clinic spoke to you" : "Doctor assigned", state: s(responded) },
    { label: "You're expected", state: s(responded) },
  ];
}

/** Current time, re-rendering every few seconds (keeps "x s ago" labels fresh and render pure). */
function useNow(everyMs = 5000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

function timeAgo(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}

export default function EmergencyStatus({
  caseId,
  patientId,
  compact = false,
}: {
  caseId: string;
  patientId?: string | null;
  compact?: boolean;
}) {
  const { ec, clinic, events, error, reload } = useEmergencyCase(caseId);
  const now = useNow();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
        {error}
        <NumberGrid mental={false} />
      </div>
    );
  }
  if (!ec) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700 flex items-center gap-2">
        <span className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /> Creating your emergency case…
      </div>
    );
  }

  const active = ec.status === "assigned" || ec.status === "unassigned";
  const latest = [...events].reverse().find((e) =>
    ["reassigned", "no_clinic", "doctor_assigned", "spoke_to_patient", "assigned", "ambulance_dispatched",
     "ambulance_arrived_patient", "ambulance_to_hospital", "ambulance_completed"].includes(e.kind)
  );
  const ambulance = ec.status === "ambulance_dispatched";
  const testMode = events.some((e) => e.data?.mode === "test_mode");
  const mental = ec.case_type === "Mental health crisis";
  const directions =
    clinic?.latitude != null ? `https://www.google.com/maps/dir/?api=1&destination=${clinic.latitude},${clinic.longitude}` : null;

  return (
    <div className="bg-white border border-red-200 rounded-2xl overflow-hidden shadow-sm w-full">
      {/* Header */}
      <div className={`px-4 py-3 text-white ${ec.status === "cancelled" ? "bg-slate-500" : active ? "bg-red-600" : ambulance ? "bg-sky-600" : "bg-emerald-600"}`}>
        <div className="flex items-center gap-2">
          {active && <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping" />}
          <p className="font-semibold text-sm">
            {ec.status === "cancelled"
              ? "Emergency cancelled — glad you're safe"
              : active
              ? `🚨 Emergency SOS · ${ec.case_type}`
              : ambulance
              ? "🚑 Ambulance on the way"
              : "✅ Help is confirmed"}
          </p>
        </div>
        {latest && <p className="text-xs text-white/90 mt-0.5">{latest.message}</p>}
      </div>

      {/* Status strip */}
      {ec.status !== "cancelled" && (
        <div className="px-4 pt-3">
          <ol className="flex items-start gap-1">
            {steps(ec, events).map((st, i) => (
              <li key={i} className="flex-1 flex flex-col items-center text-center">
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
                    st.state === "done" ? "bg-emerald-500 text-white" : st.state === "active" ? "bg-amber-400 text-white animate-pulse" : "bg-slate-200 text-slate-500"
                  }`}
                >
                  {st.state === "done" ? "✓" : i + 1}
                </span>
                <span className="text-[10px] leading-tight text-slate-600 mt-1">{st.label}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Live ambulance tracking */}
      {ambulance && <AmbulanceTracker ec={ec} now={now} clinicPt={clinic?.latitude != null ? [clinic.latitude, clinic.longitude!] : null} />}

      {/* Clinic */}
      {clinic && ec.status !== "cancelled" && (
        <div className="mx-4 mt-3 rounded-xl bg-slate-50 px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Assigned clinic</p>
          <p className="text-sm font-semibold text-slate-800">🏥 {clinic.name}</p>
          <p className="text-xs text-slate-500">
            📍 {clinic.address || clinic.area}
            {ec.distance_km != null && ` · ${ec.distance_km} km away`}
          </p>
          {ec.doctor_name && <p className="text-xs text-emerald-700 font-medium mt-1">👨‍⚕️ {ec.doctor_name} is ready for you</p>}
          <div className="flex gap-2 mt-2">
            <a href={`tel:${clinic.phone}`} className="flex-1 text-center text-xs font-semibold border border-slate-200 bg-white rounded-lg py-1.5 text-slate-700">📞 Call clinic</a>
            {directions && (
              <a href={directions} target="_blank" rel="noopener noreferrer" className="flex-1 text-center text-xs font-semibold border border-slate-200 bg-white rounded-lg py-1.5 text-slate-700">
                🗺️ Directions
              </a>
            )}
          </div>
        </div>
      )}
      {ec.status === "unassigned" && (
        <p className="mx-4 mt-3 text-sm font-semibold text-red-700 bg-red-50 rounded-xl px-3 py-2">
          No clinic has confirmed yet — please call 108 for an ambulance now.
        </p>
      )}

      {/* Mediflow ID */}
      {patientId && ec.status !== "cancelled" && (
        <div className="mx-4 mt-3 text-center rounded-xl border border-dashed border-slate-300 py-2">
          <p className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Show at reception</p>
          <p className="text-2xl font-bold tracking-widest text-slate-800">{patientId}</p>
        </div>
      )}

      {/* Backup numbers */}
      <div className="px-4 pt-3">
        <NumberGrid mental={mental} />
      </div>

      {/* Timeline */}
      {!compact && events.length > 0 && (
        <div className="px-4 pt-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-1">What&apos;s happening</p>
          <ul className="space-y-1">
            {[...events].reverse().slice(0, 8).map((e) => (
              <li key={e.id} className="text-xs text-slate-600 flex justify-between gap-3">
                <span>
                  {e.message}
                  {e.data?.mode === "test_mode" && <span className="text-amber-600"> (test mode)</span>}
                </span>
                <span className="text-slate-400 flex-shrink-0">{timeAgo(e.created_at, now)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {testMode && (
        <p className="mx-4 mt-2 text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5">
          WhatsApp / call alerts are in test mode until Twilio is configured — the clinic dashboard still flashes in real time.
        </p>
      )}

      {/* Footer actions */}
      <div className="px-4 py-3 mt-2 border-t border-slate-100 flex items-center justify-between gap-2">
        {compact ? (
          <Link href={`/emergency/${ec.id}`} className="text-xs font-semibold text-red-600">Open live status ↗</Link>
        ) : (
          <button onClick={reload} className="text-xs text-slate-500">↻ Refresh</button>
        )}
        {active &&
          (confirmCancel ? (
            <div className="flex gap-2">
              <button
                disabled={cancelling}
                onClick={async () => {
                  setCancelling(true);
                  try {
                    await cancelEmergency(ec.id);
                  } finally {
                    setCancelling(false);
                    setConfirmCancel(false);
                    reload();
                  }
                }}
                className="text-xs font-semibold bg-slate-800 text-white rounded-lg px-3 py-1.5 disabled:opacity-50"
              >
                {cancelling ? "Cancelling…" : "Yes, I'm safe"}
              </button>
              <button onClick={() => setConfirmCancel(false)} className="text-xs text-slate-500 px-2">Keep alert on</button>
            </div>
          ) : (
            <button onClick={() => setConfirmCancel(true)} className="text-xs text-slate-500 underline">I&apos;m safe — cancel alert</button>
          ))}
      </div>
    </div>
  );
}

function NumberGrid({ mental }: { mental: boolean }) {
  const list = mental ? [...MENTAL_HEALTH, NUMBERS[0]] : NUMBERS;
  return (
    <div className="grid grid-cols-3 gap-2">
      {list.map((n) => (
        <a key={n.label} href={`tel:${n.label}`} className="text-center rounded-xl bg-red-600 hover:bg-red-700 text-white py-2">
          <span className="block text-sm font-bold">📞 {n.label}</span>
          <span className="block text-[10px] text-white/85">{n.hint}</span>
        </a>
      ))}
    </div>
  );
}

function AmbulanceTracker({ ec, clinicPt, now }: { ec: EmergencyCase; clinicPt: [number, number] | null; now: number }) {
  const patientPt: [number, number] | null = ec.latitude != null && ec.longitude != null ? [ec.latitude, ec.longitude] : null;
  const ambPt: [number, number] | null = ec.ambulance_lat != null && ec.ambulance_lng != null ? [ec.ambulance_lat, ec.ambulance_lng] : null;
  const km = ambPt && patientPt ? distanceKm(ambPt, patientPt) : null;
  const reached = ec.ambulance_status === "arrived_patient" || ec.ambulance_status === "to_hospital" || ec.ambulance_status === "completed";
  const stale = ec.ambulance_updated_at ? now - new Date(ec.ambulance_updated_at).getTime() > 60000 : false;

  return (
    <div className="mx-4 mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-800">🚑 {ec.ambulance_vehicle || "Ambulance"}</p>
          <p className="text-xs text-slate-600">
            {ec.ambulance_driver_name ? `Driver: ${ec.ambulance_driver_name}` : "Driver assigned"}
          </p>
        </div>
        <div className="text-right">
          {reached ? (
            <p className="text-sm font-bold text-emerald-700">
              {ec.ambulance_status === "arrived_patient" ? "Reached you" : ec.ambulance_status === "to_hospital" ? "To hospital" : "Completed"}
            </p>
          ) : km != null ? (
            <>
              <p className="text-lg font-bold text-sky-700 leading-none">~{etaMinutes(km, ec.ambulance_speed_kmh)} min</p>
              <p className="text-[11px] text-slate-500">{km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`} away</p>
            </>
          ) : (
            <p className="text-xs text-slate-500">Waiting for live GPS…</p>
          )}
        </div>
      </div>
      <AmbulanceMap patient={patientPt} ambulance={ambPt} clinic={clinicPt} />
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[11px] ${stale ? "text-amber-700" : "text-slate-500"}`}>
          {ec.ambulance_updated_at
            ? stale
              ? "⚠️ GPS signal delayed — last update over a minute ago"
              : `● Live · updated ${timeAgo(ec.ambulance_updated_at, now)}`
            : "Location appears once the driver starts the trip"}
        </span>
        {ec.ambulance_driver_phone && (
          <a href={`tel:${ec.ambulance_driver_phone}`} className="text-xs font-semibold bg-white border border-sky-200 rounded-lg px-3 py-1.5 text-sky-700">
            📞 Call driver
          </a>
        )}
      </div>
    </div>
  );
}
