"use client";

// Live map: patient 📍, ambulance 🚑 (moves in real time) and clinic 🏥 — Leaflet + OpenStreetMap.

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";

type Pt = [number, number] | null;
type Markers = { patient?: Leaflet.Marker; ambulance?: Leaflet.Marker; clinic?: Leaflet.Marker; line?: Leaflet.Polyline };

function emojiIcon(L: typeof Leaflet, emoji: string, ring: string) {
  return L.divIcon({
    className: "",
    html: `<div style="font-size:22px;line-height:34px;width:34px;height:34px;text-align:center;border-radius:50%;background:#fff;box-shadow:0 0 0 3px ${ring},0 2px 6px rgba(0,0,0,.3)">${emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function place(L: typeof Leaflet, map: Leaflet.Map, markers: Markers, key: "patient" | "ambulance" | "clinic", pt: Pt, emoji: string, ring: string, label: string) {
  const existing = markers[key];
  if (!pt) {
    existing?.remove();
    markers[key] = undefined;
  } else if (existing) {
    existing.setLatLng(pt);
  } else {
    markers[key] = L.marker(pt, { icon: emojiIcon(L, emoji, ring), title: label }).addTo(map).bindTooltip(label);
  }
}

export default function AmbulanceMap({ patient, ambulance, clinic }: { patient: Pt; ambulance: Pt; clinic: Pt }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const markers = useRef<Markers>({});
  const fitted = useRef(false);
  const [leaflet, setLeaflet] = useState<typeof Leaflet | null>(null);

  // Create the map once (Leaflet needs `window`, so it's loaded client-side)
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !el.current || map.current) return;
      map.current = L.map(el.current).setView([12.9716, 77.5946], 13);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map.current);
      setLeaflet(L);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      markers.current = {};
      fitted.current = false;
    };
  }, []);

  // Move markers whenever positions change
  const [pLat, pLng] = patient ?? [null, null];
  const [aLat, aLng] = ambulance ?? [null, null];
  const [cLat, cLng] = clinic ?? [null, null];
  useEffect(() => {
    const m = map.current;
    if (!leaflet || !m) return;
    const p: Pt = pLat != null ? [pLat, pLng!] : null;
    const a: Pt = aLat != null ? [aLat, aLng!] : null;
    const c: Pt = cLat != null ? [cLat, cLng!] : null;
    const mk = markers.current;
    place(leaflet, m, mk, "patient", p, "📍", "#0ea5e9", "Patient");
    place(leaflet, m, mk, "clinic", c, "🏥", "#10b981", "Clinic");
    place(leaflet, m, mk, "ambulance", a, "🚑", "#ef4444", "Ambulance");

    mk.line?.remove();
    mk.line = a && p ? leaflet.polyline([a, p], { color: "#ef4444", weight: 3, dashArray: "6 8" }).addTo(m) : undefined;

    const pts = [p, a, c].filter(Boolean) as [number, number][];
    const ambulanceOffScreen = a && !m.getBounds().contains(a);
    if (pts.length === 1 && !fitted.current) {
      m.setView(pts[0], 15);
      fitted.current = true;
    } else if (pts.length >= 2 && (!fitted.current || ambulanceOffScreen)) {
      m.fitBounds(leaflet.latLngBounds(pts), { padding: [36, 36], maxZoom: 16 });
      fitted.current = true;
    }
  }, [leaflet, pLat, pLng, aLat, aLng, cLat, cLng]);

  return <div ref={el} className="w-full h-56 rounded-xl overflow-hidden border border-slate-200 z-0" />;
}
