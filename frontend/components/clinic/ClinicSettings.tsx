"use client";

// Clinic portal → Settings: what patients see (fee, hours, location, specialities).

import { useEffect, useState } from "react";
import ClinicProfileForm, { EMPTY_CLINIC, type ClinicFormValues } from "@/components/clinic/ClinicProfileForm";
import { getClinicProfile, updateClinicProfile, type ClinicProfile } from "@/lib/clinic";
import { WEEK, hhmmToMinutes } from "@/lib/schedule";

function toForm(c: ClinicProfile): ClinicFormValues {
  const days = c.hours ? WEEK.filter((d) => c.hours?.[d]?.length) : EMPTY_CLINIC.days;
  return {
    name: c.name,
    phone: c.phone ?? "",
    whatsapp: c.whatsapp_phone ?? "",
    address: c.address ?? "",
    area: c.area ?? "",
    city: c.city ?? "",
    lat: c.latitude,
    lng: c.longitude,
    specialities: c.specialities?.length ? c.specialities : ["General"],
    fee: c.consultation_fee ?? EMPTY_CLINIC.fee,
    open: (c.open_time ?? EMPTY_CLINIC.open).slice(0, 5),
    close: (c.close_time ?? EMPTY_CLINIC.close).slice(0, 5),
    days: days.length ? days : EMPTY_CLINIC.days,
    slotMinutes: c.slot_minutes ?? 30,
    emergency: !!c.is_emergency_ready,
  };
}

export default function ClinicSettings({ clinicId, onSaved }: { clinicId: string; onSaved: (msg: string) => void }) {
  const [clinic, setClinic] = useState<ClinicProfile | null>(null);

  useEffect(() => {
    getClinicProfile(clinicId).then(setClinic);
  }, [clinicId]);

  if (!clinic) return <p className="text-sm text-slate-400 py-6 text-center">Loading settings…</p>;

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-4">
      <h2 className="font-bold text-slate-800 mb-1">Clinic settings</h2>
      <p className="text-xs text-slate-500 mb-4">This is what patients see when they search and book on Mediflow.</p>
      <ClinicProfileForm
        key={clinic.id}
        initial={toForm(clinic)}
        submitLabel="Save changes"
        onSubmit={async (v) => {
          const span: [number, number] = [hhmmToMinutes(v.open), hhmmToMinutes(v.close)];
          await updateClinicProfile(clinic.id, {
            name: v.name.trim(),
            phone: v.phone.trim(),
            whatsapp_phone: v.whatsapp.trim() || null,
            address: v.address,
            area: v.area,
            city: v.city,
            latitude: v.lat,
            longitude: v.lng,
            specialities: v.specialities,
            consultation_fee: v.fee,
            open_time: v.open,
            close_time: v.close,
            hours: Object.fromEntries(v.days.map((d) => [d, [span]])),
            slot_minutes: v.slotMinutes,
            is_emergency_ready: v.emergency,
          });
          onSaved("Clinic settings saved ✅");
        }}
      />
    </section>
  );
}
