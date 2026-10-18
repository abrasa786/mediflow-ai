"use client";
import { useState, useEffect, Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createAppointment } from "@/lib/appointments";
import { getPatientProfile, type Patient } from "@/lib/patient";

type Doctor = {
  id: string;
  name: string;
  speciality: string;
  qualification: string;
  experience_years: number;
  consultation_fee: number;
  rating: number;
  clinic_id: string;
};

type Clinic = {
  id: string;
  name: string;
  address: string;
  area: string;
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
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState(false);
  const [bookError, setBookError] = useState("");
  const [patient, setPatient] = useState<Patient | null>(null);

  const timeSlots = [
    "09:00 AM", "09:30 AM", "10:00 AM", "10:30 AM",
    "11:00 AM", "11:30 AM", "12:00 PM", "02:00 PM",
    "02:30 PM", "03:00 PM", "03:30 PM", "04:00 PM",
    "04:30 PM", "05:00 PM", "05:30 PM", "06:00 PM"
  ];

  const getNext7Days = () => {
    const days = [];
    for (let i = 1; i <= 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      days.push({
        date: date.toISOString().split("T")[0],
        label: date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })
      });
    }
    return days;
  };

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const patientData = await getPatientProfile(user);
      setPatient(patientData);

      if (clinicId) {
        const { data: clinicData } = await supabase.from("clinics").select("*").eq("id", clinicId).single();
        setClinic(clinicData);
        const { data: doctorData } = await supabase.from("doctors").select("*").eq("clinic_id", clinicId);
        setDoctors(doctorData || []);
      }
      setLoading(false);
    };
    init();
  }, []);

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
    });

    setBooking(false);
    if (error) {
      setBookError(error.code === "23505"
        ? "That slot was just booked by someone else. Please pick another time."
        : "Couldn't save your booking. Please try again.");
      return;
    }
    setBooked(true);
  };

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (booked) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-3xl p-8 text-center max-w-sm w-full shadow-sm">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-xl font-semibold text-gray-800 mb-2">Appointment Confirmed!</h2>
        <p className="text-sm text-gray-500 mb-6">Your appointment has been booked successfully.</p>
        <div className="bg-blue-50 rounded-2xl p-4 text-left mb-6 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Clinic</span>
            <span className="font-medium text-gray-800">{clinic?.name}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Doctor</span>
            <span className="font-medium text-gray-800">{selectedDoctor?.name}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Date</span>
            <span className="font-medium text-gray-800">{selectedDate}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Time</span>
            <span className="font-medium text-gray-800">{selectedTime}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Fee</span>
            <span className="font-medium text-blue-600">₹{selectedDoctor?.consultation_fee}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Patient ID</span>
            <span className="font-medium text-gray-800">{patient?.patient_id}</span>
          </div>
        </div>
        <Link href="/home" className="block bg-blue-600 text-white py-3 rounded-xl text-sm font-medium hover:bg-blue-700">
          Back to Home
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
        {clinic && <p className="text-blue-200 text-sm ml-8">{clinic.name} — {clinic.area}</p>}
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* Select Doctor */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-3">Select Doctor</p>
          <div className="space-y-2">
            {doctors.map((doctor) => (
              <div
                key={doctor.id}
                onClick={() => setSelectedDoctor(doctor)}
                className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-colors ${selectedDoctor?.id === doctor.id ? "border-blue-500 bg-blue-50" : "border-gray-100 hover:border-gray-200"}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-semibold text-sm">
                    {doctor.name.split(" ")[1]?.[0] || "D"}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{doctor.name}</p>
                    <p className="text-xs text-gray-400">{doctor.speciality} • {doctor.qualification}</p>
                    <p className="text-xs text-gray-400">{doctor.experience_years} years exp • ⭐ {doctor.rating}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-blue-600">₹{doctor.consultation_fee}</p>
                  {selectedDoctor?.id === doctor.id && <p className="text-xs text-blue-500">Selected ✓</p>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Select Date */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-3">Select Date</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {getNext7Days().map((day) => (
              <button
                key={day.date}
                onClick={() => setSelectedDate(day.date)}
                className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs border transition-colors ${selectedDate === day.date ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200"}`}
              >
                {day.label}
              </button>
            ))}
          </div>
        </div>

        {/* Select Time */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-3">Select Time</p>
          <div className="grid grid-cols-4 gap-2">
            {timeSlots.map((time) => (
              <button
                key={time}
                onClick={() => setSelectedTime(time)}
                className={`py-2 rounded-xl text-xs border transition-colors ${selectedTime === time ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"}`}
              >
                {time}
              </button>
            ))}
          </div>
        </div>

        {/* Summary */}
        {selectedDoctor && selectedDate && selectedTime && (
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
            <p className="text-xs text-blue-600 font-medium uppercase tracking-wide mb-2">Booking Summary</p>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Doctor</span>
                <span className="font-medium">{selectedDoctor.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Date</span>
                <span className="font-medium">{selectedDate}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Time</span>
                <span className="font-medium">{selectedTime}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Fee</span>
                <span className="font-medium text-blue-600">₹{selectedDoctor.consultation_fee}</span>
              </div>
            </div>
          </div>
        )}

        {bookError && (
          <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-xl">{bookError}</div>
        )}

        {/* Book button */}
        <button
          onClick={handleBook}
          disabled={!selectedDoctor || !selectedDate || !selectedTime || booking}
          className="w-full bg-blue-600 text-white py-4 rounded-2xl font-medium text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {booking ? "Booking..." : "Confirm Appointment"}
        </button>

      </div>
    </div>
  );
}