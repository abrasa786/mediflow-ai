"use client";

import { Fragment, type ReactNode } from "react";
import { pharmacyLinks, type ClinicOption } from "@/lib/chat/booking";

// ── Shared types ──
export type MedicineInfo = {
  found: boolean;
  name?: string;
  generic?: string;
  category?: string;
  requires_prescription?: boolean;
  uses?: string;
  allopathy?: { name: string; works_in: string; typical_price: string; side_effects: string; avoid_if: string };
  ayurvedic?: { name: string; works_in: string; typical_price: string; note: string } | null;
  advice?: string;
  search_term?: string;
};

export type BookingDraft = {
  option: ClinicOption;
  dayLabel: string;
  dateIso: string;
  time: string;
};

// Render text with clickable URLs and **bold** segments
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (/^https?:\/\//.test(part)) {
          return (
            <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-sky-600 underline break-all">
              {part}
            </a>
          );
        }
        if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
        // Drop leftover Markdown: quote markers, stray * / ** and heading hashes
        const plain = part.replace(/^[ \t]*>[ \t]?/gm, "").replace(/^#{1,6}\s+/gm, "").replace(/\*+/g, "");
        return <Fragment key={i}>{plain}</Fragment>;
      })}
    </>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden ${className}`}>{children}</div>;
}

function Row({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-[13px] py-1">
      <span className="text-slate-500">{label}</span>
      <span className={`text-right ${strong ? "font-semibold text-sky-600" : "font-medium text-slate-800"}`}>{value}</span>
    </div>
  );
}

// ── Clinic results ──
export function ClinicCards({
  options,
  startIndex,
  active,
  onSelect,
}: {
  options: ClinicOption[];
  startIndex: number;
  active: boolean;
  onSelect: (o: ClinicOption, n: number) => void;
}) {
  return (
    <div className="space-y-2.5 w-full">
      {options.map((o, i) => (
        <Card key={o.clinicId}>
          <div className="px-3.5 pt-3 pb-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-600">Option {startIndex + i + 1}</p>
                <p className="font-semibold text-slate-800 text-[15px] leading-tight truncate">🏥 {o.clinicName}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  📍 {o.area}
                  {o.distanceKm != null && ` · ${o.distanceKm} km away`}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-lg font-bold text-slate-800 leading-none">₹{o.fee}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">consultation</p>
              </div>
            </div>
            <div className="mt-2.5 flex items-center gap-2.5 bg-slate-50 rounded-xl px-2.5 py-2">
              <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                {o.doctorName.replace(/^Dr\.?\s*/i, "").charAt(0)}
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-slate-800 truncate">{o.doctorName}</p>
                <p className="text-[11px] text-slate-500 truncate">
                  {o.doctorSpecialty}
                  {o.qualification && ` · ${o.qualification}`}
                  {o.experience != null && ` · ${o.experience} yrs exp`}
                </p>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-3 text-xs text-slate-600">
              <span>⭐ {o.rating} <span className="text-slate-400">({o.reviews})</span></span>
              <span>⏱ ~{o.waitMins} min wait</span>
            </div>
          </div>
          <button
            onClick={() => onSelect(o, startIndex + i + 1)}
            disabled={!active}
            className="w-full border-t border-slate-100 py-2.5 text-sm font-semibold text-sky-600 hover:bg-sky-50 disabled:text-slate-300 disabled:hover:bg-transparent transition-colors"
          >
            Book Option {startIndex + i + 1}
          </button>
        </Card>
      ))}
    </div>
  );
}

// ── Booking summary / confirmation ──
export function BookingSummaryCard({ draft, booked, patientId }: { draft: BookingDraft; booked?: boolean; patientId?: string }) {
  const o = draft.option;
  return (
    <Card className="w-full">
      <div className={`px-3.5 py-2.5 ${booked ? "bg-emerald-500" : "bg-sky-500"} text-white`}>
        <p className="text-sm font-semibold">{booked ? "✅ Appointment Confirmed" : "📋 Booking Summary"}</p>
      </div>
      <div className="px-3.5 py-2.5 divide-y divide-slate-100">
        <Row label="Clinic" value={o.clinicName} />
        <Row label="Doctor" value={o.doctorName} />
        <Row label="Date" value={draft.dayLabel} />
        <Row label="Time" value={draft.time} />
        <Row label="Address" value={o.address} />
        <Row label="Fee" value={`₹${o.fee} (pay at clinic)`} strong />
        {booked && patientId && <Row label="Patient ID" value={patientId} />}
      </div>
      {booked && (
        <p className="px-3.5 pb-3 text-xs text-slate-500">
          Show your Mediflow Patient ID at reception. Clinic phone: {o.phone}
        </p>
      )}
    </Card>
  );
}

// ── Medicine comparison ──
export function MedicineCard({ data, showLinks }: { data: MedicineInfo; showLinks: boolean }) {
  const rx = !!data.requires_prescription;
  const links = pharmacyLinks(data.search_term || data.name || "");
  return (
    <Card className="w-full">
      <div className="px-3.5 pt-3 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-slate-800 text-[15px]">💊 {data.name}</p>
            <p className="text-xs text-slate-500">{data.generic}{data.category && ` · ${data.category}`}</p>
          </div>
          <span
            className={`text-[10px] font-semibold px-2 py-1 rounded-full flex-shrink-0 ${
              rx ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
            }`}
          >
            {rx ? "🔒 Prescription" : "✅ No prescription"}
          </span>
        </div>
        {data.uses && <p className="text-[13px] text-slate-700 mt-2">{data.uses}</p>}
      </div>

      {data.allopathy && (
        <div className="mx-3.5 mb-2 rounded-xl bg-sky-50 px-3 py-2">
          <p className="text-xs font-semibold text-sky-700 mb-1">💊 Allopathy — {data.allopathy.name}</p>
          <Row label="Works in" value={data.allopathy.works_in} />
          <Row label="Price" value={data.allopathy.typical_price} />
          <Row label="Side effects" value={data.allopathy.side_effects} />
          <Row label="Avoid if" value={data.allopathy.avoid_if} />
        </div>
      )}

      {!rx && data.ayurvedic && (
        <div className="mx-3.5 mb-2 rounded-xl bg-emerald-50 px-3 py-2">
          <p className="text-xs font-semibold text-emerald-700 mb-1">🌿 Ayurvedic — {data.ayurvedic.name}</p>
          <Row label="Works in" value={data.ayurvedic.works_in} />
          <Row label="Price" value={data.ayurvedic.typical_price} />
          <p className="text-xs text-slate-600 pt-1">{data.ayurvedic.note}</p>
        </div>
      )}

      {showLinks && (
        <div className="px-3.5 pb-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Compare & order</p>
          <div className="grid grid-cols-3 gap-1.5">
            {links.map((l) => (
              <a
                key={l.name}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-center text-xs font-semibold text-sky-600 border border-sky-200 rounded-lg py-2 hover:bg-sky-500 hover:text-white transition-colors"
              >
                {l.name} ↗
              </a>
            ))}
          </div>
        </div>
      )}

      <p className="px-3.5 py-2 bg-slate-50 text-[11px] text-slate-500 border-t border-slate-100">
        {data.advice && <>{data.advice} · </>}⚕️ Please consult a doctor before taking any medicine.
      </p>
    </Card>
  );
}

// ── Report analysis ──
const SECTION_RE = /^\s*(?:#+\s*)?\**\s*(📋|🔍|🥗|🏃|💊|⚠️)/u;

export function ReportCard({ analysis }: { analysis: string }) {
  const sections: { title: string; body: string[] }[] = [];
  for (const line of analysis.split("\n")) {
    if (SECTION_RE.test(line)) {
      sections.push({ title: line.replace(/[#*]/g, "").trim(), body: [] });
    } else if (line.trim()) {
      if (!sections.length) sections.push({ title: "", body: [] });
      sections[sections.length - 1].body.push(line.replace(/^\s*[-•*]\s*/, "• "));
    }
  }
  return (
    <Card className="w-full">
      <div className="px-3.5 py-2.5 bg-sky-500 text-white">
        <p className="text-sm font-semibold">🔬 Your Report, Explained</p>
      </div>
      <div className="divide-y divide-slate-100">
        {sections.map((s, i) => (
          <div key={i} className={`px-3.5 py-2.5 ${s.title.startsWith("⚠️") ? "bg-amber-50" : ""}`}>
            {s.title && <p className="text-[13px] font-semibold text-slate-800 mb-1">{s.title}</p>}
            <div className="text-[13px] text-slate-700 leading-relaxed whitespace-pre-wrap">
              <RichText text={s.body.join("\n")} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Emergency ──
export function EmergencyCard() {
  return (
    <Card className="w-full border-red-200">
      <div className="px-3.5 py-3 bg-red-50">
        <p className="text-sm font-semibold text-red-700">🚨 This may be an emergency</p>
        <p className="text-[13px] text-red-700/90 mt-1">
          Please call an ambulance or go to the nearest emergency room right away. Don&apos;t wait for an appointment.
        </p>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <a href="tel:112" className="text-center text-sm font-semibold bg-red-600 text-white rounded-lg py-2 hover:bg-red-700">
            📞 Call 112
          </a>
          <a
            href="https://www.google.com/maps/search/emergency+hospital+near+me"
            target="_blank"
            rel="noopener noreferrer"
            className="text-center text-sm font-semibold border border-red-300 text-red-700 rounded-lg py-2 hover:bg-red-100"
          >
            🗺️ Nearest hospital
          </a>
        </div>
      </div>
    </Card>
  );
}

// ── File upload ──
export function UploadCard({
  title,
  hint,
  accept,
  active,
  onFile,
}: {
  title: string;
  hint: string;
  accept: string;
  active: boolean;
  onFile: (file: File) => void;
}) {
  return (
    <label className={`block w-full ${active ? "cursor-pointer" : "pointer-events-none opacity-50"}`}>
      <div className="border-2 border-dashed border-sky-300 bg-white rounded-2xl px-4 py-5 text-center hover:border-sky-500 hover:bg-sky-50 transition-colors">
        <div className="text-2xl mb-1">📎</div>
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="text-xs text-slate-500 mt-0.5">{hint}</p>
      </div>
      <input
        type="file"
        accept={accept}
        className="hidden"
        disabled={!active}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}
