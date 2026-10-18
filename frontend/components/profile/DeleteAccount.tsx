"use client";

// DPDP Act 2023 — full, permanent deletion of the patient's data and login.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteMyAccount } from "@/lib/patient";

export default function DeleteAccount() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <section className="bg-white rounded-2xl p-5 shadow-sm border border-red-100">
      <h2 className="font-bold text-gray-800">Delete my account</h2>
      <p className="text-xs text-gray-500 mt-1">
        Permanently deletes your profile, MediPass, appointments, emergency history and login. This can&apos;t be undone.
      </p>
      {!open ? (
        <button onClick={() => setOpen(true)} className="mt-3 text-sm font-semibold text-red-600 border border-red-200 rounded-xl px-4 py-2 hover:bg-red-50">
          Delete my account…
        </button>
      ) : (
        <div className="mt-3 bg-red-50 rounded-xl p-3 space-y-2">
          <p className="text-sm text-red-700">Type <b>DELETE</b> to confirm.</p>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white" />
          <div className="flex gap-2">
            <button
              disabled={typed !== "DELETE" || busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await deleteMyAccount();
                  router.push("/signup?deleted=1");
                } catch {
                  setError("Couldn't delete right now. Please try again or contact support.");
                  setBusy(false);
                }
              }}
              className="flex-1 bg-red-600 text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-40"
            >
              {busy ? "Deleting…" : "Permanently delete"}
            </button>
            <button onClick={() => { setOpen(false); setTyped(""); }} className="flex-1 border border-gray-200 bg-white text-gray-600 text-sm py-2 rounded-lg">
              Cancel
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </section>
  );
}
