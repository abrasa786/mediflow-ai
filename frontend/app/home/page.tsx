"use client";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLocation } from "@/hooks/useLocation";
import MediflowChat from "@/components/chat/MediflowChat";
import { getPatientProfile, onboardedKey } from "@/lib/patient";
import { getUpcomingAppointments, type Appointment } from "@/lib/appointments";

export default function Home() {
  const router = useRouter();
  // Silently request location after login — cached in localStorage as "mediflow_location"
  const { location, requestLocation } = useLocation();
  const [patient, setPatient] = useState<any>(null);
  const [upcoming, setUpcoming] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [factIndex, setFactIndex] = useState(0);
  const searchRef = useRef<HTMLDivElement>(null);

  const healthFacts = [
    "🫀 Your heart beats about 100,000 times every day",
    "🧠 The human brain generates about 20 watts of power",
    "💧 60% of the human body is made of water",
    "🦷 Tooth enamel is the hardest substance in the human body",
    "👁️ Your eyes can distinguish about 10 million different colors",
    "🫁 Adults breathe about 20,000 times a day",
    "🦴 Babies are born with 270 bones — adults have only 206",
    "❤️ A woman's heart beats slightly faster than a man's",
  ];

  const specialities = [
    { icon: "🩺", name: "General" }, { icon: "🦷", name: "Dentist", spec: "Dental" },
    { icon: "👁️", name: "Eye" }, { icon: "🧠", name: "Neuro" },
    { icon: "🫀", name: "Cardio" }, { icon: "🦴", name: "Ortho" },
    { icon: "👶", name: "Pediatric" }, { icon: "🧬", name: "Skin" },
    { icon: "🤰", name: "Gynecology" }, { icon: "🦻", name: "ENT" },
    { icon: "🧘", name: "Psychiatry" }, { icon: "🦵", name: "Physio" },
  ];

  const healthTips = [
    {
      title: "AI Fitness Coach",
      desc: "Reduce belly fat with weekly photo transformation, daily food tracking, and personalised diet plans",
      icon: "🔥",
      href: "/fitness",
      features: ["📸 Weekly body transformation pics", "🍽️ Daily food photo tracking", "⏰ Meal & workout reminders", "📊 Progress analytics"]
    },
    {
      title: "Track Daily Steps",
      desc: "Set goals, track walks, and earn health points every day",
      icon: "👣",
      href: "/fitness",
      features: ["🎯 Daily step goals", "🏆 Health points reward", "📈 Weekly progress", "🔔 Movement reminders"]
    },
    {
      title: "Blood Report Analysis",
      desc: "Upload your blood report — AI explains every value in simple language",
      icon: "🩸",
      href: "/chat?start=report",
      features: ["🧬 AI explains results", "⚠️ Flags abnormal values", "💊 Medicine suggestions", "📋 Health summary"]
    },
    {
      title: "Know Your Body",
      desc: "Generate your complete health report and understand your body better",
      icon: "🧬",
      href: "/fitness",
      features: ["📏 BMI calculator", "💪 Body composition", "🫀 Heart health score", "🧠 Mental wellness check"]
    },
  ];

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const data = await getPatientProfile(user);
      // New users finish the 60-second onboarding first (column exists only after the migration)
      let onboardedLocally = false;
      try { onboardedLocally = localStorage.getItem(onboardedKey(user.id)) === "1"; } catch {}
      if (data && "onboarded_at" in data && !data.onboarded_at && !onboardedLocally) { router.push("/onboarding"); return; }
      setPatient(data);
      setLoading(false);
      requestLocation();
      getUpcomingAppointments(user.id).then(setUpcoming).catch(() => setUpcoming([]));
    };
    getUser();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setFactIndex(prev => (prev + 1) % healthFacts.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchResults([]);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const search = async () => {
      if (!searchQuery.trim() || searchQuery.length < 2) {
        setSearchResults([]);
        return;
      }
      const { data } = await supabase
        .from("clinics")
        .select("*")
        .or(`name.ilike.%${searchQuery}%,area.ilike.%${searchQuery}%`)
        .limit(6);
      setSearchResults(data || []);
    };
    const debounce = setTimeout(search, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (loading) return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-white">

      {/* NAVBAR */}
      <nav className="bg-sky-500 sticky top-0 z-40 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-sky-500 font-bold text-sm">M</div>
            <span className="font-bold text-white text-lg">Mediflow AI</span>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm text-sky-100">
            <Link href="/chat?start=book" className="hover:text-white transition-colors">Book Appointment</Link>
            <span className="opacity-60 cursor-default" title="Coming soon">Video Consult <span className="text-[10px] bg-white/20 rounded px-1">Soon</span></span>
            <span className="opacity-60 cursor-default" title="Coming soon">Lab Tests <span className="text-[10px] bg-white/20 rounded px-1">Soon</span></span>
            <Link href="/medicine" className="hover:text-white transition-colors">Medicines</Link>
            <Link href="/fitness" className="hover:text-white transition-colors">Fitness AI</Link>
            <Link href="/clinics" className="hover:text-white transition-colors">Find Doctors</Link>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/emergency" className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm" title="Emergency SOS">
              🆘 SOS
            </Link>
            <Link href="/profile" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-sky-500 text-sm font-bold">
                {patient?.name?.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm text-white hidden md:block">{patient?.name}</span>
            </Link>
            <button onClick={handleLogout} className="text-xs text-sky-100 hover:text-white">Logout</button>
          </div>
        </div>
      </nav>

      {/* HEALTH FACT TICKER */}
      <div className="bg-sky-600 text-white text-center py-2 text-xs font-medium">
        💡 {healthFacts[factIndex]}
      </div>

      {/* HERO BANNER */}
      <div className="relative bg-gradient-to-br from-sky-400 via-sky-500 to-sky-700 text-white py-12 px-4 overflow-hidden">

        {/* Doctor SVG */}
        <svg className="absolute right-0 top-0 h-full opacity-10 pointer-events-none select-none"
          viewBox="0 0 400 500" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="200" cy="100" r="70" stroke="#ff4444" strokeWidth="6" fill="none"/>
          <path d="M100 200 Q100 170 200 160 Q300 170 300 200 L320 400 H80 Z" stroke="#ff4444" strokeWidth="6" fill="none"/>
          <path d="M150 220 Q140 260 150 290 Q160 320 190 320 Q220 320 230 290 Q240 260 230 220" stroke="#ff4444" strokeWidth="6" fill="none"/>
          <circle cx="190" cy="330" r="18" stroke="#ff4444" strokeWidth="6" fill="none"/>
          <line x1="185" y1="260" x2="215" y2="260" stroke="#ff4444" strokeWidth="6"/>
          <line x1="200" y1="245" x2="200" y2="275" stroke="#ff4444" strokeWidth="6"/>
          <path d="M100 200 L60 300" stroke="#ff4444" strokeWidth="6" fill="none"/>
          <path d="M300 200 L340 300" stroke="#ff4444" strokeWidth="6" fill="none"/>
          <path d="M160 160 L200 210 L240 160" stroke="#ff4444" strokeWidth="5" fill="none"/>
          <rect x="140" y="35" width="120" height="18" rx="4" stroke="#ff4444" strokeWidth="5" fill="none"/>
          <path d="M155 35 L165 0 L235 0 L245 35" stroke="#ff4444" strokeWidth="5" fill="none"/>
        </svg>

        {/* Heartbeat */}
        <svg className="absolute bottom-0 left-0 w-full opacity-10 pointer-events-none"
          viewBox="0 0 800 80" fill="none">
          <polyline points="0,40 100,40 150,40 180,5 200,75 220,5 240,40 300,40 350,40 380,10 400,70 420,10 440,40 600,40 800,40"
            stroke="#ff4444" strokeWidth="3" fill="none"/>
        </svg>

        <div className="max-w-6xl mx-auto relative z-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8">

            {/* Left */}
            <div className="flex-1">
              <p className="text-sky-100 text-sm mb-2">Good day, {patient?.name?.split(" ")[0]} 👋</p>
              <h1 className="text-3xl md:text-4xl font-bold mb-3 leading-tight">
                Healthcare that's finally<br />
                <span className="text-yellow-300">100% transparent</span>
              </h1>
              <p className="text-sky-100 text-sm mb-6">No hidden fees. No lost records. Your health, your control.</p>

              {/* LIVE SEARCH */}
              <div className="relative max-w-lg" ref={searchRef}>
                <div className="flex items-center gap-2 bg-white rounded-2xl px-4 py-3 shadow-lg">
                  <span className="text-sky-500">📍</span>
                  <span className="text-gray-500 text-sm border-r border-gray-200 pr-3 mr-1 whitespace-nowrap">{location?.city || "Bengaluru"}</span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search doctors, clinics, hospitals..."
                    className="flex-1 text-sm text-gray-700 outline-none bg-transparent"
                    autoComplete="off"
                  />
                  {searchQuery && (
                    <button onClick={() => { setSearchQuery(""); setSearchResults([]); }}
                      className="text-gray-400 hover:text-gray-600 text-lg leading-none mr-1">×</button>
                  )}
                  <button className="bg-sky-500 text-white text-xs px-4 py-2 rounded-xl hover:bg-sky-600 whitespace-nowrap">
                    Search
                  </button>
                </div>

                {searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-white rounded-2xl shadow-2xl border border-gray-100 mt-2 z-50 overflow-hidden">
                    <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                      <p className="text-xs text-gray-400 font-medium">Clinics matching "{searchQuery}"</p>
                    </div>
                    {searchResults.map((clinic) => (
                      <Link key={clinic.id} href={`/book?clinic=${clinic.id}`}
                        onClick={() => { setSearchResults([]); setSearchQuery(""); }}
                        className="flex items-center justify-between px-4 py-3 hover:bg-sky-50 border-b border-gray-50 last:border-0 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-sky-100 rounded-xl flex items-center justify-center flex-shrink-0">🏥</div>
                          <div>
                            <p className="text-sm font-semibold text-gray-800">{clinic.name}</p>
                            <p className="text-xs text-gray-400">📍 {clinic.area} • {clinic.specialities?.slice(0, 2).join(", ")}</p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-3">
                          <p className="text-sm font-bold text-sky-600">₹{clinic.consultation_fee}</p>
                          <p className="text-xs text-yellow-500">★ {clinic.rating}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}

                {searchQuery.length >= 2 && searchResults.length === 0 && (
                  <div className="absolute top-full left-0 right-0 bg-white rounded-2xl shadow-xl border border-gray-100 mt-2 z-50 p-4 text-center">
                    <p className="text-sm text-gray-400 mb-1">No clinics found for "{searchQuery}"</p>
                    <Link href="/clinics" className="text-xs text-sky-600 font-medium">Browse all clinics →</Link>
                  </div>
                )}
              </div>
            </div>

            {/* Patient ID card */}
            <div className="bg-sky-900 bg-opacity-80 backdrop-blur rounded-2xl p-5 min-w-56 border border-sky-300 border-opacity-30 flex-shrink-0 shadow-xl">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 bg-sky-400 rounded-lg flex items-center justify-center">
                  <span className="text-white text-sm">🆔</span>
                </div>
                <p className="text-sky-200 text-xs font-medium">Your Health Passport</p>
              </div>
              <p className="text-2xl font-bold tracking-widest text-white mb-1">
                {patient?.patient_id || "Generating…"}
              </p>
              <p className="text-sky-300 text-xs mb-4">Show at any Mediflow clinic</p>
              <div className="h-px bg-sky-600 mb-4" />
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="bg-sky-800 rounded-xl p-3">
                  <p className="text-2xl font-bold text-white">{upcoming.length}</p>
                  <p className="text-xs text-sky-300 mt-0.5">Upcoming</p>
                </div>
                <div className="bg-sky-800 rounded-xl p-3">
                  <p className="text-2xl font-bold text-white">0</p>
                  <p className="text-xs text-sky-300 mt-0.5">Reports</p>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* QUICK STATS */}
      <div className="max-w-6xl mx-auto px-4 mt-6 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-3">
            <div className="w-10 h-10 bg-sky-100 rounded-xl flex items-center justify-center text-xl">🏥</div>
            <div>
              <p className="text-lg font-bold text-gray-800">1,500+</p>
              <p className="text-xs text-gray-400">Clinics on Mediflow</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-3">
            <div className="w-10 h-10 bg-sky-100 rounded-xl flex items-center justify-center text-xl">👨‍⚕️</div>
            <div>
              <p className="text-lg font-bold text-gray-800">5,000+</p>
              <p className="text-xs text-gray-400">Verified Doctors</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-3">
            <div className="w-10 h-10 bg-sky-100 rounded-xl flex items-center justify-center text-xl">📅</div>
            <div>
              <p className="text-lg font-bold text-gray-800">50,000+</p>
              <p className="text-xs text-gray-400">Appointments Booked</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-3">
            <div className="w-10 h-10 bg-sky-100 rounded-xl flex items-center justify-center text-xl">⭐</div>
            <div>
              <p className="text-lg font-bold text-gray-800">4.8/5</p>
              <p className="text-xs text-gray-400">Average Rating</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4">

        {/* AD BANNER */}
        <div className="bg-gradient-to-r from-sky-500 to-sky-700 rounded-2xl p-5 mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-sky-200 font-medium mb-1">🎉 Limited time offer</p>
            <p className="font-bold text-white text-lg">Free health checkup for new users!</p>
            <p className="text-sky-100 text-sm">Book your first appointment and get a basic health report free</p>
          </div>
          <Link href="/clinics" className="bg-white text-sky-600 font-bold text-sm px-5 py-3 rounded-xl whitespace-nowrap hover:shadow-md flex-shrink-0">
            Book Free →
          </Link>
        </div>

        {/* FIND BY SPECIALITY */}
        <div className="bg-white rounded-2xl p-5 shadow-sm mb-6 border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-gray-800">Find by Speciality</h2>
            <Link href="/clinics" className="text-xs text-sky-600 font-medium">See all →</Link>
          </div>
          <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-3">
            {specialities.map((s) => (
              <Link href={`/clinics?spec=${encodeURIComponent((s as { spec?: string }).spec ?? s.name)}`} key={s.name} className="flex flex-col items-center gap-1.5 group">
                <div className="w-12 h-12 bg-sky-50 rounded-xl flex items-center justify-center text-xl group-hover:bg-sky-100 transition-colors">
                  {s.icon}
                </div>
                <span className="text-xs text-gray-600 text-center">{s.name}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* HEALTH & FITNESS */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-800">Your Health & Fitness</h2>
            <Link href="/fitness" className="text-xs text-sky-600 font-medium">Explore →</Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {healthTips.map((tip) => (
              <Link key={tip.title} href={tip.href}
                className="bg-white rounded-2xl p-4 shadow-sm hover:shadow-md transition-all border border-gray-100 hover:border-sky-200 group">
                <div className="text-3xl mb-2">{tip.icon}</div>
                <h3 className="font-semibold text-gray-800 text-sm mb-1">{tip.title}</h3>
                <p className="text-xs text-gray-400 leading-relaxed mb-3">{tip.desc}</p>
                <div className="space-y-1.5">
                  {tip.features.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-500 bg-sky-50 rounded-lg px-2 py-1">
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-xs text-sky-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  Open →
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* UPCOMING APPOINTMENTS */}
        <div className="bg-white rounded-2xl p-5 shadow-sm mb-6 border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-800">Upcoming Appointments</h2>
            <div className="flex items-center gap-3">
              {upcoming.length > 0 && <Link href="/profile" className="text-xs text-gray-500 font-medium">Manage</Link>}
              <Link href="/chat?start=book" className="text-xs text-sky-600 font-medium">+ Book new</Link>
            </div>
          </div>
          {upcoming.length > 0 ? (
            <div className="space-y-2">
              {upcoming.slice(0, 3).map((a) => (
                <Link key={a.id} href="/profile" className="flex items-center justify-between gap-3 p-3 rounded-xl border border-gray-100 hover:border-sky-200 hover:bg-sky-50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 bg-sky-100 rounded-xl flex flex-col items-center justify-center flex-shrink-0">
                      <span className="text-[10px] text-sky-600 font-semibold uppercase leading-none">
                        {new Date(a.appointment_date + "T00:00").toLocaleDateString("en-IN", { month: "short" })}
                      </span>
                      <span className="text-base font-bold text-sky-700 leading-tight">{a.appointment_date.slice(8, 10)}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{a.doctor_name}</p>
                      <p className="text-xs text-gray-400 truncate">{a.clinic_name} · {a.clinic_area}</p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold text-sky-600">{a.appointment_time}</p>
                    <p className="text-xs text-gray-400">₹{a.consultation_fee}</p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="text-3xl mb-2">📋</p>
              <p className="text-gray-400 text-sm mb-3">No upcoming appointments</p>
              <Link href="/chat?start=book" className="inline-block bg-sky-500 text-white text-xs px-5 py-2.5 rounded-xl hover:bg-sky-600">
                Find a doctor nearby →
              </Link>
            </div>
          )}
        </div>

        {/* HEALTH FACTS */}
        <div className="bg-sky-50 rounded-2xl p-5 mb-8 border border-sky-100">
          <h2 className="font-bold text-gray-800 mb-3">🧠 Did you know?</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {healthFacts.slice(0, 4).map((fact, i) => (
              <div key={i} className="bg-white rounded-xl p-3 text-sm text-gray-600 shadow-sm border border-sky-50">
                {fact}
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* FLOATING AI CHAT BUBBLE */}
      <div className="fixed bottom-6 right-6 z-50">
        {chatOpen && (
          <div className="mb-4 w-[calc(100vw-3rem)] sm:w-[400px] h-[min(640px,calc(100dvh-8rem))] bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
            <MediflowChat variant="widget" onClose={() => setChatOpen(false)} />
          </div>
        )}
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className="w-14 h-14 bg-sky-500 rounded-full shadow-lg flex items-center justify-center hover:bg-sky-600 transition-colors relative"
        >
          <span className="text-2xl">{chatOpen ? "✕" : "🤖"}</span>
          {!chatOpen && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white" />
          )}
        </button>
      </div>

    </div>
  );
}