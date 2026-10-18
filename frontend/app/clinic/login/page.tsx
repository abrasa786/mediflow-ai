"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function ClinicLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return setError(error.message);
    router.push("/clinic");
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <form onSubmit={login} className="bg-white rounded-2xl w-full max-w-sm p-8 space-y-4">
        <div className="text-center">
          <div className="w-10 h-10 bg-sky-500 rounded-xl mx-auto flex items-center justify-center text-white font-bold">M</div>
          <p className="font-bold text-slate-800 mt-2">Mediflow Clinic Portal</p>
          <p className="text-xs text-slate-500">Appointments, emergencies & MediPass</p>
        </div>
        {error && <p className="bg-red-50 text-red-600 text-sm px-3 py-2 rounded-lg">{error}</p>}
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="clinic@email.com"
          className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400" />
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password"
          className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400" />
        <button disabled={loading} className="w-full bg-slate-900 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50">
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
