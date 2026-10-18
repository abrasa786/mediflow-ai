"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import EmergencyStatus from "@/components/emergency/EmergencyStatus";

export default function EmergencyCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [patientId, setPatientId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("patients").select("patient_id").eq("id", user.id).maybeSingle();
      setPatientId(data?.patient_id ?? null);
    })();
  }, []);

  return (
    <div className="min-h-[100dvh] bg-red-50">
      <nav className="bg-red-600 text-white px-4 py-3 flex items-center gap-3">
        <Link href="/home" className="text-xl" aria-label="Back">←</Link>
        <span className="font-bold text-lg">Emergency — Live Status</span>
      </nav>
      <div className="max-w-md mx-auto px-4 py-5">
        <EmergencyStatus caseId={id} patientId={patientId} />
      </div>
    </div>
  );
}
