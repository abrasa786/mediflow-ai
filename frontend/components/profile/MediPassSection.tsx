"use client";

// MediPass details (filled once) + "Share MediPass" QR that expires in 15 minutes.

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { createMediPassLink, updatePatient, type MediPassDetails, type Patient } from "@/lib/patient";

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const field = "w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-sky-400";

export default function MediPassSection({ patient, onSaved }: { patient: Patient; onSaved: (p: Partial<Patient>) => void }) {
  const [form, setForm] = useState<MediPassDetails>({
    dob: patient.dob ?? "",
    blood_group: patient.blood_group ?? "",
    allergies: patient.allergies ?? "",
    conditions: patient.conditions ?? "",
    medications: patient.medications ?? "",
    address: patient.address ?? "",
    insurance_number: patient.insurance_number ?? "",
    aadhaar_last4: patient.aadhaar_last4 ?? "",
    emergency_contact_name: patient.emergency_contact_name ?? "",
    emergency_contact_phone: patient.emergency_contact_phone ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [share, setShare] = useState<{ url: string; qr: string; expiresAt: string } | null>(null);
  const [sharing, setSharing] = useState(false);

  const set = (k: keyof MediPassDetails, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true);
    setMsg("");
    const values: MediPassDetails = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, typeof v === "string" && v.trim() === "" ? null : v])
    );
    if (values.aadhaar_last4 && !/^\d{4}$/.test(values.aadhaar_last4)) {
      setSaving(false);
      return setMsg("Aadhaar: enter only the last 4 digits.");
    }
    const { error } = await updatePatient(patient.id, values);
    setSaving(false);
    if (error) return setMsg("Couldn't save — the latest database migration may not be applied yet.");
    onSaved(values);
    setMsg("Saved ✅");
  }

  async function openShare() {
    setSharing(true);
    setMsg("");
    try {
      const { url, expiresAt } = await createMediPassLink();
      const qr = await QRCode.toDataURL(url, { width: 260, margin: 1 });
      setShare({ url, qr, expiresAt });
    } catch {
      setMsg("Couldn't create a MediPass link right now.");
    } finally {
      setSharing(false);
    }
  }

  return (
    <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="font-bold text-gray-800">🪪 MediPass</h2>
        <button onClick={openShare} disabled={sharing} className="bg-sky-500 text-white text-xs font-semibold px-4 py-2 rounded-xl hover:bg-sky-600 disabled:opacity-50">
          {sharing ? "Creating…" : "Share MediPass"}
        </button>
      </div>
      <p className="text-xs text-gray-400 mb-4">Fill this once — reception scans your QR instead of you filling forms. Links expire in 15 minutes.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs text-gray-500">Date of birth
          <input type="date" value={form.dob ?? ""} onChange={(e) => set("dob", e.target.value)} className={field} />
        </label>
        <label className="text-xs text-gray-500">Blood group
          <select value={form.blood_group ?? ""} onChange={(e) => set("blood_group", e.target.value)} className={field}>
            <option value="">—</option>
            {BLOOD_GROUPS.map((b) => <option key={b}>{b}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-500 sm:col-span-2">Allergies
          <input value={form.allergies ?? ""} onChange={(e) => set("allergies", e.target.value)} placeholder="e.g. Penicillin, peanuts" className={field} />
        </label>
        <label className="text-xs text-gray-500">Known conditions
          <input value={form.conditions ?? ""} onChange={(e) => set("conditions", e.target.value)} placeholder="e.g. Diabetes, Asthma" className={field} />
        </label>
        <label className="text-xs text-gray-500">Current medications
          <input value={form.medications ?? ""} onChange={(e) => set("medications", e.target.value)} placeholder="e.g. Metformin 500mg" className={field} />
        </label>
        <label className="text-xs text-gray-500 sm:col-span-2">Address
          <input value={form.address ?? ""} onChange={(e) => set("address", e.target.value)} className={field} />
        </label>
        <label className="text-xs text-gray-500">Emergency contact name
          <input value={form.emergency_contact_name ?? ""} onChange={(e) => set("emergency_contact_name", e.target.value)} placeholder="e.g. Spouse / Parent" className={field} />
        </label>
        <label className="text-xs text-gray-500">Emergency contact phone
          <input type="tel" value={form.emergency_contact_phone ?? ""} onChange={(e) => set("emergency_contact_phone", e.target.value)} placeholder="+91 98765 43210" className={field} />
        </label>
        <label className="text-xs text-gray-500">Insurance number (optional)
          <input value={form.insurance_number ?? ""} onChange={(e) => set("insurance_number", e.target.value)} className={field} />
        </label>
        <label className="text-xs text-gray-500">Aadhaar — last 4 digits only (optional)
          <input inputMode="numeric" maxLength={4} value={form.aadhaar_last4 ?? ""} onChange={(e) => set("aadhaar_last4", e.target.value.replace(/\D/g, ""))} className={field} />
        </label>
      </div>
      <div className="flex items-center gap-3 mt-4">
        <button onClick={save} disabled={saving} className="bg-sky-500 text-white text-sm px-5 py-2.5 rounded-xl hover:bg-sky-600 disabled:opacity-50">
          {saving ? "Saving…" : "Save MediPass"}
        </button>
        {msg && <p className="text-xs text-gray-500">{msg}</p>}
      </div>

      {share && <ShareModal {...share} onClose={() => setShare(null)} />}
    </section>
  );
}

function ShareModal({ url, qr, expiresAt, onClose }: { url: string; qr: string; expiresAt: string; onClose: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-xs text-center" onClick={(e) => e.stopPropagation()}>
        <p className="font-bold text-gray-800">Show this at reception</p>
        <p className="text-xs text-gray-500 mb-3">They scan it — no form filling</p>
        {left > 0 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="MediPass QR code" className="mx-auto w-56 h-56" />
        ) : (
          <div className="w-56 h-56 mx-auto flex items-center justify-center bg-gray-50 rounded-xl text-sm text-gray-500">Expired — create a new one</div>
        )}
        <p className={`text-sm font-semibold mt-2 ${left < 60 ? "text-red-600" : "text-gray-700"}`}>
          Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
        </p>
        <div className="grid grid-cols-2 gap-2 mt-4">
          <button
            onClick={async () => {
              if (navigator.share) await navigator.share({ title: "My MediPass", url }).catch(() => {});
              else {
                await navigator.clipboard.writeText(url);
                setCopied(true);
              }
            }}
            className="text-sm font-semibold border border-sky-300 text-sky-600 rounded-xl py-2"
          >
            {copied ? "Copied ✓" : "Share link"}
          </button>
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold bg-sky-500 text-white rounded-xl py-2">Open / PDF</a>
        </div>
        <button onClick={onClose} className="text-xs text-gray-400 mt-3">Close</button>
      </div>
    </div>
  );
}
