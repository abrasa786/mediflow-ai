"use client";

// MediPass — what the clinic receptionist sees after scanning the patient's QR.
// Data is fetched live through a 15-minute token; nothing is stored or cached.

import { use, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ageFromDob } from "@/lib/clinic";

type Pass = {
  patient_id: string | null;
  name: string;
  phone: string | null;
  dob: string | null;
  gender: string | null;
  blood_group: string | null;
  allergies: string | null;
  conditions: string | null;
  medications: string | null;
  address: string | null;
  city: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  insurance_number: string | null;
  aadhaar_last4: string | null;
  avatar_url: string | null;
  expires_at: string;
};

export default function MediPassPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [pass, setPass] = useState<Pass | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "expired">("loading");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("get_medipass", { p_token: token });
      if (data) {
        setPass(data as Pass);
        setState("ok");
      } else setState("expired");
    })();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [token]);

  const left = pass ? Math.max(0, Math.floor((new Date(pass.expires_at).getTime() - now) / 1000)) : 0;
  if (state === "loading") return <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">Loading MediPass…</div>;
  if (state === "expired" || !pass || left === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 bg-slate-50">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center max-w-sm">
          <p className="text-3xl mb-2">⌛</p>
          <p className="font-semibold text-slate-800">This MediPass has expired</p>
          <p className="text-sm text-slate-500 mt-1">For privacy, MediPass links work for 15 minutes. Ask the patient to share a new one.</p>
        </div>
      </div>
    );
  }

  const age = ageFromDob(pass.dob);
  const rows: [string, string | null][] = [
    ["Date of birth", pass.dob ? `${new Date(pass.dob).toLocaleDateString("en-IN")}${age != null ? ` (${age} yrs)` : ""}` : null],
    ["Gender", pass.gender],
    ["Phone", pass.phone],
    ["Blood group", pass.blood_group],
    ["Allergies", pass.allergies],
    ["Known conditions", pass.conditions],
    ["Current medications", pass.medications],
    ["Address", [pass.address, pass.city].filter(Boolean).join(", ") || null],
    ["Emergency contact", [pass.emergency_contact_name, pass.emergency_contact_phone].filter(Boolean).join(" · ") || null],
    ["Insurance no.", pass.insurance_number],
    ["Aadhaar", pass.aadhaar_last4 ? `XXXX XXXX ${pass.aadhaar_last4}` : null],
  ];

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4 print:bg-white print:p-0">
      <div className="max-w-lg mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden print:shadow-none print:border-0">
        <div className="bg-gradient-to-r from-sky-500 to-sky-700 text-white px-5 py-4 flex items-center gap-4">
          {pass.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pass.avatar_url} alt="" className="w-14 h-14 rounded-full object-cover border-2 border-white" />
          ) : (
            <div className="w-14 h-14 rounded-full bg-white text-sky-600 flex items-center justify-center text-2xl font-bold">{pass.name.charAt(0)}</div>
          )}
          <div>
            <p className="text-xs text-sky-100 uppercase tracking-wide">MediPass</p>
            <p className="text-xl font-bold">{pass.name}</p>
            <p className="font-mono tracking-widest text-lg">{pass.patient_id}</p>
          </div>
        </div>
        <div className="px-5 py-3 divide-y divide-slate-100">
          {rows.map(([k, v]) => (
            <div key={k} className="py-2 flex justify-between gap-4 text-sm">
              <span className="text-slate-500">{k}</span>
              <span className={`text-right font-medium ${k === "Allergies" && v ? "text-red-600" : "text-slate-800"}`}>{v || "—"}</span>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 bg-slate-50 flex items-center justify-between gap-3 print:hidden">
          <span className="text-xs text-slate-500">Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>
          <button onClick={() => window.print()} className="text-sm font-semibold bg-sky-500 text-white rounded-lg px-4 py-2">⬇ Save as PDF</button>
        </div>
        <p className="hidden print:block px-5 py-3 text-[11px] text-slate-500">Generated from Mediflow AI · valid until {new Date(pass.expires_at).toLocaleString("en-IN")}</p>
      </div>
    </div>
  );
}
