"use client";

// hooks/useLocation.ts
// Geolocation + reverse-geocoding (suburb / area name) with a 5-minute localStorage cache.
//
//   const { location, status, requestLocation } = useLocation();          // request on trigger
//   const { location, status } = useLocation({ auto: true });             // request on mount
//
// The cached value is shared under "mediflow_location", so a location fetched
// silently on the home page is reused by the AI chat without prompting again.

import { useCallback, useEffect, useRef, useState } from "react";

export type LocationData = {
  lat: number;
  lng: number;
  area: string; // e.g. "Indiranagar"
  city: string; // e.g. "Bengaluru"
  timestamp: number; // when it was fetched (ms)
};

export type LocationStatus = "idle" | "loading" | "granted" | "denied" | "unavailable";

export const LOCATION_STORAGE_KEY = "mediflow_location";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Read the cached location, or null if missing / older than 5 minutes. */
export function getCachedLocation(): LocationData | null {
  try {
    const raw = localStorage.getItem(LOCATION_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as LocationData;
    if (!data?.timestamp || Date.now() - data.timestamp > CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function saveLocation(data: LocationData) {
  try {
    localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

async function reverseGeocode(lat: number, lng: number): Promise<{ area: string; city: string }> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16&accept-language=en`
    );
    if (!res.ok) throw new Error("Reverse geocoding failed");
    const geo = await res.json();
    const a = geo.address || {};
    const city = a.city || a.town || a.village || a.state_district || "";
    const area = a.suburb || a.neighbourhood || a.city_district || a.quarter || city || "your area";
    return { area, city };
  } catch {
    return { area: "your area", city: "" };
  }
}

export function useLocation({ auto = false }: { auto?: boolean } = {}) {
  const [location, setLocation] = useState<LocationData | null>(null);
  const [status, setStatus] = useState<LocationStatus>("idle");
  const pending = useRef<Promise<LocationData | null> | null>(null);

  /** Ask for permission (if needed) and resolve with the location, or null if denied/unavailable. */
  const requestLocation = useCallback((): Promise<LocationData | null> => {
    const cached = getCachedLocation();
    if (cached) {
      setLocation(cached);
      setStatus("granted");
      return Promise.resolve(cached);
    }
    if (pending.current) return pending.current;

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      return Promise.resolve(null);
    }

    setStatus("loading");
    pending.current = new Promise<LocationData | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude: lat, longitude: lng } = pos.coords;
          const { area, city } = await reverseGeocode(lat, lng);
          const data: LocationData = { lat, lng, area, city, timestamp: Date.now() };
          saveLocation(data);
          setLocation(data);
          setStatus("granted");
          resolve(data);
        },
        (err) => {
          setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
          resolve(null);
        },
        { timeout: 10000, maximumAge: CACHE_TTL_MS }
      );
    }).finally(() => {
      pending.current = null;
    });
    return pending.current;
  }, []);

  useEffect(() => {
    // Always pick up a fresh cached value without prompting.
    // (Read after mount, not during render, so server and client HTML match.)
    const cached = getCachedLocation();
    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocation(cached);
      setStatus("granted");
      return;
    }
    if (auto) requestLocation();
  }, [auto, requestLocation]);

  return { location, status, requestLocation };
}
