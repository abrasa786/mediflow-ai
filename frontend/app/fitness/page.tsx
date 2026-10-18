"use client";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { getPatientProfile, updateBodyStats } from "@/lib/patient";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

type Message = { role: "user" | "ai"; text: string; };

export default function Fitness() {
  const router = useRouter();
  const [patient, setPatient] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("onboarding");
  const [pageLoading, setPageLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  // AI Coach
  const [messages, setMessages] = useState<Message[]>([
    { role: "ai", text: "Hi! I am your personal AI Fitness Coach 💪 What is your main goal? Lose fat, Build muscle, Stay healthy, or Improve diet?" }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // Onboarding
  const [onboardingStarted, setOnboardingStarted] = useState(false);
  const [onboardingMessages, setOnboardingMessages] = useState<Message[]>([]);
  const [onboardingInput, setOnboardingInput] = useState("");
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  // Body stats
  const [bodyStats, setBodyStats] = useState({
    height: "", weight: "", age: "", gender: "male",
    goal: "lose_fat", activityLevel: "moderate"
  });
  const [bmi, setBmi] = useState<number | null>(null);

  // Food
  const [foodInput, setFoodInput] = useState("");
  const [foodLog, setFoodLog] = useState<any[]>([]);
  const [analyzingFood, setAnalyzingFood] = useState(false);

  // Steps
  const [steps, setSteps] = useState(0);
  const [stepsGoal] = useState(10000);
  const [autoStepsActive, setAutoStepsActive] = useState(false);
  const stepCountRef = useRef(0);
  const lastAccelRef = useRef({ x: 0, y: 0, z: 0 });
  const stepThreshold = 12;

  // Gym
  const [gymIn, setGymIn] = useState<string | null>(null);
  const [gymOut, setGymOut] = useState<string | null>(null);
  const [gymMinutes, setGymMinutes] = useState(0);

  // Meal plan
  const [mealPlan, setMealPlan] = useState<any>(null);
  const [generatingPlan, setGeneratingPlan] = useState(false);

  // Blood report
  const [bloodReport, setBloodReport] = useState<string | null>(null);
  const [bloodAnalysis, setBloodAnalysis] = useState<string | null>(null);
  const [analyzingBlood, setAnalyzingBlood] = useState(false);

  // Weekly data
  const [weeklyData] = useState([
    { day: "Mon", calories: 1650, steps: 6200, protein: 72 },
    { day: "Tue", calories: 1820, steps: 8100, protein: 85 },
    { day: "Wed", calories: 1540, steps: 5400, protein: 68 },
    { day: "Thu", calories: 1780, steps: 9200, protein: 91 },
    { day: "Fri", calories: 1620, steps: 7800, protein: 78 },
    { day: "Sat", calories: 2100, steps: 4200, protein: 62 },
    { day: "Sun", calories: 1480, steps: 11000, protein: 88 },
  ]);

  const tabs = [
    { id: "onboarding", label: "👋 Start Here" },
    { id: "coach", label: "🤖 AI Coach" },
    { id: "stats", label: "📊 My Body" },
    { id: "food", label: "🍽️ Meals" },
    { id: "steps", label: "👣 Steps" },
    { id: "progress", label: "📈 Progress" },
    { id: "mealplan", label: "📋 Meal Plan" },
    { id: "workouts", label: "💪 Workouts" },
    { id: "bloodreport", label: "🩸 Blood Report" },
    { id: "subscribe", label: "🥗 Meal Delivery" },
  ];

  const mealPartners = [
    { name: "FreshMenu", desc: "Healthy chef-cooked meals delivered daily", price: "₹180/meal", tag: "Popular" },
    { name: "EatFit", desc: "Nutritionist-approved calorie-controlled meals", price: "₹150/meal", tag: "Budget" },
    { name: "Grow Fit", desc: "Therapeutic diet meals for medical conditions", price: "₹220/meal", tag: "Medical" },
    { name: "Sahaj Meals", desc: "Traditional Indian healthy home-style cooking", price: "₹120/meal", tag: "Desi" },
  ];

  const workouts = [
    { name: "Morning Walk", duration: "30 min", calories: "150 cal", level: "Beginner", steps: ["Start with 5 min slow walk", "Increase pace for 20 min", "Cool down 5 min slow walk", "Stretch for 5 min"] },
    { name: "Home Cardio", duration: "20 min", calories: "200 cal", level: "Intermediate", steps: ["Jumping jacks 3 sets of 20", "High knees 3 sets of 30 sec", "Burpees 3 sets of 10", "Mountain climbers 3 sets of 20"] },
    { name: "Core Workout", duration: "15 min", calories: "100 cal", level: "Beginner", steps: ["Plank 3 sets of 30 sec", "Crunches 3 sets of 15", "Leg raises 3 sets of 10", "Russian twists 3 sets of 20"] },
    { name: "Yoga for Fat Loss", duration: "40 min", calories: "180 cal", level: "Beginner", steps: ["Sun salutation 5 rounds", "Warrior pose 2 min each side", "Boat pose 3 sets of 30 sec", "Childs pose 5 min rest"] },
    { name: "Strength Training", duration: "45 min", calories: "300 cal", level: "Advanced", steps: ["Squats 4 sets of 12", "Push-ups 4 sets of 15", "Dumbbell rows 3 sets of 12", "Lunges 3 sets of 10 each leg"] },
    { name: "HIIT Session", duration: "25 min", calories: "350 cal", level: "Advanced", steps: ["Warm up 3 min jog", "Sprint 30 sec rest 30 sec 10 rounds", "Burpees 2 min", "Cool down 3 min walk"] },
  ];

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const data = await getPatientProfile(user);
      setPatient(data);
      // Prefill saved body stats (updateBodyStats on /profile or below)
      if (data?.height || data?.weight) {
        const saved = {
          height: data.height ? String(data.height) : "",
          weight: data.weight ? String(data.weight) : "",
          age: data.age ? String(data.age) : "",
          gender: data.gender || "male",
          goal: data.goal || "lose_fat",
          activityLevel: data.activity_level || "moderate",
        };
        setBodyStats(saved);
        const h = Number(saved.height) / 100, w = Number(saved.weight);
        if (h && w) setBmi(Math.round(w / (h * h) * 10) / 10);
      }
      setPageLoading(false);
    };
    getUser();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, onboardingMessages]);

  const calculateBMI = () => {
    const h = parseFloat(bodyStats.height) / 100;
    const w = parseFloat(bodyStats.weight);
    if (h && w) setBmi(Math.round(w / (h * h) * 10) / 10);
    // Persist so stats survive a refresh (needs the patients body-stat columns)
    if (patient?.id) {
      updateBodyStats(patient.id, {
        height: Number(bodyStats.height) || null,
        weight: Number(bodyStats.weight) || null,
        age: Number(bodyStats.age) || null,
        gender: bodyStats.gender,
        goal: bodyStats.goal,
        activity_level: bodyStats.activityLevel,
      });
    }
  };

  const getBMICategory = (bmi: number) => {
    if (bmi < 18.5) return { label: "Underweight", color: "text-blue-600", bg: "bg-blue-50" };
    if (bmi < 25) return { label: "Normal weight", color: "text-green-600", bg: "bg-green-50" };
    if (bmi < 30) return { label: "Overweight", color: "text-yellow-600", bg: "bg-yellow-50" };
    return { label: "Obese", color: "text-red-600", bg: "bg-red-50" };
  };

  const speak = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text.replace(/[🌟💪🔥❤️🥗😊✅🎯📊🏆]/g, ""));
    utter.rate = 0.88;
    utter.pitch = 1.05;
    utter.onend = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utter);
  };

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setSpeaking(false);
  };

  const startOnboarding = () => {
    setOnboardingStarted(true);
    const hr = new Date().getHours();
    const greeting = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
    const name = patient?.name?.split(" ")[0] || "there";
    const msg = `${greeting}, ${name}! I am so excited to be your personal AI Health Coach today! 🌟

I am going to ask you a few simple questions to understand you better and create a personalised health plan just for you.

First things first — what brought you here today? What is the ONE thing you really want to achieve?

For example:
🔥 I want to lose belly fat
💪 I want to build muscle
❤️ I want to feel more energetic
🥗 I want to eat healthier and fix my diet`;

    setOnboardingMessages([{ role: "ai", text: msg }]);
    speak(`${greeting} ${name}! I am your personal AI Health Coach. I am so happy you are here. Tell me, what is the one thing you really want to achieve with your health?`);
  };

  const sendOnboarding = async () => {
    if (!onboardingInput.trim()) return;
    const msg = onboardingInput.trim();
    setOnboardingInput("");
    setOnboardingMessages(prev => [...prev, { role: "user", text: msg }]);
    setOnboardingLoading(true);
    try {
      const res = await apiFetch(`/fitness-coach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, bodyStats, bmi }),
      });
      const data = await res.json();
      setOnboardingMessages(prev => [...prev, { role: "ai", text: data.reply }]);
      speak(data.reply);
    } catch {
      setOnboardingMessages(prev => [...prev, { role: "ai", text: "Sorry, connection error. Please try again." }]);
    } finally {
      setOnboardingLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim()) return;
    const userMsg = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", text: userMsg }]);
    setLoading(true);
    try {
      const res = await apiFetch(`/fitness-coach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg, bodyStats, bmi }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: "ai", text: data.reply }]);
    } catch {
      setMessages(prev => [...prev, { role: "ai", text: "Connection error. Please try again." }]);
    } finally {
      setLoading(false);
    }
  };

  const analyzeFood = async () => {
    if (!foodInput.trim()) return;
    setAnalyzingFood(true);
    try {
      const res = await apiFetch(`/analyze-food`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ food: foodInput }),
      });
      const data = await res.json();
      setFoodLog(prev => [...prev, {
        food: foodInput, calories: data.calories, protein: data.protein,
        carbs: data.carbs, fat: data.fat, suggestion: data.suggestion,
        time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
      }]);
      setFoodInput("");
    } catch { alert("Error. Please try again."); }
    finally { setAnalyzingFood(false); }
  };

  const generateMealPlan = async () => {
    setGeneratingPlan(true);
    try {
      const res = await apiFetch(`/meal-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodyStats, bmi }),
      });
      const data = await res.json();
      setMealPlan(data);
    } catch { alert("Error. Please try again."); }
    finally { setGeneratingPlan(false); }
  };

  const startAutoStepCount = async () => {
    if (typeof DeviceMotionEvent === "undefined") {
      alert("Motion sensor not available. Please use manual entry or open on mobile.");
      return;
    }
    if (typeof (DeviceMotionEvent as any).requestPermission === "function") {
      try {
        const perm = await (DeviceMotionEvent as any).requestPermission();
        if (perm !== "granted") { alert("Motion permission denied."); return; }
      } catch { alert("Could not request permission."); return; }
    }
    setAutoStepsActive(true);
    let lastPeak = false;
    const handleMotion = (e: DeviceMotionEvent) => {
      const acc = e.accelerationIncludingGravity;
      if (!acc) return;
      const x = acc.x || 0, y = acc.y || 0, z = acc.z || 0;
      const mag = Math.sqrt(x*x + y*y + z*z);
      const prev = lastAccelRef.current;
      const delta = Math.abs(mag - Math.sqrt(prev.x**2 + prev.y**2 + prev.z**2));
      if (delta > stepThreshold && !lastPeak) {
        lastPeak = true;
        stepCountRef.current += 1;
        setSteps(stepCountRef.current);
      } else if (delta < stepThreshold / 2) {
        lastPeak = false;
      }
      lastAccelRef.current = { x, y, z };
    };
    window.addEventListener("devicemotion", handleMotion);
    (window as any)._stepListener = handleMotion;
  };

  const stopAutoStepCount = () => {
    if ((window as any)._stepListener) {
      window.removeEventListener("devicemotion", (window as any)._stepListener);
      delete (window as any)._stepListener;
    }
    setAutoStepsActive(false);
  };

  const gymCheckIn = () => {
    setGymIn(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
    setGymOut(null);
    setGymMinutes(0);
  };

  const gymCheckOut = () => {
    const now = new Date();
    setGymOut(now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
    if (gymIn) {
      const [h, m] = gymIn.split(":").map(Number);
      const inTime = new Date();
      inTime.setHours(h, m, 0);
      const diff = Math.round((now.getTime() - inTime.getTime()) / 60000);
      setGymMinutes(diff > 0 ? diff : 60);
    }
  };

  const handleBloodUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBloodReport(file.name);
    setAnalyzingBlood(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const res = await apiFetch(`/analyze-blood-report`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            report_text: ev.target?.result as string,
            bodyStats, bmi
          }),
        });
        const data = await res.json();
        setBloodAnalysis(data.analysis);
      } catch {
        setBloodAnalysis("Error analyzing report. Please try again.");
      } finally {
        setAnalyzingBlood(false);
      }
    };
    reader.readAsText(file);
  };

  const speakDailySummary = () => {
    const name = patient?.name?.split(" ")[0] || "there";
    const summary = `Good ${new Date().getHours() < 12 ? "morning" : "afternoon"} ${name}! Here is your daily health summary. Today you have walked ${steps.toLocaleString()} steps out of your goal of ${stepsGoal.toLocaleString()} steps. Your total calories today are ${totalCalories} calories. ${gymMinutes > 0 ? `You spent ${gymMinutes} minutes at the gym today. Excellent work!` : "Do not forget to log your workout today."} ${bmi ? `Your BMI is ${bmi}, which is ${getBMICategory(bmi).label}.` : "Please enter your body stats to calculate your BMI."} ${foodLog.length > 0 ? `You have logged ${foodLog.length} meals today. Keep it up!` : "You have not logged any meals today. Remember to track your food."} Keep going, you are doing amazing!`;
    speak(summary);
  };

  const totalCalories = foodLog.reduce((s, f) => s + (f.calories || 0), 0);

  if (pageLoading) return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <div className="bg-gradient-to-br from-sky-500 to-sky-700 text-white px-4 pt-5 pb-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-3">
            <Link href="/home" className="text-white text-xl">&#8592;</Link>
            <div className="flex-1">
              <h1 className="font-bold text-xl">AI Fitness Coach</h1>
              <p className="text-sky-100 text-xs">Your personal trainer, dietitian and health coach</p>
            </div>
            <button onClick={speaking ? stopSpeaking : speakDailySummary}
              className={`px-3 py-2 rounded-xl text-xs font-medium ${speaking ? "bg-red-500 text-white" : "bg-white text-sky-600"}`}>
              {speaking ? "⏹ Stop" : "🔊 Daily Summary"}
            </button>
          </div>
          {bmi && (
            <div className="grid grid-cols-4 gap-2">
              <div className="bg-white bg-opacity-15 rounded-xl p-2 text-center">
                <p className="font-bold text-sm">{bodyStats.weight}kg</p>
                <p className="text-xs text-sky-200">Weight</p>
              </div>
              <div className="bg-white bg-opacity-15 rounded-xl p-2 text-center">
                <p className="font-bold text-sm">{bmi}</p>
                <p className="text-xs text-sky-200">BMI</p>
              </div>
              <div className="bg-white bg-opacity-15 rounded-xl p-2 text-center">
                <p className="font-bold text-sm">{steps.toLocaleString()}</p>
                <p className="text-xs text-sky-200">Steps</p>
              </div>
              <div className="bg-white bg-opacity-15 rounded-xl p-2 text-center">
                <p className="font-bold text-sm">{totalCalories}</p>
                <p className="text-xs text-sky-200">Cal today</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto py-2 no-scrollbar">
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                  activeTab === tab.id ? "bg-sky-500 text-white" : "text-gray-500 hover:bg-gray-100"
                }`}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-4">

        {/* ─── ONBOARDING ─── */}
        {activeTab === "onboarding" && (
          <div className="space-y-4">
            {!onboardingStarted ? (
              <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 text-center">
                <div className="text-6xl mb-4">👋</div>
                <h2 className="text-xl font-bold text-gray-800 mb-2">
                  Welcome, {patient?.name?.split(" ")[0]}!
                </h2>
                <p className="text-gray-400 text-sm mb-6 leading-relaxed">
                  Your AI Health Coach will <strong>speak to you</strong>, understand your lifestyle,
                  daily routine, food habits, and set personalised goals just for you.
                  <br /><br />
                  Make sure your <strong>sound is ON</strong>
                </p>
                <div className="grid grid-cols-3 gap-3 mb-6">
                  {[
                    { icon: "🎯", text: "Sets your goals" },
                    { icon: "🗣️", text: "Speaks to you" },
                    { icon: "📊", text: "Tracks progress" },
                  ].map((f, i) => (
                    <div key={i} className="bg-sky-50 rounded-xl p-3">
                      <div className="text-2xl mb-1">{f.icon}</div>
                      <p className="text-xs text-sky-700 font-medium">{f.text}</p>
                    </div>
                  ))}
                </div>
                <button onClick={startOnboarding}
                  className="w-full bg-sky-500 text-white py-4 rounded-2xl text-sm font-bold hover:bg-sky-600">
                  Start My Health Journey 🚀
                </button>
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="bg-sky-500 px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-sky-500 font-bold text-sm">AI</div>
                    <div>
                      <p className="text-white font-semibold text-sm">AI Health Coach</p>
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                        <p className="text-sky-100 text-xs">Online — Turn on sound to hear me</p>
                      </div>
                    </div>
                  </div>
                  <button onClick={speaking ? stopSpeaking : () => {
                    if (onboardingMessages.length > 0) speak(onboardingMessages[onboardingMessages.length - 1].text);
                  }}
                    className={`text-xs px-3 py-1.5 rounded-xl font-medium ${speaking ? "bg-red-500 text-white" : "bg-white text-sky-500"}`}>
                    {speaking ? "⏹ Stop" : "🔊 Replay"}
                  </button>
                </div>

                <div className="h-80 overflow-y-auto p-4 space-y-3 bg-gray-50">
                  {onboardingMessages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      {msg.role === "ai" && (
                        <div className="w-7 h-7 bg-sky-500 rounded-full flex items-center justify-center text-white text-xs font-bold mr-2 flex-shrink-0 mt-1">AI</div>
                      )}
                      <div className={`max-w-sm px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.role === "user"
                          ? "bg-sky-500 text-white rounded-tr-none"
                          : "bg-white text-gray-800 border border-gray-100 rounded-tl-none shadow-sm"
                      }`}>{msg.text}</div>
                    </div>
                  ))}
                  {onboardingLoading && (
                    <div className="flex justify-start">
                      <div className="w-7 h-7 bg-sky-500 rounded-full flex items-center justify-center text-white text-xs font-bold mr-2">AI</div>
                      <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3">
                        <div className="flex gap-1">
                          <div className="w-2 h-2 bg-sky-300 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <div className="w-2 h-2 bg-sky-300 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <div className="w-2 h-2 bg-sky-300 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>

                <div className="px-4 py-2 border-t border-gray-100 bg-white">
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {["I want to lose weight", "I want to build muscle", "I have a desk job", "I eat mostly Indian food", "I go to gym 3 times a week", "I want more energy"].map(q => (
                      <button key={q} onClick={() => setOnboardingInput(q)}
                        className="flex-shrink-0 text-xs bg-sky-50 text-sky-600 border border-sky-200 px-3 py-1.5 rounded-full hover:bg-sky-100">
                        {q}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-3 bg-white border-t border-gray-100 flex gap-2">
                  <input value={onboardingInput}
                    onChange={e => setOnboardingInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && sendOnboarding()}
                    placeholder="Tell your coach anything..."
                    className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400" />
                  <button onClick={sendOnboarding} disabled={onboardingLoading || !onboardingInput.trim()}
                    className="bg-sky-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-sky-600">
                    Send
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── AI COACH ─── */}
        {activeTab === "coach" && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="bg-sky-50 border-b border-sky-100 px-4 py-3 flex items-center gap-3">
              <div className="w-10 h-10 bg-sky-500 rounded-full flex items-center justify-center text-white font-bold text-sm">AI</div>
              <div>
                <p className="font-semibold text-gray-800 text-sm">AI Fitness Coach</p>
                <p className="text-xs text-green-500">Online — Asks questions like a real coach</p>
              </div>
            </div>
            <div className="h-96 overflow-y-auto p-4 space-y-3 bg-gray-50">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "ai" && (
                    <div className="w-7 h-7 bg-sky-500 rounded-full flex items-center justify-center text-white text-xs font-bold mr-2 flex-shrink-0 mt-1">AI</div>
                  )}
                  <div className={`max-w-sm px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-sky-500 text-white rounded-tr-none"
                      : "bg-white text-gray-800 border border-gray-100 rounded-tl-none shadow-sm"
                  }`}>{msg.text}</div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="w-7 h-7 bg-sky-500 rounded-full flex items-center justify-center text-white text-xs font-bold mr-2">AI</div>
                  <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 shadow-sm">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-sky-300 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <div className="w-2 h-2 bg-sky-300 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <div className="w-2 h-2 bg-sky-300 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
            <div className="px-4 py-2 bg-white border-t border-gray-100">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {["Lose belly fat", "Build muscle", "Diet plan", "Todays workout", "I ate pizza", "Check my progress"].map(q => (
                  <button key={q} onClick={() => setInput(q)}
                    className="flex-shrink-0 text-xs bg-sky-50 text-sky-600 border border-sky-200 px-3 py-1.5 rounded-full hover:bg-sky-100">
                    {q}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-3 bg-white border-t border-gray-100 flex gap-2">
              <input value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && sendMessage()}
                placeholder="Ask your fitness coach anything..."
                className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400" />
              <button onClick={sendMessage} disabled={loading || !input.trim()}
                className="bg-sky-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-sky-600">
                Send
              </button>
            </div>
          </div>
        )}

        {/* ─── MY BODY ─── */}
        {activeTab === "stats" && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <h2 className="font-bold text-gray-800 mb-4">Your Body Stats</h2>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Height (cm)</label>
                  <input type="number" value={bodyStats.height} onChange={e => setBodyStats({...bodyStats, height: e.target.value})} placeholder="170" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Weight (kg)</label>
                  <input type="number" value={bodyStats.weight} onChange={e => setBodyStats({...bodyStats, weight: e.target.value})} placeholder="70" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Age</label>
                  <input type="number" value={bodyStats.age} onChange={e => setBodyStats({...bodyStats, age: e.target.value})} placeholder="28" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Gender</label>
                  <select value={bodyStats.gender} onChange={e => setBodyStats({...bodyStats, gender: e.target.value})} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400">
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
              </div>
              <div className="mb-4">
                <label className="text-xs text-gray-500 mb-2 block">Your Goal</label>
                <div className="grid grid-cols-2 gap-2">
                  {[{ val: "lose_fat", label: "🔥 Lose Fat" }, { val: "build_muscle", label: "💪 Build Muscle" }, { val: "stay_healthy", label: "❤️ Stay Healthy" }, { val: "improve_diet", label: "🥗 Improve Diet" }].map(g => (
                    <button key={g.val} onClick={() => setBodyStats({...bodyStats, goal: g.val})}
                      className={`py-2 rounded-xl text-sm border transition-colors ${bodyStats.goal === g.val ? "bg-sky-500 text-white border-sky-500" : "border-gray-200 text-gray-600"}`}>
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-4">
                <label className="text-xs text-gray-500 mb-2 block">Activity Level</label>
                <div className="grid grid-cols-3 gap-2">
                  {[{ val: "sedentary", label: "😴 Sedentary" }, { val: "moderate", label: "🚶 Moderate" }, { val: "active", label: "🏃 Very Active" }].map(a => (
                    <button key={a.val} onClick={() => setBodyStats({...bodyStats, activityLevel: a.val})}
                      className={`py-2 rounded-xl text-xs border transition-colors ${bodyStats.activityLevel === a.val ? "bg-sky-500 text-white border-sky-500" : "border-gray-200 text-gray-600"}`}>
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={calculateBMI} className="w-full bg-sky-500 text-white py-3 rounded-xl text-sm font-medium hover:bg-sky-600">
                Calculate BMI and Get My Plan
              </button>
            </div>
            {bmi && (
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                <h3 className="font-bold text-gray-800 mb-3">BMI Results</h3>
                <div className={`${getBMICategory(bmi).bg} rounded-xl p-4 text-center mb-4`}>
                  <p className="text-4xl font-bold text-gray-800">{bmi}</p>
                  <p className={`text-sm font-semibold mt-1 ${getBMICategory(bmi).color}`}>{getBMICategory(bmi).label}</p>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-gray-500">Ideal weight range</span>
                    <span className="font-medium">{Math.round(18.5 * (parseFloat(bodyStats.height)/100)**2)}kg — {Math.round(24.9 * (parseFloat(bodyStats.height)/100)**2)}kg</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-gray-500">Daily calorie target</span>
                    <span className="font-medium">{bodyStats.goal === "lose_fat" ? "1,400–1,600" : bodyStats.goal === "build_muscle" ? "2,200–2,500" : "1,800–2,000"} cal</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-gray-500">Daily water intake</span>
                    <span className="font-medium">{Math.round(parseFloat(bodyStats.weight) * 0.033 * 10) / 10}L</span>
                  </div>
                </div>
                <button onClick={() => setActiveTab("coach")} className="w-full mt-4 bg-sky-500 text-white py-3 rounded-xl text-sm font-medium hover:bg-sky-600">
                  Chat with AI Coach about my results
                </button>
              </div>
            )}
          </div>
        )}

        {/* ─── MEALS ─── */}
        {activeTab === "food" && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <h2 className="font-bold text-gray-800 mb-1">Meal Tracker</h2>
              <p className="text-xs text-gray-400 mb-4">Type or describe what you ate — AI shows full nutrition breakdown</p>
              {totalCalories > 0 && (
                <div className="grid grid-cols-4 gap-2 mb-4">
                  <div className="bg-sky-50 rounded-xl p-2 text-center">
                    <p className="text-base font-bold text-sky-600">{totalCalories}</p>
                    <p className="text-xs text-gray-400">Cal</p>
                  </div>
                  <div className="bg-green-50 rounded-xl p-2 text-center">
                    <p className="text-base font-bold text-green-600">{foodLog.reduce((s, f) => s + (f.protein || 0), 0)}g</p>
                    <p className="text-xs text-gray-400">Protein</p>
                  </div>
                  <div className="bg-orange-50 rounded-xl p-2 text-center">
                    <p className="text-base font-bold text-orange-600">{foodLog.reduce((s, f) => s + (f.carbs || 0), 0)}g</p>
                    <p className="text-xs text-gray-400">Carbs</p>
                  </div>
                  <div className="bg-red-50 rounded-xl p-2 text-center">
                    <p className="text-base font-bold text-red-600">{foodLog.reduce((s, f) => s + (f.fat || 0), 0)}g</p>
                    <p className="text-xs text-gray-400">Fat</p>
                  </div>
                </div>
              )}
              <div className="flex gap-2 mb-3">
                <input value={foodInput} onChange={e => setFoodInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && analyzeFood()}
                  placeholder="e.g. 2 chapati with dal, 1 banana, chai..."
                  className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-sky-400" />
                <button onClick={analyzeFood} disabled={analyzingFood || !foodInput.trim()}
                  className="bg-sky-500 text-white px-4 py-3 rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-sky-600 whitespace-nowrap">
                  {analyzingFood ? "..." : "Analyse"}
                </button>
              </div>
              <div className="flex gap-2 flex-wrap mb-4">
                {["2 chapati", "1 cup rice", "Idli sambar", "Dal tadka", "Banana", "Chai", "Boiled egg", "Dosa"].map(f => (
                  <button key={f} onClick={() => setFoodInput(f)}
                    className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-full hover:bg-sky-100 hover:text-sky-600">
                    {f}
                  </button>
                ))}
              </div>
              {foodLog.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Today s log</p>
                  {foodLog.map((f, i) => (
                    <div key={i} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <div className="flex justify-between mb-1">
                        <p className="text-sm font-medium text-gray-800">{f.food}</p>
                        <span className="text-xs text-sky-600 font-bold">{f.calories} cal</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1 mb-1">
                        <div className="text-center bg-green-50 rounded-lg py-1">
                          <p className="text-xs font-bold text-green-600">{f.protein}g</p>
                          <p className="text-xs text-gray-400">Protein</p>
                        </div>
                        <div className="text-center bg-orange-50 rounded-lg py-1">
                          <p className="text-xs font-bold text-orange-600">{f.carbs}g</p>
                          <p className="text-xs text-gray-400">Carbs</p>
                        </div>
                        <div className="text-center bg-red-50 rounded-lg py-1">
                          <p className="text-xs font-bold text-red-600">{f.fat}g</p>
                          <p className="text-xs text-gray-400">Fat</p>
                        </div>
                        <div className="text-center bg-gray-100 rounded-lg py-1">
                          <p className="text-xs font-bold text-gray-600">{f.time}</p>
                          <p className="text-xs text-gray-400">Time</p>
                        </div>
                      </div>
                      {f.suggestion && <p className="text-xs text-orange-600">💡 {f.suggestion}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-gray-400">
                  <p className="text-3xl mb-2">🍽️</p>
                  <p className="text-sm">No meals logged today. Start tracking!</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── STEPS ─── */}
        {activeTab === "steps" && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <h2 className="font-bold text-gray-800 mb-4">Daily Step Tracker</h2>

              {/* Circular progress */}
              <div className="flex items-center justify-center mb-4">
                <div className="relative w-48 h-48">
                  <svg className="w-48 h-48 -rotate-90" viewBox="0 0 160 160">
                    <circle cx="80" cy="80" r="70" fill="none" stroke="#E0F2FE" strokeWidth="16" />
                    <circle cx="80" cy="80" r="70" fill="none" stroke="#0EA5E9" strokeWidth="16"
                      strokeDasharray={`${2 * Math.PI * 70}`}
                      strokeDashoffset={`${2 * Math.PI * 70 * (1 - Math.min(steps / stepsGoal, 1))}`}
                      strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <p className="text-3xl font-bold text-gray-800">{steps.toLocaleString()}</p>
                    <p className="text-xs text-gray-400">of {stepsGoal.toLocaleString()}</p>
                    <p className="text-xs text-sky-500 font-bold">{Math.round(steps / stepsGoal * 100)}%</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-sky-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-sky-600">{(steps * 0.0008).toFixed(2)} km</p>
                  <p className="text-xs text-gray-400">Distance</p>
                </div>
                <div className="bg-green-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-green-600">{Math.round(steps * 0.04)}</p>
                  <p className="text-xs text-gray-400">Cal burned</p>
                </div>
                <div className="bg-purple-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-purple-600">{Math.round(steps / 100)}</p>
                  <p className="text-xs text-gray-400">Points</p>
                </div>
              </div>

              {/* Auto step counter */}
              <div className={`rounded-2xl p-4 mb-4 border-2 text-center ${autoStepsActive ? "bg-green-50 border-green-400" : "bg-sky-50 border-sky-300 border-dashed"}`}>
                {autoStepsActive ? (
                  <div>
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                      <p className="text-sm font-semibold text-green-700">Auto counting steps...</p>
                    </div>
                    <p className="text-xs text-green-600 mb-3">Keep your phone in your pocket while walking</p>
                    <button onClick={stopAutoStepCount}
                      className="bg-red-500 text-white text-sm px-6 py-2 rounded-xl hover:bg-red-600">
                      Stop Auto Count
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="text-2xl mb-2">⌚</p>
                    <p className="text-sm font-semibold text-gray-700 mb-1">Auto Step Counter</p>
                    <p className="text-xs text-gray-400 mb-3">Uses phone motion sensor — like a fitness watch. Open on mobile for best results.</p>
                    <button onClick={startAutoStepCount}
                      className="bg-sky-500 text-white text-sm px-6 py-2 rounded-xl hover:bg-sky-600">
                      Start Auto Counting
                    </button>
                  </div>
                )}
              </div>

              {/* Manual */}
              <div className="flex gap-2 mb-3">
                <input type="number" placeholder="Add steps manually..."
                  className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400"
                  id="manualSteps" />
                <button onClick={() => {
                  const val = parseInt((document.getElementById("manualSteps") as HTMLInputElement).value);
                  if (val > 0) {
                    setSteps(prev => prev + val);
                    stepCountRef.current += val;
                    (document.getElementById("manualSteps") as HTMLInputElement).value = "";
                  }
                }} className="bg-sky-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-sky-600">
                  Add
                </button>
              </div>

              <div className="flex gap-2">
                {[1000, 2000, 5000, 10000].map(n => (
                  <button key={n} onClick={() => { setSteps(prev => prev + n); stepCountRef.current += n; }}
                    className="flex-1 bg-sky-50 text-sky-600 text-xs py-2 rounded-xl border border-sky-200 hover:bg-sky-100">
                    +{n >= 1000 ? `${n/1000}K` : n}
                  </button>
                ))}
              </div>
            </div>

            {/* Gym tracker */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <h2 className="font-bold text-gray-800 mb-3">Gym Time Tracker</h2>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <button onClick={gymCheckIn} disabled={!!gymIn}
                  className={`py-3 rounded-xl text-sm font-medium ${gymIn ? "bg-green-100 text-green-600" : "bg-sky-500 text-white hover:bg-sky-600"}`}>
                  {gymIn ? `Checked in ${gymIn}` : "Gym Check-In"}
                </button>
                <button onClick={gymCheckOut} disabled={!gymIn || !!gymOut}
                  className={`py-3 rounded-xl text-sm font-medium ${gymOut ? "bg-purple-100 text-purple-600" : gymIn ? "bg-orange-500 text-white hover:bg-orange-600" : "bg-gray-100 text-gray-400"}`}>
                  {gymOut ? `Left at ${gymOut}` : "Gym Check-Out"}
                </button>
              </div>
              {gymMinutes > 0 && (
                <div className="bg-green-50 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-green-600">{gymMinutes} min</p>
                  <p className="text-xs text-gray-400">Gym session today — approx {Math.round(gymMinutes * 7)} cal burned</p>
                </div>
              )}
              {!gymIn && !gymMinutes && (
                <div>
                  <p className="text-xs text-gray-400 mb-2">Or enter manually:</p>
                  <div className="flex gap-2">
                    {[30, 45, 60, 90].map(m => (
                      <button key={m} onClick={() => setGymMinutes(m)}
                        className={`flex-1 py-2 rounded-xl text-xs border transition-colors ${gymMinutes === m ? "bg-sky-500 text-white border-sky-500" : "border-gray-200 text-gray-600"}`}>
                        {m}m
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── PROGRESS ─── */}
        {activeTab === "progress" && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <h2 className="font-bold text-gray-800 mb-4">Weekly Progress</h2>

              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2">Calories This Week</p>
              <div className="flex items-end gap-2 h-32 mb-1">
                {weeklyData.map((d, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <p className="text-xs text-sky-600 font-medium">{d.calories}</p>
                    <div className="w-full bg-sky-400 rounded-t-lg"
                      style={{ height: `${Math.round(d.calories / 2100 * 80)}px` }} />
                    <p className="text-xs text-gray-400">{d.day}</p>
                  </div>
                ))}
              </div>

              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2 mt-4">Steps This Week</p>
              <div className="flex items-end gap-2 h-24 mb-1">
                {weeklyData.map((d, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full bg-green-400 rounded-t-lg"
                      style={{ height: `${Math.round(d.steps / 11000 * 80)}px` }} />
                    <p className="text-xs text-gray-400">{d.day}</p>
                  </div>
                ))}
              </div>

              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2 mt-4">Protein This Week (g)</p>
              <div className="flex items-end gap-2 h-20 mb-1">
                {weeklyData.map((d, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full bg-purple-400 rounded-t-lg"
                      style={{ height: `${Math.round(d.protein / 91 * 60)}px` }} />
                    <p className="text-xs text-gray-400">{d.day}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-3 mt-4">
                <div className="bg-sky-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-sky-600">{Math.round(weeklyData.reduce((s,d) => s+d.calories, 0) / 7)}</p>
                  <p className="text-xs text-gray-400">Avg Cal/day</p>
                </div>
                <div className="bg-green-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-green-600">{Math.round(weeklyData.reduce((s,d) => s+d.steps, 0) / 7).toLocaleString()}</p>
                  <p className="text-xs text-gray-400">Avg Steps/day</p>
                </div>
                <div className="bg-purple-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-purple-600">{Math.round(weeklyData.reduce((s,d) => s+d.protein, 0) / 7)}g</p>
                  <p className="text-xs text-gray-400">Avg Protein/day</p>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-r from-sky-500 to-sky-700 rounded-2xl p-5 text-white">
              <h3 className="font-bold mb-1">AI Daily Summary</h3>
              <p className="text-sky-100 text-sm mb-4">Let your AI coach speak your daily health summary out loud</p>
              <button onClick={speaking ? stopSpeaking : speakDailySummary}
                className={`w-full py-3 rounded-xl text-sm font-bold ${speaking ? "bg-red-500 hover:bg-red-600" : "bg-white text-sky-600 hover:bg-sky-50"}`}>
                {speaking ? "Stop Speaking" : "Hear My Daily Summary"}
              </button>
            </div>
          </div>
        )}

        {/* ─── MEAL PLAN ─── */}
        {activeTab === "mealplan" && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <h2 className="font-bold text-gray-800 mb-1">3-Month Meal Plan</h2>
              <p className="text-xs text-gray-400 mb-4">AI generates a personalised plan with easy Indian recipes</p>
              {!bmi && (
                <div className="bg-sky-50 rounded-xl p-4 text-center mb-4">
                  <p className="text-sm text-sky-700 mb-2">Fill your body stats first</p>
                  <button onClick={() => setActiveTab("stats")} className="bg-sky-500 text-white text-xs px-4 py-2 rounded-xl">Enter My Stats</button>
                </div>
              )}
              {bmi && !mealPlan && (
                <button onClick={generateMealPlan} disabled={generatingPlan}
                  className="w-full bg-sky-500 text-white py-3 rounded-xl text-sm font-medium hover:bg-sky-600 disabled:opacity-50 mb-4">
                  {generatingPlan ? "Generating your 3-month plan..." : "Generate My 3-Month Meal Plan"}
                </button>
              )}
              {mealPlan && (
                <div className="space-y-4">
                  <div className="bg-sky-50 rounded-xl p-4">
                    <p className="text-sm font-semibold text-sky-800 mb-1">Plan Summary</p>
                    <p className="text-xs text-sky-700 leading-relaxed">{mealPlan.summary}</p>
                  </div>
                  {mealPlan.months?.map((month: any, mi: number) => (
                    <div key={mi} className="border border-gray-100 rounded-xl overflow-hidden">
                      <div className="bg-sky-500 px-4 py-2">
                        <p className="text-white font-semibold text-sm">{month.title}</p>
                        <p className="text-sky-100 text-xs">{month.focus}</p>
                      </div>
                      <div className="p-4 space-y-3">
                        {month.days?.map((day: any, di: number) => (
                          <div key={di} className="bg-gray-50 rounded-xl p-3">
                            <p className="text-xs font-semibold text-gray-700 mb-2">{day.day}</p>
                            {["breakfast","lunch","snack","dinner"].map(meal => day[meal] && (
                              <div key={meal} className="flex gap-2 text-xs mb-1">
                                <span className="text-gray-400 w-16 capitalize">{meal}:</span>
                                <span className="text-gray-700 flex-1">{day[meal]}</span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── WORKOUTS ─── */}
        {activeTab === "workouts" && (
          <div className="space-y-3">
            <div className="bg-sky-50 rounded-2xl p-4 border border-sky-100">
              <p className="text-sm font-semibold text-sky-800">Daily Workout Plan</p>
              <p className="text-xs text-sky-600 mt-1">Tap any workout to see step-by-step instructions</p>
            </div>
            {workouts.map((w, i) => (
              <details key={i} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <summary className="px-4 py-4 cursor-pointer flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-sky-100 rounded-xl flex items-center justify-center text-lg">💪</div>
                    <div>
                      <p className="font-semibold text-gray-800 text-sm">{w.name}</p>
                      <div className="flex gap-3 text-xs text-gray-400 mt-0.5">
                        <span>{w.duration}</span>
                        <span>{w.calories}</span>
                        <span className={`px-2 py-0.5 rounded-full ${w.level === "Beginner" ? "bg-green-100 text-green-600" : w.level === "Intermediate" ? "bg-yellow-100 text-yellow-600" : "bg-red-100 text-red-600"}`}>{w.level}</span>
                      </div>
                    </div>
                  </div>
                  <span className="text-gray-400 text-xs">▼</span>
                </summary>
                <div className="px-4 pb-4 border-t border-gray-100">
                  <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mt-3 mb-2">Step by step</p>
                  {w.steps.map((step, si) => (
                    <div key={si} className="flex gap-3 mb-2">
                      <div className="w-5 h-5 bg-sky-500 rounded-full flex items-center justify-center text-white text-xs flex-shrink-0 mt-0.5">{si+1}</div>
                      <p className="text-sm text-gray-600">{step}</p>
                    </div>
                  ))}
                  <button onClick={() => { setActiveTab("coach"); setInput(`Tell me more about ${w.name}`); }}
                    className="mt-3 w-full bg-sky-50 text-sky-600 text-xs py-2 rounded-xl border border-sky-200 hover:bg-sky-100">
                    Ask AI Coach about this workout
                  </button>
                </div>
              </details>
            ))}
          </div>
        )}

        {/* ─── BLOOD REPORT ─── */}
        {activeTab === "bloodreport" && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <h2 className="font-bold text-gray-800 mb-1">Blood Report Analysis</h2>
              <p className="text-xs text-gray-400 mb-4">Upload your blood report — AI explains every value and gives personalised recommendations</p>

              {!bloodReport ? (
                <div>
                  <label className="block w-full cursor-pointer">
                    <div className="border-2 border-dashed border-sky-300 rounded-2xl p-8 text-center hover:border-sky-500 hover:bg-sky-50 transition-colors">
                      <div className="text-4xl mb-3">📄</div>
                      <p className="font-medium text-gray-700 mb-1">Upload your blood report</p>
                      <p className="text-xs text-gray-400 mb-3">PDF, image, or text file</p>
                      <span className="bg-sky-500 text-white text-xs px-4 py-2 rounded-xl">Choose File</span>
                    </div>
                    <input type="file" className="hidden" accept=".pdf,.txt,.jpg,.png,.jpeg" onChange={handleBloodUpload} />
                  </label>
                  <div className="mt-4 bg-sky-50 rounded-xl p-4">
                    <p className="text-xs font-semibold text-sky-700 mb-2">What AI analyses:</p>
                    <div className="grid grid-cols-2 gap-1">
                      {["CBC — Blood count", "Liver function (LFT)", "Kidney function (KFT)", "Thyroid (TSH, T3, T4)", "Diabetes (HbA1c, FBS)", "Lipid profile", "Vitamins D, B12, Iron", "Inflammation markers"].map(item => (
                        <p key={item} className="text-xs text-sky-600">✓ {item}</p>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-3 mb-4">
                    <span className="text-green-500 text-xl">✅</span>
                    <div>
                      <p className="text-sm font-medium text-green-800">{bloodReport} uploaded</p>
                      <p className="text-xs text-green-600">{analyzingBlood ? "Analysing..." : "Analysis complete"}</p>
                    </div>
                  </div>
                  {analyzingBlood && (
                    <div className="text-center py-8">
                      <div className="w-10 h-10 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                      <p className="text-sm text-gray-500">Analysing your blood report...</p>
                    </div>
                  )}
                  {bloodAnalysis && !analyzingBlood && (
                    <div>
                      <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm mb-4">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-7 h-7 bg-sky-500 rounded-full flex items-center justify-center text-white text-xs font-bold">AI</div>
                          <p className="text-sm font-semibold text-gray-800">AI Blood Report Analysis</p>
                        </div>
                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{bloodAnalysis}</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={speaking ? stopSpeaking : () => speak(bloodAnalysis)}
                          className={`flex-1 py-2.5 rounded-xl text-sm font-medium ${speaking ? "bg-red-500 text-white" : "bg-sky-500 text-white hover:bg-sky-600"}`}>
                          {speaking ? "Stop" : "Hear Analysis"}
                        </button>
                        <button onClick={() => { setBloodReport(null); setBloodAnalysis(null); }}
                          className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50">
                          Upload New Report
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── MEAL DELIVERY ─── */}
        {activeTab === "subscribe" && (
          <div className="space-y-4">
            <div className="bg-gradient-to-r from-sky-500 to-sky-700 rounded-2xl p-5 text-white">
              <h2 className="font-bold text-lg mb-1">Meal Subscription</h2>
              <p className="text-sky-100 text-sm">Healthy meals delivered — curated by our AI nutritionist for your diet plan</p>
            </div>
            {mealPartners.map((partner, i) => (
              <div key={i} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-800">{partner.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${partner.tag === "Popular" ? "bg-sky-100 text-sky-600" : partner.tag === "Budget" ? "bg-green-100 text-green-600" : partner.tag === "Medical" ? "bg-purple-100 text-purple-600" : "bg-orange-100 text-orange-600"}`}>{partner.tag}</span>
                    </div>
                    <p className="text-sm text-gray-400">{partner.desc}</p>
                  </div>
                  <p className="text-sky-600 font-bold text-sm whitespace-nowrap ml-3">{partner.price}</p>
                </div>
                <button className="w-full bg-sky-500 text-white text-sm py-2.5 rounded-xl hover:bg-sky-600">
                  Subscribe to {partner.name}
                </button>
              </div>
            ))}
            <div className="bg-sky-50 rounded-2xl p-4 border border-sky-100">
              <p className="text-sm font-semibold text-sky-800 mb-1">AI Nutritionist picks meals for you</p>
              <p className="text-xs text-sky-600 leading-relaxed">Once subscribed, our AI selects meals matching your body stats, goals, and preferences — and adjusts weekly based on your progress.</p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}