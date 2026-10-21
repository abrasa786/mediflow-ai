"use client";
import { useState, useEffect, useMemo, Suspense, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useLocation } from "@/hooks/useLocation";
import { directionsUrl, ensureClinicId, getNearbyPlaces, searchPlaces, telHref, type Place } from "@/lib/places";
import { describeHours } from "@/lib/schedule";

const SPECIALITIES = ["All", "General", "Dental", "Eye", "Cardio", "Ortho", "Pediatric", "Skin", "Neuro", "Gynecology", "ENT", "Gastro", "Psychiatry"];
const ALIASES: Record<string, string> = { Physio: "Ortho", Dentist: "Dental" };
const RADII = [2, 5, 10, 20];

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
  const { location, status: locStatus, requestLocation } = useLocation({ auto: true });
  const [places, setPlaces] = useState<Place[]>([]);
  const [provider, setProvider] = useState<"google" | "osm" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState(false); // showing results of a map search
  const [maxFee, setMaxFee] = useState(2000);
  const [minRating, setMinRating] = useState(0);
  const [radius, setRadius] = useState(5);
  const [onlyMediflow, setOnlyMediflow] = useState(false);
  const [selectedSpec, setSelectedSpec] = useState(() => {
    const s = searchParams.get("spec") || "All";
    return ALIASES[s] ?? (SPECIALITIES.includes(s) ? s : "All");
  });
  const [compareList, setCompareList] = useState<Place[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [booking, setBooking] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) router.push("/login");
    })();
  }, [router]);

  const loadNearby = useCallback(async () => {
    if (!location) return;
    setLoading(true);
    setError("");
    setSearchMode(false);
    try {
      const res = await getNearbyPlaces(location.lat, location.lng, {
        specialty: selectedSpec === "All" ? "" : selectedSpec,
        radiusKm: radius,
      });
      setPlaces(res.places);
      setProvider(res.provider);
    } catch {
      setError("Couldn't load clinics from the map right now. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [location, selectedSpec, radius]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadNearby();
  }, [loadNearby]);

  async function runSearch() {
    const q = search.trim();
    if (q.length < 2) return loadNearby();
    setLoading(true);
    setError("");
    try {
      const res = await searchPlaces(q, location);
      setPlaces(res.places);
      setProvider(res.provider);
      setSearchMode(true);
    } catch {
      setError("Search failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return places
      .filter((c) => searchMode || !q || c.name.toLowerCase().includes(q) || c.area.toLowerCase().includes(q))
      .filter((c) => c.fee <= maxFee)
      .filter((c) => !minRating || (c.rating ?? 0) >= minRating)
      .filter((c) => !onlyMediflow || c.on_mediflow)
      .filter((c) => searchMode || selectedSpec === "All" || c.specialities.includes(selectedSpec));
  }, [places, search, searchMode, maxFee, minRating, onlyMediflow, selectedSpec]);

  const hasRatings = places.some((p) => p.rating != null);

  const toggleCompare = (clinic: Place) => {
    if (compareList.find((c) => c.key === clinic.key)) setCompareList(compareList.filter((c) => c.key !== clinic.key));
    else if (compareList.length < 2) setCompareList([...compareList, clinic]);
  };

  async function book(place: Place) {
    setBooking(place.key);
    try {
      const id = await ensureClinicId(place);
      router.push(`/book?clinic=${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open booking for this clinic.");
      setBooking(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-blue-600 px-4 pt-5 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <Link href="/home" className="text-white text-xl">←</Link>
          <h1 className="text-white font-semibold text-lg">Find Clinics</h1>
        </div>
        <p className="text-blue-100 text-xs ml-8 mb-3">
          {location ? `📍 Near ${location.area}${location.city && location.city !== location.area ? `, ${location.city}` : ""}` : "📍 Location needed"}
          {provider && ` · live from ${provider === "google" ? "Google Maps" : "OpenStreetMap"}`}
        </p>
        <form
          onSubmit={(e) => { e.preventDefault(); runSearch(); }}
          className="flex items-center gap-2 bg-white rounded-xl px-3 py-2"
        >
          <span className="text-gray-400">🔍</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter, or press Enter to search the map…"
            className="flex-1 text-sm outline-none text-gray-700"
          />
          {searchMode && (
            <button type="button" onClick={() => { setSearch(""); loadNearby(); }} className="text-xs text-blue-600">Clear</button>
          )}
        </form>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4">
        {!location && (
          <div className="bg-white rounded-2xl p-5 shadow-sm mb-4 text-center">
            <p className="text-3xl mb-2">📍</p>
            <p className="text-sm text-gray-700 font-medium mb-1">
              {locStatus === "loading" ? "Finding your location…" : "Allow location to see real clinics near you"}
            </p>
            {locStatus === "denied" && (
              <p className="text-xs text-gray-400 mb-3">Location is blocked — enable it for this site in your browser settings, then retry.</p>
            )}
            {locStatus !== "loading" && (
              <button onClick={() => requestLocation()} className="bg-blue-600 text-white text-sm px-4 py-2 rounded-xl">Use my location</button>
            )}
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-2xl p-4 shadow-sm mb-4">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-3">Filters</p>

          <div className="mb-3">
            <p className="text-xs text-gray-600 mb-2">Distance</p>
            <div className="flex gap-2 flex-wrap">
              {RADII.map((r) => (
                <button key={r} onClick={() => setRadius(r)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${radius === r ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200"}`}>
                  Within {r} km
                </button>
              ))}
            </div>
          </div>

          <div className="mb-3">
            <div className="flex justify-between mb-1">
              <span className="text-xs text-gray-600">Max consultation fee</span>
              <span className="text-xs font-medium text-blue-600">₹{maxFee}</span>
            </div>
            <input type="range" min={200} max={2000} step={50} value={maxFee}
              onChange={(e) => setMaxFee(Number(e.target.value))} className="w-full accent-blue-600" />
          </div>

          {hasRatings && (
            <div className="mb-3">
              <div className="flex justify-between mb-1">
                <span className="text-xs text-gray-600">Minimum rating</span>
                <span className="text-xs font-medium text-blue-600">{minRating === 0 ? "Any" : `${minRating}★ & above`}</span>
              </div>
              <input type="range" min={0} max={4.5} step={0.5} value={minRating}
                onChange={(e) => setMinRating(Number(e.target.value))} className="w-full accent-blue-600" />
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-gray-600 mb-3">
            <input type="checkbox" checked={onlyMediflow} onChange={(e) => setOnlyMediflow(e.target.checked)} className="accent-blue-600" />
            Only clinics that confirm bookings on Mediflow
          </label>

          <div>
            <p className="text-xs text-gray-600 mb-2">Speciality</p>
            <div className="flex gap-2 flex-wrap">
              {SPECIALITIES.map((s) => (
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
              <p className="text-xs text-blue-600 font-medium">Comparing: {compareList.map((c) => c.name).join(" vs ")}</p>
              {compareList.length < 2 && <p className="text-xs text-blue-400">Select one more clinic to compare</p>}
            </div>
            {compareList.length === 2 && (
              <button onClick={() => setShowCompare(true)} className="bg-blue-600 text-white text-xs px-3 py-2 rounded-xl">Compare →</button>
            )}
          </div>
        )}

        {error && <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-xl mb-3">{error}</div>}

        {loading ? (
          <div className="text-center py-12">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-gray-500">Finding real clinics near you…</p>
          </div>
        ) : (
          <>
            {location && (
              <p className="text-xs text-gray-400 mb-3">
                {filtered.length} clinics {searchMode ? `matching “${search.trim()}”` : `within ${radius} km`} · nearest first
              </p>
            )}

            <div className="space-y-3">
              {filtered.map((clinic) => (
                <div key={clinic.key} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-50">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-gray-800 text-sm">{clinic.name}</h3>
                        {clinic.on_mediflow && <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-full font-semibold">✓ On Mediflow</span>}
                        {clinic.kind === "hospital" && <span className="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded-full font-semibold">Hospital</span>}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        📍 {clinic.address || clinic.area}
                        {clinic.distance_km != null && <span className="text-sky-600 font-medium"> · {clinic.distance_km} km away</span>}
                      </p>
                    </div>
                    <div className="text-right ml-3">
                      <p className="text-blue-600 font-semibold text-sm">₹{clinic.fee}</p>
                      <p className="text-xs text-gray-400">{clinic.fee_estimated ? "approx. fee" : "consult fee"}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 mb-2 flex-wrap text-xs">
                    {clinic.rating != null ? (
                      <span className="text-gray-600"><span className="text-yellow-500">★</span> {clinic.rating} <span className="text-gray-400">({clinic.reviews ?? 0} reviews)</span></span>
                    ) : (
                      <span className="text-gray-400">No ratings yet</span>
                    )}
                    {clinic.wait_minutes != null && <span className="text-gray-400">• ⏱ {clinic.wait_minutes} min wait</span>}
                    <span className="text-gray-400">• 🕒 {clinic.hours_known ? describeHours(clinic.hours) : "Hours not listed"}</span>
                  </div>

                  <div className="flex gap-1 flex-wrap mb-3">
                    {(clinic.kind === "hospital" ? ["Multi-speciality"] : clinic.specialities).map((s) => (
                      <span key={s} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{s}</span>
                    ))}
                    {clinic.doctors.length > 0 && <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">{clinic.doctors.length} doctors</span>}
                  </div>

                  <div className="flex gap-2">
                    <button onClick={() => book(clinic)} disabled={booking === clinic.key}
                      className="flex-1 bg-blue-600 text-white text-xs py-2.5 rounded-xl text-center font-medium hover:bg-blue-700 disabled:opacity-60">
                      {booking === clinic.key ? "Opening…" : "Book Appointment"}
                    </button>
                    <button onClick={() => toggleCompare(clinic)}
                      className={`px-3 py-2.5 rounded-xl text-xs border transition-colors ${compareList.find((c) => c.key === clinic.key) ? "bg-blue-50 border-blue-300 text-blue-600" : "border-gray-200 text-gray-500"}`}>
                      {compareList.find((c) => c.key === clinic.key) ? "✓ Added" : "Compare"}
                    </button>
                    {clinic.phone && (
                      <a href={telHref(clinic.phone)} className="px-3 py-2.5 rounded-xl text-xs border border-gray-200 text-gray-500" title={clinic.phone}>📞</a>
                    )}
                    <a href={directionsUrl(clinic)} target="_blank" rel="noopener noreferrer" className="px-3 py-2.5 rounded-xl text-xs border border-gray-200 text-gray-500" title="Directions">🗺️</a>
                  </div>
                </div>
              ))}

              {location && filtered.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-3xl mb-3">🔍</p>
                  <p className="text-gray-400 text-sm">No clinics match your filters</p>
                  <button onClick={() => { setMaxFee(2000); setMinRating(0); setOnlyMediflow(false); setSelectedSpec("All"); setRadius(10); }}
                    className="mt-3 text-blue-600 text-sm">Reset filters & search wider</button>
                </div>
              )}
            </div>

            {provider && (
              <p className="text-[11px] text-gray-400 text-center mt-6">
                Clinic data {provider === "google" ? "from Google Maps" : "© OpenStreetMap contributors"}. Fees for clinics not yet on Mediflow are approximate — please confirm with the clinic.
              </p>
            )}
          </>
        )}
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
                <div key={clinic.key} className={`rounded-xl p-3 ${i === 0 ? "bg-blue-50" : "bg-green-50"}`}>
                  <p className="font-medium text-sm text-gray-800 mb-3">{clinic.name}</p>
                  <div className="space-y-2">
                    {([
                      ["Consultation fee", `₹${clinic.fee}${clinic.fee_estimated ? " (approx.)" : ""}`],
                      ["Rating", clinic.rating != null ? `${clinic.rating} ★ (${clinic.reviews ?? 0})` : "No ratings yet"],
                      ["Distance", clinic.distance_km != null ? `${clinic.distance_km} km` : "—"],
                      ["Hours", clinic.hours_known ? describeHours(clinic.hours) : "Not listed"],
                      ["Bookings", clinic.on_mediflow ? "Confirmed on Mediflow" : "Call to confirm"],
                      ["Specialities", clinic.kind === "hospital" ? "Multi-speciality hospital" : clinic.specialities.join(", ")],
                    ] as const).map(([label, value]) => (
                      <div key={label}>
                        <p className="text-xs text-gray-500">{label}</p>
                        <p className="text-sm font-semibold text-gray-800">{value}</p>
                      </div>
                    ))}
                    <button onClick={() => book(clinic)}
                      className={`block w-full text-center text-xs py-2 rounded-xl text-white font-medium mt-2 ${i === 0 ? "bg-blue-600" : "bg-green-600"}`}>
                      Book This Clinic
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 p-3 bg-yellow-50 rounded-xl">
              <p className="text-xs text-yellow-700">
                💡 <strong>Mediflow tip:</strong> Lower fee doesn&apos;t always mean lower quality. Check ratings and distance together to make the best decision.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
