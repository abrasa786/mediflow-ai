"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ApiError, apiFetch } from "@/lib/api";

export default function Medicine() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);

  useEffect(() => {
    const check = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) router.push("/login");
    };
    check();
  }, []);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setResults(null);
    try {
      const res = await apiFetch(`/medicine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });
      const data = await res.json();
      // Backend reachable but AI failed / returned nothing useful
      if (data.error || !data.medicines?.length) {
        console.warn("Medicine comparison failed:", data.error);
        setResults({ error: "ai" });
      } else {
        setResults(data);
      }
    } catch (err) {
      setResults({ error: err instanceof ApiError ? (err.status === 401 ? "auth" : "rate") : "network" });
    } finally {
      setLoading(false);
    }
  };

  const suggestions = ["Dolo vs Crocin", "Fever medicine", "Headache", "Cold & cough", "Diabetes", "Vitamin D", "Blood pressure"];

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <div className="bg-blue-600 px-4 pt-5 pb-5">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/home" className="text-white text-xl">←</Link>
          <div>
            <h1 className="text-white font-semibold text-lg">Medicine Comparison</h1>
            <p className="text-blue-200 text-xs">Transparent prices, side effects & ordering</p>
          </div>
        </div>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Search medicine e.g. Dolo vs Crocin..."
            className="flex-1 bg-white rounded-xl px-4 py-3 text-sm text-gray-700 outline-none"
          />
          <button onClick={search} disabled={loading}
            className="bg-white text-blue-600 px-4 py-3 rounded-xl text-sm font-bold disabled:opacity-50">
            {loading ? "..." : "Go"}
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4">

        {/* Suggestions */}
        {!results && !loading && (
          <>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Popular searches</p>
            <div className="flex flex-wrap gap-2 mb-6">
              {suggestions.map((s) => (
                <button key={s} onClick={() => setQuery(s)}
                  className="text-xs bg-white border border-gray-200 text-gray-600 px-3 py-2 rounded-full hover:border-blue-400 hover:text-blue-600 transition-colors">
                  {s}
                </button>
              ))}
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
              <p className="text-sm font-semibold text-blue-800 mb-2">💊 How Mediflow Medicine works</p>
              <div className="space-y-2 text-xs text-blue-700">
                <p>🔍 Search any medicine or symptom</p>
                <p>📊 We compare ALL options — Allopathy, Ayurvedic, Homeopathy</p>
                <p>💰 We show prices across 1mg, Netmeds, PharmEasy & local stores</p>
                <p>⚠️ We show side effects honestly — no hiding anything</p>
                <p>🛒 Order directly — payment on our platform, delivered to you</p>
              </div>
            </div>
          </>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-16">
            <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm text-gray-500">Comparing all medicines transparently...</p>
            <p className="text-xs text-gray-400 mt-1">Checking 1mg, Netmeds, PharmEasy & Ayurvedic options</p>
          </div>
        )}

        {/* Error */}
        {results?.error && (
          <div className="bg-red-50 rounded-2xl p-4 text-sm text-red-600 text-center">
            {results.error === "auth"
              ? "Your session has expired — please log in again."
              : results.error === "rate"
              ? "You're searching a bit fast 😅 Please wait a minute and try again."
              : results.error === "network"
              ? "Can't reach the Mediflow server right now. Please check your connection and try again."
              : `Couldn't load a comparison for “${query.trim()}” right now. Please try again, or check the spelling.`}
            <button onClick={search} className="block mx-auto mt-2 text-sky-600 font-medium underline">Try again</button>
          </div>
        )}

        {/* Results */}
        {results && !results.error && (
          <div className="space-y-4">

            {/* AI Comparison */}
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold">M</div>
                <p className="text-sm font-semibold text-gray-800">Mediflow Transparent Analysis</p>
                <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full ml-auto">No Bias</span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{results.comparison}</p>
            </div>

            {/* Price comparison table */}
            {results.medicines && results.medicines.length > 0 && (
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-3">
                  💰 Price Comparison & Order
                </p>
                <div className="space-y-3">
                  {results.medicines.map((med: any, i: number) => (
                    <div key={i} className="border border-gray-100 rounded-2xl overflow-hidden">

                      {/* Medicine header */}
                      <div className={`px-4 py-3 ${i === 0 ? "bg-blue-50" : i === 1 ? "bg-green-50" : "bg-orange-50"}`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-gray-800">{med.name}</p>
                            <p className="text-xs text-gray-500">{med.type} • {med.origin}</p>
                          </div>
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                            med.type === "Allopathy" ? "bg-blue-100 text-blue-600" :
                            med.type === "Ayurvedic" ? "bg-orange-100 text-orange-600" :
                            "bg-purple-100 text-purple-600"
                          }`}>{med.type}</span>
                        </div>
                      </div>

                      {/* Medicine details */}
                      <div className="px-4 py-3 space-y-2">
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <p className="text-gray-400">Works in</p>
                            <p className="font-medium text-gray-700">{med.works_in}</p>
                          </div>
                          <div>
                            <p className="text-gray-400">Recovery time</p>
                            <p className="font-medium text-gray-700">{med.recovery_time}</p>
                          </div>
                          <div>
                            <p className="text-gray-400">Best for</p>
                            <p className="font-medium text-gray-700">{med.best_for}</p>
                          </div>
                          <div>
                            <p className="text-gray-400">Evidence</p>
                            <p className={`font-medium ${med.evidence === "Strong" ? "text-green-600" : med.evidence === "Moderate" ? "text-yellow-600" : "text-orange-600"}`}>
                              {med.evidence}
                            </p>
                          </div>
                        </div>

                        {/* Side effects */}
                        <div>
                          <p className="text-xs text-red-500 font-medium mb-1">⚠️ Side Effects</p>
                          <p className="text-xs text-gray-600">{med.side_effects}</p>
                        </div>

                        {/* Who should avoid */}
                        <div>
                          <p className="text-xs text-orange-500 font-medium mb-1">🚫 Who should avoid</p>
                          <p className="text-xs text-gray-600">{med.avoid}</p>
                        </div>
                      </div>

                      {/* Platform prices + order */}
                      {med.prices && med.prices.length > 0 && (
                        <div className="border-t border-gray-100 px-4 py-3">
                          <p className="text-xs text-gray-400 mb-2">Best prices — click to order</p>
                          <div className="space-y-2">
                            {med.prices.map((p: any, j: number) => (
                              <div key={j} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-medium text-gray-700 w-20">{p.platform}</span>
                                  <span className="text-xs text-gray-400">{p.pack}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`text-sm font-bold ${j === 0 ? "text-green-600" : "text-gray-700"}`}>
                                    {p.price}
                                  </span>
                                  {j === 0 && <span className="text-xs bg-green-100 text-green-600 px-1.5 py-0.5 rounded">Lowest</span>}
                                  <a href={p.url} target="_blank" rel="noopener noreferrer"
                                    className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-blue-700">
                                    Order
                                  </a>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Disclaimer */}
            <div className="bg-yellow-50 border border-yellow-100 rounded-2xl p-4">
              <p className="text-xs text-yellow-700 leading-relaxed">
                ⚠️ <strong>Mediflow Disclaimer:</strong> All medicine information is for educational purposes only. 
                Prices are approximate and may vary. Always consult a qualified doctor before taking any medicine. 
                Mediflow does not replace professional medical advice.
              </p>
            </div>

            {/* Book doctor */}
            <Link href="/clinics"
              className="block bg-blue-600 text-white text-center py-4 rounded-2xl text-sm font-medium hover:bg-blue-700">
              🏥 Consult a Doctor for Proper Prescription →
            </Link>

            <button onClick={() => { setResults(null); setQuery(""); }}
              className="w-full border border-gray-200 text-gray-500 py-3 rounded-2xl text-sm hover:bg-gray-50">
              Search Another Medicine
            </button>
          </div>
        )}
      </div>
    </div>
  );
}