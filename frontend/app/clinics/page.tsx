"use client";
import { useState, useEffect, useMemo, Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useLocation } from "@/hooks/useLocation";
import { areaDistanceKm } from "@/lib/chat/booking";

type Clinic = {
  id: string;
  name: string;
  address: string;
  area: string;
  specialities: string[];
  rating: number;
  total_reviews: number;
  consultation_fee: number;
  wait_time_minutes: number;
  phone: string;
};

// useSearchParams needs a Suspense boundary for the production build
export default function Clinics() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <ClinicsContent />
    </Suspense>
  );
}

function ClinicsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Uses the location cached on /home (no extra permission prompt)
  const { location } = useLocation();
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [maxFee, setMaxFee] = useState(1000);
  const [minRating, setMinRating] = useState(0);
  // filterByArea / filterBySpeciality — preset from /clinics?area=…&spec=…
  const [selectedArea, setSelectedArea] = useState(() => searchParams.get("area") || "All");
  const [selectedSpec, setSelectedSpec] = useState(() => searchParams.get("spec") || "All");
  const [compareList, setCompareList] = useState<Clinic[]>([]);
  const [showCompare, setShowCompare] = useState(false);

  const areas = ["All", "MG Road", "Koramangala", "Indiranagar", "JP Nagar", "Whitefield", "Jayanagar"];
  const specialities = ["All", "General", "Dental", "Eye", "Cardio", "Ortho", "Pediatric", "Skin", "Neuro", "Gynecology", "ENT", "Psychiatry", "Physio"];

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
    })();
    (async () => {
      const { data } = await supabase.from("clinics").select("*").eq("is_active", true);
      setClinics(data || []);
      setLoading(false);
    })();
  }, [router]);

  // Derived list — recomputed only when a filter changes
  const filtered = useMemo(() => {
    let result = [...clinics];
    if (search) result = result.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.area.toLowerCase().includes(search.toLowerCase()));
    result = result.filter(c => c.consultation_fee <= maxFee);
    result = result.filter(c => c.rating >= minRating);
    if (selectedArea !== "All") result = result.filter(c => c.area === selectedArea);
    if (selectedSpec !== "All") result = result.filter(c => c.specialities?.includes(selectedSpec));
    // Nearest first when we know where the user is, otherwise best rated
    result.sort((a, b) => {
      const da = areaDistanceKm(a.area, location), db = areaDistanceKm(b.area, location);
      if (da != null && db != null && da !== db) return da - db;
      return b.rating - a.rating;
    });
    return result;
  }, [search, maxFee, minRating, selectedArea, selectedSpec, clinics, location]);

  const toggleCompare = (clinic: Clinic) => {
    if (compareList.find(c => c.id === clinic.id)) {
      setCompareList(compareList.filter(c => c.id !== clinic.id));
    } else if (compareList.length < 2) {
      setCompareList([...compareList, clinic]);
    }
  };

  const stars = (rating: number) => {
    return "★".repeat(Math.floor(rating)) + "☆".repeat(5 - Math.floor(rating));
  };

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-blue-600 px-4 pt-5 pb-4">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/home" className="text-white text-xl">←</Link>
          <h1 className="text-white font-semibold text-lg">Find Clinics</h1>
        </div>
        <div className="flex items-center gap-2 bg-white rounded-xl px-3 py-2">
          <span className="text-gray-400">🔍</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clinics or area..."
            className="flex-1 text-sm outline-none text-gray-700"
          />
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4">

        {/* Filters */}
        <div className="bg-white rounded-2xl p-4 shadow-sm mb-4">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-3">Filters</p>

          <div className="mb-3">
            <div className="flex justify-between mb-1">
              <span className="text-xs text-gray-600">Max consultation fee</span>
              <span className="text-xs font-medium text-blue-600">₹{maxFee}</span>
            </div>
            <input
              type="range" min={100} max={2000} step={50}
              value={maxFee}
              onChange={(e) => setMaxFee(Number(e.target.value))}
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>₹100</span><span>₹2000</span>
            </div>
          </div>

          <div className="mb-3">
            <div className="flex justify-between mb-1">
              <span className="text-xs text-gray-600">Minimum rating</span>
              <span className="text-xs font-medium text-blue-600">{minRating === 0 ? "Any" : `${minRating}★ & above`}</span>
            </div>
            <input
              type="range" min={0} max={4.5} step={0.5}
              value={minRating}
              onChange={(e) => setMinRating(Number(e.target.value))}
              className="w-full accent-blue-600"
            />
          </div>

          <div className="mb-3">
            <p className="text-xs text-gray-600 mb-2">Area</p>
            <div className="flex gap-2 flex-wrap">
              {areas.map(a => (
                <button key={a} onClick={() => setSelectedArea(a)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${selectedArea === a ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200"}`}>
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-600 mb-2">Speciality</p>
            <div className="flex gap-2 flex-wrap">
              {specialities.map(s => (
                <button key={s} onClick={() => setSelectedSpec(s)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${selectedSpec === s ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200"}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Compare bar */}
        {compareList.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-blue-600 font-medium">Comparing: {compareList.map(c => c.name).join(" vs ")}</p>
              {compareList.length < 2 && <p className="text-xs text-blue-400">Select one more clinic to compare</p>}
            </div>
            {compareList.length === 2 && (
              <button onClick={() => setShowCompare(true)}
                className="bg-blue-600 text-white text-xs px-3 py-2 rounded-xl">
                Compare →
              </button>
            )}
          </div>
        )}

        {/* Results count */}
        <p className="text-xs text-gray-400 mb-3">
          {filtered.length} clinics found{location && " · nearest first"}
        </p>

        {/* Clinic cards */}
        <div className="space-y-3">
          {filtered.map((clinic) => (
            <div key={clinic.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-50">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-800 text-sm">{clinic.name}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    📍 {clinic.address}
                    {areaDistanceKm(clinic.area, location) != null && (
                      <span className="text-sky-600 font-medium"> · {areaDistanceKm(clinic.area, location)} km away</span>
                    )}
                  </p>
                </div>
                <div className="text-right ml-3">
                  <p className="text-blue-600 font-semibold text-sm">₹{clinic.consultation_fee}</p>
                  <p className="text-xs text-gray-400">consult fee</p>
                </div>
              </div>

              <div className="flex items-center gap-3 mb-3">
                <span className="text-yellow-500 text-xs">{stars(clinic.rating)}</span>
                <span className="text-xs text-gray-600 font-medium">{clinic.rating}</span>
                <span className="text-xs text-gray-400">({clinic.total_reviews} reviews)</span>
                <span className="text-xs text-gray-400">• ⏱ {clinic.wait_time_minutes} min wait</span>
              </div>

              <div className="flex gap-1 flex-wrap mb-3">
                {clinic.specialities?.map(s => (
                  <span key={s} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{s}</span>
                ))}
              </div>

              <div className="flex gap-2">
                <Link href={`/book?clinic=${clinic.id}`}
                  className="flex-1 bg-blue-600 text-white text-xs py-2.5 rounded-xl text-center font-medium hover:bg-blue-700">
                  Book Appointment
                </Link>
                <button
                  onClick={() => toggleCompare(clinic)}
                  className={`px-3 py-2.5 rounded-xl text-xs border transition-colors ${compareList.find(c => c.id === clinic.id) ? "bg-blue-50 border-blue-300 text-blue-600" : "border-gray-200 text-gray-500"}`}>
                  {compareList.find(c => c.id === clinic.id) ? "✓ Added" : "Compare"}
                </button>
                <a href={`tel:${clinic.phone}`}
                  className="px-3 py-2.5 rounded-xl text-xs border border-gray-200 text-gray-500">
                  📞
                </a>
              </div>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="text-center py-12">
              <p className="text-3xl mb-3">🔍</p>
              <p className="text-gray-400 text-sm">No clinics match your filters</p>
              <button onClick={() => { setMaxFee(2000); setMinRating(0); setSelectedArea("All"); setSelectedSpec("All"); }}
                className="mt-3 text-blue-600 text-sm">Reset filters</button>
            </div>
          )}
        </div>
      </div>

      {/* Compare Modal */}
      {showCompare && compareList.length === 2 && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end justify-center z-50">
          <div className="bg-white rounded-t-3xl w-full max-w-2xl p-6 max-h-screen overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-semibold text-gray-800">Clinic Comparison</h2>
              <button onClick={() => setShowCompare(false)} className="text-gray-400 text-xl">×</button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {compareList.map((clinic, i) => (
                <div key={i} className={`rounded-xl p-3 ${i === 0 ? "bg-blue-50" : "bg-green-50"}`}>
                  <p className="font-medium text-sm text-gray-800 mb-3">{clinic.name}</p>
                  <div className="space-y-2">
                    <div>
                      <p className="text-xs text-gray-500">Consultation Fee</p>
                      <p className="text-sm font-semibold text-gray-800">₹{clinic.consultation_fee}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Rating</p>
                      <p className="text-sm font-semibold text-gray-800">{clinic.rating} ★ ({clinic.total_reviews})</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Wait Time</p>
                      <p className="text-sm font-semibold text-gray-800">{clinic.wait_time_minutes} minutes</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Area</p>
                      <p className="text-sm font-semibold text-gray-800">{clinic.area}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Specialities</p>
                      <p className="text-sm font-semibold text-gray-800">{clinic.specialities?.join(", ")}</p>
                    </div>
                    <Link href={`/book?clinic=${clinic.id}`}
                      className={`block text-center text-xs py-2 rounded-xl text-white font-medium mt-2 ${i === 0 ? "bg-blue-600" : "bg-green-600"}`}>
                      Book This Clinic
                    </Link>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 p-3 bg-yellow-50 rounded-xl">
              <p className="text-xs text-yellow-700">
                💡 <strong>Mediflow tip:</strong> Lower fee doesn&apos;t always mean lower quality. Check ratings and wait time together to make the best decision.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}