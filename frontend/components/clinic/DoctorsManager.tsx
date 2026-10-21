"use client";

// Clinic portal → Doctors: who patients can book, their fee and working days.

import { useCallback, useEffect, useState } from "react";
import { getClinicProfile, listClinicDoctors, saveClinicDoctor, type ClinicDoctor } from "@/lib/clinic";
import { WEEK } from "@/lib/schedule";

const SPECIALISTS = [
  "General Physician", "Pediatrician", "Gynecologist", "Dermatologist", "Orthopedic", "Cardiologist",
  "Neurologist", "Dentist", "Ophthalmologist", "ENT", "Gastroenterologist", "Psychiatrist", "Oncologist",
];

type Draft = Partial<ClinicDoctor>;
const input = "w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400";

export default function DoctorsManager({ clinicId, onChange }: { clinicId: string; onChange?: () => void }) {
  const [doctors, setDoctors] = useState<ClinicDoctor[]>([]);
  const [defaultFee, setDefaultFee] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => setDoctors(await listClinicDoctors(clinicId)), [clinicId]);
  useEffect(() => {
    getClinicProfile(clinicId).then((c) => setDefaultFee(c?.consultation_fee ?? null));
  }, [clinicId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function save(d: Draft) {
    if (!d.name?.trim()) return setError("Doctor's name is required.");
    setBusy(true);
    setError("");
    try {
      await saveClinicDoctor({ ...d, clinic_id: clinicId });
      setDraft(null);
      await load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-slate-800">Doctors</h2>
        {!draft && (
          <button onClick={() => setDraft({ speciality: "General Physician", consultation_fee: defaultFee ?? undefined, available_days: WEEK.slice(0, 6) })}
            className="text-xs font-semibold bg-sky-600 text-white rounded-lg px-3 py-1.5">+ Add doctor</button>
        )}
      </div>

      {!doctors.length && !draft && (
        <p className="text-sm text-slate-400 py-3">
          No doctors yet — patients will book your “duty doctor”. Add doctors so patients can pick by name and speciality.
        </p>
      )}

      <div className="space-y-2">
        {doctors.map((d) => (
          <div key={d.id} className={`flex flex-wrap items-center justify-between gap-2 border border-slate-100 rounded-xl p-3 ${d.is_active ? "" : "opacity-50"}`}>
            <div>
              <p className="text-sm font-semibold text-slate-800">{d.name} {!d.is_active && <span className="text-[10px] text-slate-500">(hidden)</span>}</p>
              <p className="text-xs text-slate-500">
                {[d.speciality, d.qualification, d.experience_years != null && `${d.experience_years} yrs`, d.consultation_fee != null && `₹${d.consultation_fee}`]
                  .filter(Boolean).join(" · ")}
              </p>
              <p className="text-[11px] text-slate-400">{d.available_days?.join(", ") || "Every open day"}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setDraft(d)} className="text-xs border border-slate-200 rounded-lg px-2.5 py-1 text-slate-600">Edit</button>
              <button onClick={() => save({ ...d, is_active: !d.is_active })} className="text-xs border border-slate-200 rounded-lg px-2.5 py-1 text-slate-600">
                {d.is_active ? "Hide" : "Show"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {draft && (
        <div className="mt-3 border border-sky-200 bg-sky-50/40 rounded-xl p-3 space-y-2">
          <div className="grid sm:grid-cols-2 gap-2">
            <input className={input} placeholder="Dr. Full Name" value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <select className={input} value={draft.speciality ?? ""} onChange={(e) => setDraft({ ...draft, speciality: e.target.value })}>
              {SPECIALISTS.map((s) => <option key={s}>{s}</option>)}
            </select>
            <input className={input} placeholder="Qualification, e.g. MBBS, MD" value={draft.qualification ?? ""} onChange={(e) => setDraft({ ...draft, qualification: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input className={input} type="number" min={0} placeholder="Years exp." value={draft.experience_years ?? ""}
                onChange={(e) => setDraft({ ...draft, experience_years: e.target.value === "" ? null : Number(e.target.value) })} />
              <input className={input} type="number" min={0} placeholder="Fee ₹" value={draft.consultation_fee ?? ""}
                onChange={(e) => setDraft({ ...draft, consultation_fee: e.target.value === "" ? null : Number(e.target.value) })} />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {WEEK.map((day) => {
              const on = draft.available_days?.includes(day);
              return (
                <button key={day} type="button"
                  onClick={() => setDraft({ ...draft, available_days: on ? draft.available_days!.filter((x) => x !== day) : [...(draft.available_days ?? []), day] })}
                  className={`text-xs px-2.5 py-1 rounded-full border ${on ? "bg-sky-600 text-white border-sky-600" : "bg-white text-slate-600 border-slate-200"}`}>
                  {day}
                </button>
              );
            })}
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => save(draft)} className="text-sm font-semibold bg-slate-900 text-white rounded-lg px-4 py-2 disabled:opacity-50">
              {busy ? "Saving…" : "Save doctor"}
            </button>
            <button onClick={() => { setDraft(null); setError(""); }} className="text-sm text-slate-500 px-3">Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
