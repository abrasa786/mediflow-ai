"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLocation } from "@/hooks/useLocation";
import { findActiveEmergency, triggerEmergency } from "@/lib/emergency";

const HOLD_MS = 2000;

export default function SosPage() {
  const router = useRouter();
  const { location, requestLocation } = useLocation({ auto: true });
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [activeCase, setActiveCase] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const holdStart = useRef<number | null>(null);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setSignedIn(!!user);
      if (user) setActiveCase(await findActiveEmergency(user.id).catch(() => null));
    })();
  }, []);

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

  return (
    <div className="min-h-[100dvh] bg-red-50 flex flex-col">
      <nav className="bg-red-600 text-white px-4 py-3 flex items-center gap-3">
        <Link href="/home" className="text-xl" aria-label="Back">←</Link>
        <span className="font-bold text-lg">Emergency SOS</span>
      </nav>

      <div className="flex-1 max-w-md w-full mx-auto px-4 py-6 flex flex-col items-center text-center gap-5">
        {activeCase && (
          <Link href={`/emergency/${activeCase}`} className="w-full bg-white border border-red-200 rounded-2xl p-4 text-sm font-semibold text-red-700">
            🚨 You have an active emergency — open live status →
          </Link>
        )}

        {signedIn === false ? (
          <div className="bg-white rounded-2xl p-5 border border-red-100 w-full">
            <p className="text-sm text-slate-700 mb-3">Log in so Mediflow can alert the nearest clinic and your emergency contact automatically.</p>
            <Link href="/login" className="inline-block bg-red-600 text-white text-sm font-semibold px-5 py-2.5 rounded-xl">Log in</Link>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-700">
              Press and hold for 2 seconds. We&apos;ll alert the nearest emergency-ready clinic and your emergency contact — no other steps.
            </p>
            <button
              onPointerDown={startHold}
              onPointerUp={endHold}
              onPointerLeave={endHold}
              onContextMenu={(e) => e.preventDefault()}
              disabled={sending || signedIn === null}
              aria-label="Hold for 2 seconds to send SOS"
              className="relative w-52 h-52 rounded-full bg-red-600 text-white shadow-xl select-none touch-none active:scale-95 transition-transform disabled:opacity-70"
              style={{ background: `conic-gradient(#7f1d1d ${progress * 360}deg, #dc2626 0deg)` }}
            >
              <span className="absolute inset-3 rounded-full bg-red-600 flex flex-col items-center justify-center">
                <span className="text-4xl font-black tracking-wider">SOS</span>
                <span className="text-xs mt-1 text-white/90">{sending ? "Sending…" : progress > 0 ? "Keep holding…" : "Hold 2 sec"}</span>
              </span>
            </button>
            <p className="text-xs text-slate-500">
              {location ? `📍 Using your location: ${location.area}` : "📍 Location helps us find the nearest clinic"}
            </p>
          </>
        )}

        {error && <p className="text-sm font-semibold text-red-700">{error}</p>}

        <div className="w-full">
          <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">Or call directly</p>
          <div className="grid grid-cols-3 gap-2">
            {[["112", "Emergency"], ["108", "Ambulance"], ["102", "Maternity"]].map(([n, h]) => (
              <a key={n} href={`tel:${n}`} className="rounded-xl bg-white border border-red-200 py-3">
                <span className="block text-lg font-bold text-red-600">📞 {n}</span>
                <span className="block text-[11px] text-slate-500">{h}</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
