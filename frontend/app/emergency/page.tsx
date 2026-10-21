"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLocation } from "@/hooks/useLocation";
import { findActiveEmergency, triggerEmergency } from "@/lib/emergency";
import { directionsUrl, getNearbyPlaces, telHref, type Place } from "@/lib/places";

const HOLD_MS = 2000;

export default function SosPage() {
  const router = useRouter();
  const { location, requestLocation } = useLocation({ auto: true });
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [activeCase, setActiveCase] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [hospitals, setHospitals] = useState<Place[] | null>(null);
  const holdStart = useRef<number | null>(null);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setSignedIn(!!user);
      if (user) setActiveCase(await findActiveEmergency(user.id).catch(() => null));
    })();
  }, []);

  // Nearest real hospitals from the map — shown as a backup to the SOS
  useEffect(() => {
    if (!location || !signedIn) return;
    getNearbyPlaces(location.lat, location.lng, { radiusKm: 10 })
      .then((r) => setHospitals(r.places.filter((p) => p.kind === "hospital").slice(0, 4)))
      .catch(() => setHospitals([]));
  }, [location, signedIn]);

  async function fire() {
    setSending(true);
    setError("");
    try {
      const loc = location ?? (await requestLocation());
      const id = await triggerEmergency("SOS button", "Patient pressed the SOS button", loc);
      router.push(`/emergency/${id}`);
    } catch {
      setError("Couldn't create the emergency case. Please call 112 or 108 right now.");
      setSending(false);
      setProgress(0);
    }
  }

  function tick() {
    if (holdStart.current == null) return;
    const p = Math.min(1, (performance.now() - holdStart.current) / HOLD_MS);
    setProgress(p);
    if (p >= 1) {
      holdStart.current = null;
      fire();
      return;
    }
    raf.current = requestAnimationFrame(tick);
  }

  function startHold() {
    if (sending) return;
    holdStart.current = performance.now();
    raf.current = requestAnimationFrame(tick);
  }

  function endHold() {
    if (sending) return;
    holdStart.current = null;
    if (raf.current) cancelAnimationFrame(raf.current);
    setProgress(0);
  }

  const RING = 2 * Math.PI * 47; // progress ring circumference (r = 47 in a 100 × 100 viewBox)
  const holding = progress > 0 && !sending;

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex flex-col">
      {/* ── Hero ── */}
      <div className="relative overflow-hidden bg-gradient-to-b from-red-700 via-red-600 to-rose-600 text-white pb-10 rounded-b-[2rem] shadow-lg">
        <div className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-28 -left-20 w-72 h-72 rounded-full bg-black/10 blur-2xl" />

        <nav className="relative max-w-md mx-auto px-4 pt-4 flex items-center justify-between">
          <Link
            href="/home"
            aria-label="Back"
            className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-lg transition-colors"
          >
            ←
          </Link>
          <span className="font-semibold tracking-wide">Emergency SOS</span>
          <span className="w-9" />
        </nav>

        <div className="relative max-w-md mx-auto px-6 pt-6 flex flex-col items-center text-center">
          {activeCase && (
            <Link
              href={`/emergency/${activeCase}`}
              className="mb-6 w-full flex items-center gap-3 bg-white text-red-700 rounded-2xl px-4 py-3 shadow-md text-left"
            >
              <span className="relative flex w-3 h-3 flex-shrink-0">
                <span className="absolute inset-0 rounded-full bg-red-500 animate-ping" />
                <span className="relative w-3 h-3 rounded-full bg-red-600" />
              </span>
              <span className="flex-1 text-sm font-semibold">You have an active emergency</span>
              <span className="text-xs font-semibold">Live status →</span>
            </Link>
          )}

          {signedIn === false ? (
            <div className="w-full bg-white/10 backdrop-blur rounded-2xl p-5 border border-white/20">
              <div className="text-4xl mb-2">🔐</div>
              <p className="text-sm text-white/90 mb-4">
                Log in so Mediflow can alert the nearest clinic and your emergency contact automatically.
              </p>
              <Link href="/login" className="inline-block bg-white text-red-700 text-sm font-bold px-6 py-2.5 rounded-xl shadow">
                Log in
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold">Need help right now?</h1>
              <p className="text-sm text-white/85 mt-1.5 max-w-xs">
                Press and hold the button for 2 seconds. We&apos;ll alert help for you.
              </p>

              <div className="relative mt-8 w-60 h-60 flex items-center justify-center">
                {/* Pulse rings */}
                {!sending && (
                  <>
                    <span className="absolute inset-0 rounded-full bg-white/10 animate-ping [animation-duration:2.2s]" />
                    <span className="absolute inset-5 rounded-full bg-white/10" />
                  </>
                )}
                {/* Hold progress */}
                <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
                  <circle cx="50" cy="50" r="47" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="3" />
                  <circle
                    cx="50"
                    cy="50"
                    r="47"
                    fill="none"
                    stroke="white"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={RING}
                    strokeDashoffset={RING * (1 - (sending ? 1 : progress))}
                  />
                </svg>
                <button
                  onPointerDown={startHold}
                  onPointerUp={endHold}
                  onPointerLeave={endHold}
                  onContextMenu={(e) => e.preventDefault()}
                  disabled={sending || signedIn === null}
                  aria-label="Hold for 2 seconds to send SOS"
                  className={`relative w-44 h-44 rounded-full bg-gradient-to-br from-white to-red-50 text-red-600 shadow-[0_12px_40px_rgba(0,0,0,0.35)] select-none touch-none transition-transform duration-150 disabled:opacity-80 ${
                    holding ? "scale-95" : "hover:scale-[1.02]"
                  }`}
                >
                  <span className="flex flex-col items-center justify-center">
                    <span className="text-5xl font-black tracking-widest">SOS</span>
                    <span className="text-xs font-semibold mt-1.5 text-red-500">
                      {sending ? "Sending alert…" : holding ? `Keep holding… ${Math.ceil((1 - progress) * 2)}s` : "Hold 2 seconds"}
                    </span>
                  </span>
                </button>
              </div>

              <p className="mt-6 inline-flex items-center gap-1.5 text-xs bg-black/15 rounded-full px-3 py-1.5">
                📍 {location ? `Using your location · ${location.area}` : "Turn on location so we find the nearest clinic"}
              </p>
            </>
          )}

          {error && (
            <p className="mt-4 w-full text-sm font-semibold bg-white text-red-700 rounded-xl px-4 py-3">{error}</p>
          )}
        </div>
      </div>

      {/* ── Below the fold ── */}
      <div className="flex-1 max-w-md w-full mx-auto px-4 -mt-5 pb-8 space-y-5">
        {signedIn !== false && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
            <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-3">What happens when you press SOS</p>
            <ol className="grid grid-cols-3 gap-2 text-center">
              {[
                ["🏥", "Nearest clinic alerted"],
                ["👨‍👩‍👧", "Emergency contact notified"],
                ["📡", "Live status for you"],
              ].map(([icon, text], i) => (
                <li key={text} className="flex flex-col items-center gap-1.5">
                  <span className="relative w-10 h-10 rounded-full bg-red-50 flex items-center justify-center text-lg">
                    {icon}
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                  </span>
                  <span className="text-[11px] leading-tight text-slate-600">{text}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <section>
          <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2 px-1">Or call directly</p>
          <div className="grid grid-cols-3 gap-2.5">
            {[
              ["112", "Emergency", "🚨"],
              ["108", "Ambulance", "🚑"],
              ["102", "Maternity", "🤰"],
            ].map(([n, label, icon]) => (
              <a
                key={n}
                href={`tel:${n}`}
                className="group bg-white rounded-2xl border border-slate-100 shadow-sm py-3.5 flex flex-col items-center hover:border-red-200 hover:shadow-md transition-all"
              >
                <span className="text-xl">{icon}</span>
                <span className="text-xl font-bold text-slate-800 group-hover:text-red-600 mt-1">{n}</span>
                <span className="text-[11px] text-slate-500">{label}</span>
              </a>
            ))}
          </div>
        </section>

        {hospitals && hospitals.length > 0 && (
          <section>
            <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2 px-1">Nearest hospitals</p>
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-100">
              {hospitals.map((h) => (
                <div key={h.key} className="px-3.5 py-3 flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-red-50 text-lg flex items-center justify-center flex-shrink-0">🏥</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800 truncate">{h.name}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {h.distance_km != null && <span className="font-medium text-slate-600">{h.distance_km} km · </span>}
                      {h.area || h.address}
                    </p>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    {h.phone && (
                      <a
                        href={telHref(h.phone)}
                        aria-label={`Call ${h.name}`}
                        className="w-9 h-9 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center text-sm transition-colors"
                      >
                        📞
                      </a>
                    )}
                    <a
                      href={directionsUrl(h)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Directions to ${h.name}`}
                      className="w-9 h-9 rounded-full border border-slate-200 hover:border-red-200 hover:bg-red-50 flex items-center justify-center text-sm transition-colors"
                    >
                      🧭
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
