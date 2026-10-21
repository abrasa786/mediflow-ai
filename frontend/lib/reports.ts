// Saved AI report analyses (Supabase "health_reports", one row per analysis, patient-only access).

import { supabase } from "@/lib/supabase";

export type HealthReport = { id: string; source: "chat" | "fitness"; title: string | null; analysis: string; created_at: string };

/** Title from the analysis' first abnormal finding, e.g. "Vitamin D: 14 ng/mL (Normal: 30–100)". */
function titleFrom(analysis: string) {
  const line = analysis
    .split("\n")
    .map((l) => l.replace(/[#*•\-]/g, "").trim())
    .find((l) => /\d/.test(l) && l.length > 6 && !/REPORT SUMMARY/i.test(l));
  return (line || "Health report").slice(0, 90);
}

/** Best-effort: the analysis is still shown if saving fails (e.g. migration not run yet). */
export async function saveHealthReport(analysis: string, source: "chat" | "fitness") {
  const { error } = await supabase.from("health_reports").insert({ analysis, source, title: titleFrom(analysis) });
  if (error) console.warn("Couldn't save report:", error.message);
}

export async function countHealthReports(): Promise<number> {
  const { count, error } = await supabase.from("health_reports").select("id", { count: "exact", head: true });
  return error ? 0 : count ?? 0;
}

export async function listHealthReports(limit = 20): Promise<HealthReport[]> {
  const { data, error } = await supabase
    .from("health_reports")
    .select("id, source, title, analysis, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return error ? [] : ((data as HealthReport[]) ?? []);
}

export async function deleteHealthReport(id: string) {
  return supabase.from("health_reports").delete().eq("id", id);
}
