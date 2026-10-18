"use client";

import { createContext, useContext } from "react";
import type { Clinic } from "@/lib/clinicSuite";

export type ClinicCtx = {
  clinic: Clinic;
  clinics: { id: string; name: string }[];
  setClinicId: (id: string) => void;
  reloadClinic: () => Promise<void>;
  userId: string;
  flash: (msg: string) => void;
};

export const ClinicContext = createContext<ClinicCtx | null>(null);

export function useClinic() {
  const ctx = useContext(ClinicContext);
  if (!ctx) throw new Error("useClinic must be used inside the clinic portal layout");
  return ctx;
}
