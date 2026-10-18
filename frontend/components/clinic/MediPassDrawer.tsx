"use client";

import { ageFromDob, type PatientCard } from "@/lib/clinic";

export default function MediPassDrawer({ p, onClose }: { p: PatientCard; onClose: () => void }) {
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
              <span className={`text-right font-medium ${k === "Allergies" && v ? "text-red-600" : "text-slate-800"}`}>{v || "—"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
