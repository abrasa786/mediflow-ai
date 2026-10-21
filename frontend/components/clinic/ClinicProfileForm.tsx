"use client";

// Clinic details — used by self-serve sign-up (/clinic/signup) and the portal's Settings.

import { useState } from "react";
import { geocodeAddress } from "@/lib/places";
import { WEEK } from "@/lib/schedule";

export const CLINIC_SPECIALITIES = [
  "General", "Pediatric", "Cardio", "Ortho", "Skin", "Neuro", "Gynecology",
  "Dental", "Eye", "ENT", "Gastro", "Psychiatry", "Oncology",
];

export type ClinicFormValues = {
  name: string;
  phone: string;
  whatsapp: string;
  address: string;
  area: string;
  city: string;
  lat: number | null;
  lng: number | null;
  specialities: string[];
  fee: number;
  open: string;
  close: string;
  days: string[];
  slotMinutes: number;
  emergency: boolean;
};

export const EMPTY_CLINIC: ClinicFormValues = {
  name: "", phone: "", whatsapp: "", address: "", area: "", city: "", lat: null, lng: null,
  specialities: ["General"], fee: 400, open: "09:00", close: "21:00",
  days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], slotMinutes: 30, emergency: false,
};

const input = "w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400";

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-full border ${on ? "bg-sky-600 text-white border-sky-600" : "bg-white text-slate-600 border-slate-200"}`}>
      {children}
    </button>
  );
}

export default function ClinicProfileForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial: ClinicFormValues;
  submitLabel: string;
  onSubmit: (v: ClinicFormValues) => Promise<void>;
}) {
  const [v, setV] = useState<ClinicFormValues>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [locating, setLocating] = useState(false);
  const [matches, setMatches] = useState<{ label: string; lat: number; lng: number; area: string; city: string }[]>([]);
  const set = <K extends keyof ClinicFormValues>(k: K, val: ClinicFormValues[K]) => setV((x) => ({ ...x, [k]: val }));
  const toggle = (k: "specialities" | "days", item: string) =>
    set(k, v[k].includes(item) ? v[k].filter((x) => x !== item) : [...v[k], item]);

  function useMyLocation() {
    if (!navigator.geolocation) return setError("This browser can't share location.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setV((x) => ({ ...x, lat: pos.coords.latitude, lng: pos.coords.longitude })); setLocating(false); },
      () => { setError("Couldn't get your location — try finding the address instead."); setLocating(false); },
      { timeout: 10000 }
    );
  }

  async function findAddress() {
    const q = [v.address, v.area, v.city].filter(Boolean).join(", ");
    if (q.length < 4) return setError("Type the clinic address first.");
    setLocating(true);
    setError("");
    try {
      const r = await geocodeAddress(q);
      setMatches(r);
      if (!r.length) setError("Address not found on the map — try a nearby landmark, or use your current location while at the clinic.");
    } catch {
      setError("Address search failed. Please try again.");
    } finally {
      setLocating(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!v.name.trim() || !v.phone.trim()) return setError("Clinic name and phone are required.");
    if (v.lat == null || v.lng == null) return setError("Set the clinic's location so patients nearby can find you.");
    if (!v.days.length) return setError("Pick the days you're open.");
    if (v.open >= v.close) return setError("Closing time must be after opening time.");
    if (!v.specialities.length) return setError("Pick at least one speciality.");
    setBusy(true);
    try {
      await onSubmit(v);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block sm:col-span-2">
          <span className="text-xs font-semibold text-slate-500">Clinic name</span>
          <input className={input} value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Sunrise Family Clinic" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-500">Phone (patients call this)</span>
          <input className={input} value={v.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91 98765 43210" inputMode="tel" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-500">WhatsApp for alerts (optional)</span>
          <input className={input} value={v.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} placeholder="Same as phone if empty" inputMode="tel" />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs font-semibold text-slate-500">Address</span>
          <input className={input} value={v.address} onChange={(e) => set("address", e.target.value)} placeholder="Building, street" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-500">Area / locality</span>
          <input className={input} value={v.area} onChange={(e) => set("area", e.target.value)} placeholder="e.g. Indiranagar" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-500">City</span>
          <input className={input} value={v.city} onChange={(e) => set("city", e.target.value)} placeholder="e.g. Bengaluru" />
        </label>
      </div>

      <div className="rounded-xl border border-slate-200 p-3">
        <p className="text-xs font-semibold text-slate-500 mb-2">Location on the map</p>
        {v.lat != null && v.lng != null ? (
          <p className="text-sm text-slate-700 mb-2">
            📍 {v.lat.toFixed(5)}, {v.lng.toFixed(5)} ·{" "}
            <a className="text-sky-600 underline" href={`https://www.google.com/maps?q=${v.lat},${v.lng}`} target="_blank" rel="noopener noreferrer">check on map</a>
          </p>
        ) : (
          <p className="text-sm text-amber-700 mb-2">Not set yet — patients find clinics by distance.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={useMyLocation} disabled={locating} className="text-xs font-semibold border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700">
            {locating ? "Locating…" : "📍 I'm at the clinic — use my location"}
          </button>
          <button type="button" onClick={findAddress} disabled={locating} className="text-xs font-semibold border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700">
            🔎 Find the address above
          </button>
        </div>
        {matches.length > 0 && (
          <div className="mt-2 space-y-1">
            {matches.map((m) => (
              <button type="button" key={`${m.lat},${m.lng}`} onClick={() => { setV((x) => ({ ...x, lat: m.lat, lng: m.lng, area: x.area || m.area, city: x.city || m.city })); setMatches([]); }}
                className="block w-full text-left text-xs text-slate-600 border border-slate-100 rounded-lg px-2 py-1.5 hover:bg-sky-50">
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="text-xs font-semibold text-slate-500 mb-2">Specialities</p>
        <div className="flex flex-wrap gap-2">
          {CLINIC_SPECIALITIES.map((s) => <Chip key={s} on={v.specialities.includes(s)} onClick={() => toggle("specialities", s)}>{s}</Chip>)}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-slate-500">Consultation fee (₹)</span>
          <input className={input} type="number" min={0} max={100000} value={v.fee} onChange={(e) => set("fee", Number(e.target.value))} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-500">Opens</span>
          <input className={input} type="time" value={v.open} onChange={(e) => set("open", e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-500">Closes</span>
          <input className={input} type="time" value={v.close} onChange={(e) => set("close", e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-500">Slot length</span>
          <select className={input} value={v.slotMinutes} onChange={(e) => set("slotMinutes", Number(e.target.value))}>
            {[10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </label>
      </div>

      <div>
        <p className="text-xs font-semibold text-slate-500 mb-2">Open on</p>
        <div className="flex flex-wrap gap-2">
          {WEEK.map((d) => <Chip key={d} on={v.days.includes(d)} onClick={() => toggle("days", d)}>{d}</Chip>)}
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-1 accent-sky-600" checked={v.emergency} onChange={(e) => set("emergency", e.target.checked)} />
        <span>We handle emergencies — include us in Mediflow SOS (you&apos;ll get WhatsApp / call alerts and must respond within 3 minutes).</span>
      </label>

      {error && <p className="bg-red-50 text-red-600 text-sm px-3 py-2 rounded-lg">{error}</p>}
      <button disabled={busy} className="w-full bg-slate-900 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50">
        {busy ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
