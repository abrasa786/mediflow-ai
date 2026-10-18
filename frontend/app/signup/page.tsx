"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function Signup() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignup = async () => {
  setLoading(true);
  setError("");

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name, phone, city }
    }
  });

  if (error) {
    setError(error.message);
    setLoading(false);
    return;
  }

  if (data.user) {
    await supabase.from("patients").insert({
      id: data.user.id,
      name,
      email,
      phone,
      city
    });
  }

  // Email confirmation on: no session yet — the patient row is created on first login instead
  if (!data.session) {
    setInfo("Account created! Please check your email to confirm, then sign in.");
    setLoading(false);
    return;
  }

  router.push("/onboarding");
  setLoading(false);
};

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 w-full max-w-sm p-8">
        <div className="text-center mb-6">
          <div className="text-2xl font-semibold text-blue-600 mb-1">Mediflow AI</div>
          <p className="text-sm text-gray-400">Create your health account</p>
        </div>

        <h2 className="text-lg font-medium text-gray-800 mb-5">Create account</h2>

        {info && (
          <div className="bg-emerald-50 text-emerald-700 text-sm px-4 py-3 rounded-xl mb-4">
            {info}
          </div>
        )}

        {error && (
          <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-xl mb-4">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="text-sm text-gray-600 mb-1 block">Full name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Abdul Rahim"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-sm text-gray-600 mb-1 block">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-sm text-gray-600 mb-1 block">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-sm text-gray-600 mb-1 block">City</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Bengaluru"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-sm text-gray-600 mb-1 block">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 6 characters"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            onClick={handleSignup}
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors mt-2"
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
        </div>

        <p className="text-center text-sm text-gray-400 mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-blue-600 font-medium">Sign in</Link>
        </p>
      </div>
    </div>
  );
}