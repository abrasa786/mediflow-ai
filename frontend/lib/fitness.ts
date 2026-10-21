// Daily fitness logs (Supabase "fitness_logs", one row per patient per day).

import { supabase } from "@/lib/supabase";
import { isoDate } from "@/lib/schedule";

export type MealEntry = {
  food: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  suggestion?: string;
  time: string;
};

export type FitnessLog = {
  log_date: string;
  steps: number;
  calories: number;
  protein: number;
  gym_minutes: number;
  meals: MealEntry[];
};

export type WeekDay = { day: string; iso: string; steps: number; calories: number; protein: number; gymMinutes: number };

export async function getFitnessLogs(days = 7): Promise<FitnessLog[]> {
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  const { data, error } = await supabase
    .from("fitness_logs")
    .select("log_date, steps, calories, protein, gym_minutes, meals")
    .gte("log_date", isoDate(from))
    .order("log_date");
  return error ? [] : ((data as FitnessLog[]) ?? []);
}

export async function saveTodayLog(userId: string, log: Omit<FitnessLog, "log_date">) {
  const { error } = await supabase.from("fitness_logs").upsert(
    { patient_id: userId, log_date: isoDate(new Date()), ...log, updated_at: new Date().toISOString() },
    { onConflict: "patient_id,log_date" }
  );
  if (error) console.warn("Couldn't save today's fitness log:", error.message);
}

/** The last 7 days (oldest first), zero-filled where nothing was logged. */
export function lastSevenDays(logs: FitnessLog[]): WeekDay[] {
  const byDate = new Map(logs.map((l) => [l.log_date, l]));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const iso = isoDate(d);
    const l = byDate.get(iso);
    return {
      day: i === 6 ? "Today" : d.toLocaleDateString("en-IN", { weekday: "short" }),
      iso,
      steps: l?.steps ?? 0,
      calories: l?.calories ?? 0,
      protein: l?.protein ?? 0,
      gymMinutes: l?.gym_minutes ?? 0,
    };
  });
}
