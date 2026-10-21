"use client";
import { useState, useEffect, useMemo, Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createAppointment, getBookedTimes } from "@/lib/appointments";
import { getPatientProfile, type Patient } from "@/lib/patient";
import { directionsUrl, telHref } from "@/lib/places";
import { bookableDays, describeHours, hoursFromRange, timeSlots, type Hours } from "@/lib/schedule";

type Doctor = {
  id: string | null; // null = the clinic's duty doctor (no named doctor listed)
  name: string;
  speciality: string;
  qualification: string | null;
  experience_years: number | null;
  consultation_fee: number;
  rating: number | null;
  available_days: string[] | null;
};

type Clinic = {
  id: string;
  name: string;
  address: string;
  area: string;
  city: string;
  phone: string;
  latitude: number | null;
  longitude: number | null;
  consultation_fee: number;
  specialities: string[] | null;
  open_time: string | null;
  close_time: string | null;
  hours: Hours | null;
  slot_minutes: number | null;
  claimed_at: string | null;
  source: string | null;
};

// useSearchParams needs a Suspense boundary for the production build
export default function Book() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <BookContent />
    </Suspense>
  );
}

function BookContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clinicId = searchParams.get("clinic");

  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [booked, setBookedTimes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [done, setDone] = useState(false);
  const [bookError, setBookError] = useState("");
  const [patient, setPatient] = useState<Patient | null>(null);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setPatient(await getPatientProfile(user));

      if (clinicId) {
        const [{ data: c }, { data: docs }] = await Promise.all([
          supabase.from("clinics").select("*").eq("id", clinicId).maybeSingle(),
          supabase.from("doctors").select("*").eq("clinic_id", clinicId),
        ]);
        const row = c as Clinic | null;
        setClinic(row);
        const active = ((docs as (Doctor & { is_active?: boolean })[]) ?? []).filter((d) => d.is_active !== false);
        const list: Doctor[] = active.length
          ? active.map((d) => ({ ...d, consultation_fee: d.consultation_fee ?? row?.consultation_fee ?? 0 }))
          : row
          ? [{
              id: null,
              name: "Duty doctor",
              speciality: row.specialities?.length && !row.specialities.includes("General") ? row.specialities[0] : "General Physician",
              qualification: null,
              experience_years: null,
              consultation_fee: row.consultation_fee,
              rating: null,
              available_days: null,
            }]
          : [];
        setDoctors(list);
        if (list.length === 1) setSelectedDoctor(list[0]);
      }
      setLoading(false);
    };
    init();
  }, [clinicId, router]);

  const hours = useMemo(() => clinic?.hours ?? hoursFromRange(clinic?.open_time, clinic?.close_time), [clinic]);
  const hoursKnown = !!clinic?.hours || !!clinic?.claimed_at;
  const slotMinutes = clinic?.slot_minutes || 30;
  const onMediflow = !!clinic?.claimed_at;

  const days = useMemo(
    () => (clinic ? bookableDays(hours, { doctorDays: selectedDoctor?.available_days, slotMinutes, count: 7 }) : []),
    [clinic, hours, selectedDoctor, slotMinutes]
  );
  const day = days.find((d) => d.iso === selectedDate) ?? null;
  const slots = useMemo(() => (day ? timeSlots(hours, day.date, slotMinutes).filter((t) => !booked.includes(t)) : []), [day, hours, slotMinutes, booked]);

  // Already-booked times for the chosen doctor + day
  useEffect(() => {
    if (!clinicId || !selectedDate || !selectedDoctor) return;
    let stale = false;
    getBookedTimes(clinicId, selectedDoctor.id, selectedDate).then((t) => { if (!stale) setBookedTimes(t); });
    return () => { stale = true; };
  }, [clinicId, selectedDate, selectedDoctor]);

  const handleBook = async () => {
    if (!selectedDoctor || !selectedDate || !selectedTime || !clinicId) return;
    setBooking(true);
    setBookError("");

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const { error } = await createAppointment({
      patientId: user.id,
      clinicId,
      doctorId: selectedDoctor.id,
      date: selectedDate,
      time: selectedTime,
      fee: selectedDoctor.consultation_fee,
      symptoms: symptoms.trim() || undefined,
    });

    setBooking(false);
    if (error) {
      if (error.code === "23505") {
        setBookedTimes((b) => [...b, selectedTime]);
        setSelectedTime("");
        setBookError("That slot was just booked by someone else. Please pick another time.");
      } else {
        setBookError("Couldn't save your booking. Please try again.");
      }
      return;
    }
    setDone(true);
  };

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!clinic) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-3xl p-8 text-center max-w-sm w-full shadow-sm">
        <p className="text-4xl mb-3">🏥</p>
        <p className="text-gray-700 font-medium mb-4">Choose a clinic to book</p>
        <Link href="/clinics" className="block bg-blue-600 text-white py-3 rounded-xl text-sm font-medium">Find clinics near me</Link>
      </div>
    </div>
  );

  const feeLabel = (fee: number) => `₹${fee}${!onMediflow ? " approx." : ""}`;

  if (done) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-3xl p-8 text-center max-w-sm w-full shadow-sm">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-xl font-semibold text-gray-800 mb-2">{onMediflow ? "Appointment Confirmed!" : "Slot Reserved"}</h2>
        <p className="text-sm text-gray-500 mb-4">
          {onMediflow
            ? "The clinic can see your booking on its Mediflow dashboard."
            : `${clinic.name} isn't on Mediflow yet — please call the clinic to confirm this time.`}
        </p>
        <div className="bg-blue-50 rounded-2xl p-4 text-left mb-4 space-y-2">
          {([
            ["Clinic", clinic.name],
            ["Doctor", selectedDoctor?.name],
            ["Date", day?.label ? `${day.label} (${selectedDate})` : selectedDate],
            ["Time", selectedTime],
            ["Fee", selectedDoctor ? `${feeLabel(selectedDoctor.consultation_fee)} · pay at clinic` : ""],
            ["Patient ID", patient?.patient_id],
          ] as const).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 text-sm">
              <span className="text-gray-500">{k}</span>
              <span className="font-medium text-gray-800 text-right">{v}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mb-3">
          {clinic.phone && <a href={telHref(clinic.phone)} className="flex-1 border border-blue-200 text-blue-600 py-2.5 rounded-xl text-sm font-medium">📞 Call</a>}
          {clinic.latitude != null && clinic.longitude != null && (
            <a href={directionsUrl({ lat: clinic.latitude, lng: clinic.longitude })} target="_blank" rel="noopener noreferrer" className="flex-1 border border-blue-200 text-blue-600 py-2.5 rounded-xl text-sm font-medium">🗺️ Directions</a>
          )}
        </div>
        <Link href="/profile" className="block bg-blue-600 text-white py-3 rounded-xl text-sm font-medium hover:bg-blue-700">
          View my appointments
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-blue-600 px-4 pt-5 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <Link href="/clinics" className="text-white text-xl">←</Link>
          <h1 className="text-white font-semibold text-lg">Book Appointment</h1>
        </div>
        <p className="text-blue-100 text-sm ml-8">{clinic.name}{clinic.area && ` — ${clinic.area}`}</p>
        <p className="text-blue-200 text-xs ml-8 mt-0.5">🕒 {hoursKnown ? describeHours(hours) : "Hours not listed — showing usual clinic hours"}</p>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        {!onMediflow && (
          <div className="bg-amber-50 border border-amber-100 text-amber-800 text-xs rounded-2xl px-4 py-3">
            📞 This clinic isn&apos;t on Mediflow yet, so it won&apos;t receive your booking automatically. Reserve a slot here, then call
            {clinic.phone ? <> <a href={telHref(clinic.phone)} className="font-semibold underline">{clinic.phone}</a></> : " the clinic"} to confirm. The fee shown is approximate.
          </div>
        )}

        {/* Select Doctor */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-3">Select Doctor</p>
          <div className="space-y-2">
            {doctors.map((doctor) => (
              <div
                key={doctor.id ?? "duty"}
                onClick={() => { setSelectedDoctor(doctor); setSelectedDate(""); setSelectedTime(""); }}
                className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-colors ${selectedDoctor?.id === doctor.id ? "border-blue-500 bg-blue-50" : "border-gray-100 hover:border-gray-200"}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-semibold text-sm">
                    {doctor.name.replace(/^Dr\.?\s*/i, "").charAt(0) || "D"}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{doctor.name}</p>
                    <p className="text-xs text-gray-400">{[doctor.speciality, doctor.qualification].filter(Boolean).join(" • ")}</p>
                    {(doctor.experience_years != null || doctor.rating != null) && (
                      <p className="text-xs text-gray-400">
                        {[doctor.experience_years != null && `${doctor.experience_years} years exp`, doctor.rating != null && `⭐ ${doctor.rating}`].filter(Boolean).join(" • ")}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-blue-600">{feeLabel(doctor.consultation_fee)}</p>
                  {selectedDoctor?.id === doctor.id && <p className="text-xs text-blue-500">Selected ✓</p>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Select Date */}
        {selectedDoctor && (
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-3">Select Date</p>
            {days.length ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {days.map((d) => (
                  <button
                    key={d.iso}
                    onClick={() => { setSelectedDate(d.iso); setSelectedTime(""); }}
                    className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs border transition-colors ${selectedDate === d.iso ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200"}`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No open days in the next two weeks.</p>
            )}
          </div>
        )}

        {/* Select Time */}
        {day && (
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-3">Select Time</p>
            {slots.length ? (
              <div className="grid grid-cols-4 gap-2">
                {slots.map((time) => (
                  <button
                    key={time}
                    onClick={() => setSelectedTime(time)}
                    className={`py-2 rounded-xl text-xs border transition-colors ${selectedTime === time ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"}`}
                  >
                    {time}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">{day.label} is fully booked — please pick another day.</p>
            )}
          </div>
        )}

        {/* Reason for visit */}
        {selectedTime && (
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">Reason for visit (optional)</p>
            <textarea
              value={symptoms}
              onChange={(e) => setSymptoms(e.target.value.slice(0, 300))}
              rows={2}
              placeholder="e.g. Fever for 3 days, mild headache"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400"
            />
            <p className="text-[11px] text-gray-400 mt-1">Shared only with the clinic you&apos;re booking.</p>
          </div>
        )}

        {bookError && <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-xl">{bookError}</div>}

        <button
          onClick={handleBook}
          disabled={!selectedDoctor || !selectedDate || !selectedTime || booking}
          className="w-full bg-blue-600 text-white py-4 rounded-2xl font-medium text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {booking ? "Booking..." : selectedDoctor && selectedTime ? `Confirm · ${selectedTime} · ${feeLabel(selectedDoctor.consultation_fee)}` : "Confirm Appointment"}
        </button>
      </div>
    </div>
  );
}
