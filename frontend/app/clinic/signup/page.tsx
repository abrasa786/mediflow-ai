"use client";

// Self-serve clinic sign-up: create a login → find your clinic on the map (or add it) → details → portal.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLocation } from "@/hooks/useLocation";
import { ensureClinicId, getNearbyPlaces, searchPlaces, type Place } from "@/lib/places";
import { getMyClinics, registerClinic } from "@/lib/clinic";
import ClinicProfileForm, { CLINIC_SPECIALITIES, EMPTY_CLINIC, type ClinicFormValues } from "@/components/clinic/ClinicProfileForm";

type Step = "loading" | "account" | "confirm_email" | "find" | "details";
const input = "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400";

export default function ClinicSignup() {
  const router = useRouter();
  const { location, requestLocation, status: locStatus } = useLocation();
  const [step, setStep] = useState<Step>("loading");
  const [account, setAccount] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Place | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return setStep("account");
      if ((await getMyClinics()).length) return router.push("/clinic");
      setStep("find");
    })();
  }, [router]);

  // Clinics near the person signing up (usually at the clinic)
  useEffect(() => {
    if (step !== "find" || !location || query) return;
    let stale = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearching(true);
    getNearbyPlaces(location.lat, location.lng, { radiusKm: 2 })
      .then((r) => { if (!stale) setResults(r.places.slice(0, 25)); })
      .catch(() => {})
      .finally(() => { if (!stale) setSearching(false); });
    return () => { stale = true; };
  }, [step, location, query]);

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (account.password.length < 8) return setError("Use at least 8 characters for the password.");
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: account.email.trim(),
      password: account.password,
      options: { data: { name: account.name.trim(), role: "clinic" }, emailRedirectTo: `${window.location.origin}/clinic/signup` },
    });
    setBusy(false);
    if (error) return setError(error.message);
    setStep(data.session ? "find" : "confirm_email");
  }

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    setError("");
    try {
      setResults((await searchPlaces(query.trim(), location)).places);
    } catch {
      setError("Map search failed — please try again.");
    } finally {
      setSearching(false);
    }
  }

  function initialFrom(p: Place | null): ClinicFormValues {
    if (!p) return { ...EMPTY_CLINIC, lat: location?.lat ?? null, lng: location?.lng ?? null, area: location?.area ?? "", city: location?.city ?? "" };
    return {
      ...EMPTY_CLINIC,
      name: p.name,
      phone: p.phone,
      address: p.address,
      area: p.area,
      city: p.city,
      lat: p.lat,
      lng: p.lng,
      specialities: p.kind === "hospital" ? CLINIC_SPECIALITIES.slice(0, 4) : p.specialities,
      fee: p.fee,
      open: p.open_time ?? EMPTY_CLINIC.open,
      close: p.close_time && p.close_time > (p.open_time ?? "") ? p.close_time : EMPTY_CLINIC.close,
      emergency: p.kind === "hospital",
    };
  }

  async function register(v: ClinicFormValues) {
    const clinicId = picked && !picked.on_mediflow ? await ensureClinicId(picked) : null;
    await registerClinic({
      clinicId,
      name: v.name.trim(),
      phone: v.phone.trim(),
      whatsapp: v.whatsapp.trim(),
      address: v.address,
      area: v.area,
      city: v.city,
      lat: v.lat!,
      lng: v.lng!,
      specialities: v.specialities,
      fee: v.fee,
      open: v.open,
      close: v.close,
      days: v.days,
      emergency: v.emergency,
    });
    router.push("/clinic?welcome=1");
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-start sm:items-center justify-center px-4 py-8">
      <div className="bg-white rounded-2xl w-full max-w-xl p-6 sm:p-8">
        <div className="text-center mb-5">
          <div className="w-10 h-10 bg-sky-500 rounded-xl mx-auto flex items-center justify-center text-white font-bold">M</div>
          <p className="font-bold text-slate-800 mt-2">Put your clinic on Mediflow</p>
          <p className="text-xs text-slate-500">Free · patients nearby book you directly · bookings appear live in your portal</p>
        </div>

        {step === "loading" && <p className="text-center text-sm text-slate-400 py-8">Loading…</p>}

        {step === "account" && (
          <form onSubmit={createAccount} className="space-y-3">
            <p className="text-sm font-semibold text-slate-700">1 · Create your clinic login</p>
            {error && <p className="bg-red-50 text-red-600 text-sm px-3 py-2 rounded-lg">{error}</p>}
            <input className={input} required placeholder="Your name (owner / manager)" value={account.name} onChange={(e) => setAccount({ ...account, name: e.target.value })} />
            <input className={input} required type="email" placeholder="clinic@email.com" value={account.email} onChange={(e) => setAccount({ ...account, email: e.target.value })} />
            <input className={input} required type="password" placeholder="Password (8+ characters)" value={account.password} onChange={(e) => setAccount({ ...account, password: e.target.value })} />
            <button disabled={busy} className="w-full bg-slate-900 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50">
              {busy ? "Creating…" : "Continue"}
            </button>
            <p className="text-center text-xs text-slate-500">
              Already registered? <Link href="/clinic/login" className="text-sky-600 font-medium">Sign in</Link>
            </p>
          </form>
        )}

        {step === "confirm_email" && (
          <div className="text-center space-y-3 py-4">
            <p className="text-3xl">📧</p>
            <p className="text-sm text-slate-700">We sent a confirmation link to <strong>{account.email}</strong>.</p>
            <p className="text-xs text-slate-500">Open it on this device — you&apos;ll come straight back here to add your clinic.</p>
            <Link href="/clinic/login?next=/clinic/signup" className="inline-block text-sm text-sky-600 font-medium">Already confirmed? Sign in →</Link>
          </div>
        )}

        {step === "find" && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-700">2 · Find your clinic on the map</p>
            <p className="text-xs text-slate-500">Claiming your existing map listing keeps any bookings patients already made with you.</p>
            <form onSubmit={search} className="flex gap-2">
              <input className={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Clinic name, e.g. Sunrise Clinic Indiranagar" />
              <button className="bg-slate-900 text-white text-sm font-semibold px-4 rounded-xl">Search</button>
            </form>
            {!location && !query && (
              <button onClick={() => requestLocation()} className="text-xs font-semibold text-sky-600">
                {locStatus === "loading" ? "Locating…" : "📍 Show clinics around me"}
              </button>
            )}
            {error && <p className="bg-red-50 text-red-600 text-sm px-3 py-2 rounded-lg">{error}</p>}
            {searching && <p className="text-sm text-slate-400 py-3 text-center">Searching the map…</p>}
            <div className="max-h-80 overflow-y-auto space-y-1.5">
              {results.map((p) => (
                <button key={p.key} disabled={p.on_mediflow} onClick={() => { setPicked(p); setStep("details"); }}
                  className="w-full text-left border border-slate-100 rounded-xl px-3 py-2.5 hover:border-sky-300 hover:bg-sky-50 disabled:opacity-50 disabled:hover:bg-transparent">
                  <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                  <p className="text-xs text-slate-500">
                    {p.address || p.area}{p.distance_km != null && ` · ${p.distance_km} km`}
                    {p.on_mediflow && " · already on Mediflow"}
                  </p>
                </button>
              ))}
            </div>
            <button onClick={() => { setPicked(null); setStep("details"); }} className="w-full border border-dashed border-slate-300 rounded-xl py-3 text-sm text-slate-600">
              My clinic isn&apos;t listed — add it
            </button>
          </div>
        )}

        {step === "details" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">3 · Clinic details</p>
              <button onClick={() => setStep("find")} className="text-xs text-sky-600">← Back</button>
            </div>
            {picked && <p className="text-xs text-slate-500">Claiming <strong>{picked.name}</strong> from the map. Check everything — patients see this.</p>}
            <ClinicProfileForm initial={initialFrom(picked)} submitLabel="Register clinic & open portal" onSubmit={register} />
          </div>
        )}
      </div>
    </div>
  );
}
