"use client";

// 5-step onboarding — under a minute. Everything else can be filled in later from Profile.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLocation } from "@/hooks/useLocation";
import { getPatientProfile, onboardedKey, updatePatient, type Patient } from "@/lib/patient";

const HEALTH = ["Diabetes", "BP", "Heart", "Asthma", "Thyroid", "None"];
const field = "w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-sky-400";

export default function Onboarding() {
  const router = useRouter();
  const { location, status: locStatus, requestLocation } = useLocation();
  const [step, setStep] = useState(1);
  const [userId, setUserId] = useState("");
  const [patient, setPatient] = useState<Patient | null>(null);
  const [phoneAuth, setPhoneAuth] = useState(false);

  const [phone, setPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [flags, setFlags] = useState<string[]>([]);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUserId(user.id);
      const p = await getPatientProfile(user);
      setPatient(p);
      setPhone(p?.phone || user.phone || "");
      setName(p?.name || "");
      // Is SMS OTP enabled in Supabase Auth?
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
          headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
        });
        const settings = await res.json();
        setPhoneAuth(!!settings?.external?.phone);
      } catch {}
    })();
  }, [router]);

  const e164 = (p: string) => {
    const d = p.replace(/\D/g, "");
    return d.length === 10 ? `+91${d}` : d.startsWith("91") && d.length === 12 ? `+${d}` : `+${d}`;
  };

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — please try again.");
    } finally {
      setBusy(false);
    }
  }

  // Step 1 — phone (+ OTP when SMS is enabled)
  const submitPhone = () =>
    run(async () => {
      if (phone.replace(/\D/g, "").length < 10) throw new Error("Please enter a valid 10-digit mobile number.");
      if (phoneAuth && !otpSent) {
        const { error } = await supabase.auth.updateUser({ phone: e164(phone) });
        if (error) throw error;
        setOtpSent(true);
        return;
      }
      if (phoneAuth && otpSent) {
        const { error } = await supabase.auth.verifyOtp({ phone: e164(phone), token: otp, type: "phone_change" });
        if (error) throw new Error("That code didn't match. Please check and try again.");
      }
      const { error } = await updatePatient(userId, { phone: e164(phone) });
      if (error) throw new Error("Couldn't save your number — please try again.");
      setStep(2);
    });

  // Step 2 — name + photo
  const submitName = () =>
    run(async () => {
      if (!name.trim()) throw new Error("Please enter your name.");
      let avatar_url: string | undefined;
      if (photo) {
        const path = `${userId}/avatar-${Date.now()}.${photo.name.split(".").pop() || "jpg"}`;
        const { error } = await supabase.storage.from("avatars").upload(path, photo, { upsert: true });
        if (!error) avatar_url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      }
      const { error } = await updatePatient(userId, { name: name.trim(), ...(avatar_url ? { avatar_url } : {}) });
      if (error) throw new Error("Couldn't save your name — please try again.");
      setStep(3);
    });

  // Step 3 — location (auto-detects city)
  const submitLocation = () =>
    run(async () => {
      const loc = location ?? (await requestLocation());
      if (loc?.city) await updatePatient(userId, { city: loc.city });
      setStep(4);
    });

  // Step 4 — one health chip + emergency contact (used automatically in SOS)
  const submitHealth = () =>
    run(async () => {
      const chosen = flags.filter((f) => f !== "None");
      const { error } = await updatePatient(userId, {
        health_flags: chosen,
        ...(chosen.length ? { conditions: chosen.join(", ") } : {}),
        ...(contactPhone.trim() ? { emergency_contact_name: contactName.trim() || null, emergency_contact_phone: e164(contactPhone) } : {}),
        onboarded_at: new Date().toISOString(),
      });
      if (error) throw new Error("Couldn't save your details — please try again.");
      try {
        localStorage.setItem(onboardedKey(userId), "1");
      } catch {}
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setPatient(await getPatientProfile(user));
      setStep(5);
    });

  const progress = (step / 5) * 100;

  return (
    <div className="min-h-[100dvh] bg-gray-50 flex flex-col">
      <div className="h-1.5 bg-gray-200">
        <div className="h-full bg-sky-500 transition-all" style={{ width: `${progress}%` }} />
      </div>
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm w-full max-w-sm p-6 space-y-4">
          <p className="text-xs text-gray-400 font-semibold">STEP {step} OF 5</p>
          {!userId && <p className="text-sm text-gray-400">Loading your profile…</p>}

          {userId && step === 1 && (
            <>
              <h1 className="text-xl font-bold text-gray-800">Your mobile number 📱</h1>
              <p className="text-sm text-gray-500">For appointment reminders and emergency alerts.</p>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" className={field} disabled={otpSent} />
              {otpSent && (
                <input inputMode="numeric" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} placeholder="6-digit OTP" maxLength={6} className={field} />
              )}
              <button onClick={submitPhone} disabled={busy} className="w-full bg-sky-500 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50">
                {busy ? "Please wait…" : phoneAuth ? (otpSent ? "Verify OTP" : "Send OTP") : "Continue"}
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="text-xl font-bold text-gray-800">What should we call you? 👋</h1>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className={field} />
              <label className="flex items-center gap-3 border border-dashed border-gray-300 rounded-xl px-4 py-3 cursor-pointer">
                <span className="text-2xl">📷</span>
                <span className="text-sm text-gray-600 truncate">{photo ? photo.name : "Add a photo (optional)"}</span>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
              </label>
              <button onClick={submitName} disabled={busy} className="w-full bg-sky-500 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50">
                {busy ? "Saving…" : "Continue"}
              </button>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="text-xl font-bold text-gray-800">Find care near you 📍</h1>
              <p className="text-sm text-gray-500">We use your location to show nearby clinics and send help fast in an emergency.</p>
              {location && <p className="text-sm font-medium text-sky-700 bg-sky-50 rounded-xl px-3 py-2">📍 {location.area}{location.city && location.city !== location.area ? `, ${location.city}` : ""}</p>}
              {locStatus === "denied" && <p className="text-xs text-amber-700">Location is blocked — you can enable it later in browser settings.</p>}
              <button onClick={submitLocation} disabled={busy} className="w-full bg-sky-500 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50">
                {busy || locStatus === "loading" ? "Detecting…" : location ? "Continue" : "Allow location"}
              </button>
              <button onClick={() => setStep(4)} className="w-full text-xs text-gray-400">Skip for now</button>
            </>
          )}

          {step === 4 && (
            <>
              <h1 className="text-xl font-bold text-gray-800">Any ongoing condition? 🩺</h1>
              <div className="flex flex-wrap gap-2">
                {HEALTH.map((h) => {
                  const on = flags.includes(h);
                  return (
                    <button
                      key={h}
                      onClick={() => setFlags(h === "None" ? ["None"] : on ? flags.filter((f) => f !== h) : [...flags.filter((f) => f !== "None"), h])}
                      className={`text-sm px-4 py-2 rounded-full border ${on ? "bg-sky-500 text-white border-sky-500" : "bg-white text-gray-700 border-gray-200"}`}
                    >
                      {h}
                    </button>
                  );
                })}
              </div>
              <div className="pt-2 space-y-2">
                <p className="text-sm font-semibold text-gray-700">Emergency contact <span className="font-normal text-gray-400">(recommended)</span></p>
                <p className="text-xs text-gray-500">We alert them automatically if you trigger SOS.</p>
                <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Name (e.g. Mom)" className={field} />
                <input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="Their mobile number" className={field} />
              </div>
              <button onClick={submitHealth} disabled={busy} className="w-full bg-sky-500 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50">
                {busy ? "Saving…" : "Finish"}
              </button>
            </>
          )}

          {step === 5 && (
            <div className="text-center space-y-3">
              <p className="text-4xl">🎉</p>
              <h1 className="text-xl font-bold text-gray-800">You&apos;re all set{patient?.name ? `, ${patient.name.split(" ")[0]}` : ""}!</h1>
              <p className="text-sm text-gray-500">Your Mediflow ID — show it at any clinic:</p>
              <p className="text-2xl font-bold tracking-widest text-sky-700 bg-sky-50 rounded-xl py-3">{patient?.patient_id || "Generating…"}</p>
              <button onClick={() => router.push("/home")} className="w-full bg-sky-500 text-white py-3 rounded-xl text-sm font-semibold">
                Go to home
              </button>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </div>
    </div>
  );
}
