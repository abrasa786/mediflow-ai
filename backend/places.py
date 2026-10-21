"""Real clinics from the map, merged with clinics registered on Mediflow.

Providers (picked automatically):
  • Google Places API (New) — set GOOGLE_MAPS_API_KEY. Real ratings, phone numbers, opening hours.
  • OpenStreetMap (free, no key) — Nominatim for nearby clinics / hospitals, Photon for name search.

Map listings get a stable consultation fee of ₹200–₹800 (same formula as SQL public.place_fee).
A listing becomes a row in public.clinics the first time someone books it (/places/import), and the
clinic can later claim it from the clinic portal.
"""

import asyncio
import hashlib
import logging
import math
import os
import re
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException

from security import SUPABASE_ANON_KEY, SUPABASE_URL, require_user

log = logging.getLogger("mediflow.places")
router = APIRouter()

GOOGLE_KEY = os.getenv("GOOGLE_MAPS_API_KEY") or ""
CONTACT = os.getenv("OSM_CONTACT_EMAIL") or "support@mediflowai.in"
USER_AGENT = f"MediflowAI/1.0 ({CONTACT})"  # required by the OpenStreetMap usage policy

NOMINATIM = "https://nominatim.openstreetmap.org"
PHOTON = "https://photon.komoot.io/api/"
GOOGLE = "https://places.googleapis.com/v1"
GOOGLE_FIELDS = [
    "id", "displayName", "formattedAddress", "shortFormattedAddress", "location", "rating", "userRatingCount",
    "nationalPhoneNumber", "internationalPhoneNumber", "regularOpeningHours", "googleMapsUri", "types",
    "addressComponents", "businessStatus",
]

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
CACHE_TTL = 6 * 3600
_cache: dict[str, tuple[float, object]] = {}
_places: dict[str, dict] = {}  # every listing we've returned, by "source:id" (used by /places/import)
_nominatim_lock = asyncio.Lock()
_nominatim_last = 0.0


# ── Specialties ──
SPECIALTY_TAGS = [
    "General", "Pediatric", "Cardio", "Ortho", "Skin", "Neuro", "Gynecology",
    "Dental", "Eye", "ENT", "Gastro", "Psychiatry", "Oncology",
]
SPECIALIST_QUERY = {
    "General": "general physician clinic", "Pediatric": "pediatrician", "Cardio": "cardiologist",
    "Ortho": "orthopedic doctor", "Skin": "dermatologist", "Neuro": "neurologist", "Gynecology": "gynecologist",
    "Dental": "dentist", "Eye": "eye hospital", "ENT": "ENT doctor", "Gastro": "gastroenterologist",
    "Psychiatry": "psychiatrist", "Oncology": "oncologist",
}
_NAME_HINTS = [
    ("Dental", r"dental|dentist|teeth|tooth|orthodont|smile|endodont"),
    ("Eye", r"\beye|vision|ophthal|optic|netra|lasik|retina"),
    ("Skin", r"skin|derma|hair|cosmet|laser|trich"),
    ("Ortho", r"ortho(?!dont)|bone|joint|spine|fracture|physio"),
    ("Pediatric", r"child|kids?\b|paediat|pediat|baby|neonat"),
    ("Gynecology", r"women|gyn|maternity|mother|obst|fertility|\bivf\b|pregnan"),
    ("Cardio", r"heart|cardi"),
    ("Neuro", r"neuro|brain"),
    ("ENT", r"\bent\b|ear,? nose|throat|hearing|speech"),
    ("Gastro", r"gastro|liver|digest"),
    ("Psychiatry", r"psych|mind|mental|de-?addiction"),
    ("Oncology", r"cancer|onco"),
]
_OSM_SPECIALITY = {
    "general": "General", "family_medicine": "General", "internal": "General", "dentistry": "Dental",
    "orthodontics": "Dental", "ophthalmology": "Eye", "dermatology": "Skin", "orthopaedics": "Ortho",
    "paediatrics": "Pediatric", "gynaecology": "Gynecology", "obstetrics": "Gynecology", "cardiology": "Cardio",
    "neurology": "Neuro", "otolaryngology": "ENT", "gastroenterology": "Gastro", "psychiatry": "Psychiatry",
    "oncology": "Oncology",
}
_NOT_A_DOCTOR = re.compile(
    r"ayurved|homoeo|homeo|unani|siddha|veterinar|\bvet\b|\bpet\b|animal|diagnostic|\blab\b|laborator|"
    r"diagnos|scan|imaging|x-?ray|blood bank|pharma|chemist|medical store|nursing home supplies",
    re.I,
)


def infer_specialities(name: str, kind: str, extra: list[str] | None = None) -> list[str]:
    """Hospitals are multi-specialty; clinics get tags from their name / OSM tags (default General)."""
    if kind == "hospital":
        return list(SPECIALTY_TAGS)
    tags = {t for t in (extra or []) if t in SPECIALTY_TAGS}
    for tag, pattern in _NAME_HINTS:
        if re.search(pattern, name, re.I):
            tags.add(tag)
    if kind == "dentist":
        tags.add("Dental")
    return sorted(tags) or ["General"]


def place_fee(key: str) -> int:
    """₹200–₹800 in ₹50 steps, stable per listing. Must match SQL public.place_fee()."""
    return 200 + (int(hashlib.md5(key.encode()).hexdigest()[:7], 16) % 13) * 50


def haversine_km(lat1, lng1, lat2, lng2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _cached(key: str):
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    return None


def _store(key: str, value, ttl: int = CACHE_TTL):
    _cache[key] = (time.time() + ttl, value)
    if len(_cache) > 2000:
        now = time.time()
        for k in [k for k, (exp, _) in _cache.items() if exp < now]:
            _cache.pop(k, None)
    return value


# ── Opening hours → {"Mon": [[540, 1260]], …} (minutes from midnight) ──
def _hours_summary(hours: dict | None) -> tuple[str | None, str | None]:
    """Earliest open / latest close across the week, as "HH:MM"."""
    spans = [s for day in (hours or {}).values() for s in day]
    if not spans:
        return None, None
    fmt = lambda m: f"{min(m, 1439) // 60:02d}:{min(m, 1439) % 60:02d}"  # noqa: E731
    return fmt(min(s[0] for s in spans)), fmt(max(s[1] for s in spans))


def parse_osm_hours(value: str | None) -> dict | None:
    """Handles the common OSM forms: "Mo-Sa 09:00-21:00; Su off", "Mo-Fr 10:00-13:00,17:00-21:00", "24/7"."""
    if not value:
        return None
    value = value.strip()
    if value == "24/7":
        return {d: [[0, 1440]] for d in DAYS}
    osm_days = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
    hours: dict[str, list] = {}
    for rule in value.split(";"):
        rule = rule.strip()
        m = re.match(r"^((?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:[-,](?:Mo|Tu|We|Th|Fr|Sa|Su|PH))*)?\s*(.*)$", rule)
        if not m:
            continue
        day_part, time_part = m.group(1), m.group(2).strip()
        days: list[str] = []
        for chunk in (day_part or "Mo-Su").split(","):
            if chunk == "PH":
                continue
            if "-" in chunk:
                a, b = chunk.split("-")
                if a in osm_days and b in osm_days:
                    i, j = osm_days.index(a), osm_days.index(b)
                    days += osm_days[i:j + 1] if i <= j else osm_days[i:] + osm_days[:j + 1]
            elif chunk in osm_days:
                days.append(chunk)
        if time_part in ("off", "closed"):
            for d in days:
                hours.pop(DAYS[osm_days.index(d)], None)
            continue
        spans = []
        for a, b in re.findall(r"(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})", time_part):
            start = int(a.split(":")[0]) * 60 + int(a.split(":")[1])
            end = int(b.split(":")[0]) * 60 + int(b.split(":")[1])
            if end <= start:
                end = 1440  # closes after midnight
            spans.append([start, end])
        if spans:
            for d in days:
                hours[DAYS[osm_days.index(d)]] = spans
    return hours or None


def parse_google_hours(opening: dict | None) -> dict | None:
    periods = (opening or {}).get("periods") or []
    if not periods:
        return None
    google_days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    hours: dict[str, list] = {}
    for p in periods:
        o, c = p.get("open") or {}, p.get("close")
        if c is None:  # open 24 hours
            return {d: [[0, 1440]] for d in DAYS}
        start = o.get("hour", 0) * 60 + o.get("minute", 0)
        end = c.get("hour", 0) * 60 + c.get("minute", 0)
        if c.get("day") != o.get("day") or end <= start:
            end = 1440
        hours.setdefault(google_days[o.get("day", 0)], []).append([start, end])
    return hours


# ── Google Places (New) ──
async def _google(method: str, path: str, body: dict | None = None, fields: list[str] | None = None, prefix="places."):
    headers = {
        "X-Goog-Api-Key": GOOGLE_KEY,
        "X-Goog-FieldMask": ",".join(prefix + f for f in (fields or GOOGLE_FIELDS)),
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=15) as http:
        res = await http.request(method, f"{GOOGLE}{path}", headers=headers, json=body)
    if res.status_code >= 300:
        raise RuntimeError(f"Google Places {res.status_code}: {res.text[:200]}")
    return res.json()


def _from_google(p: dict, origin: tuple[float, float] | None, specialty: str | None = None) -> dict | None:
    if p.get("businessStatus") and p["businessStatus"] != "OPERATIONAL":
        return None
    loc = p.get("location") or {}
    lat, lng = loc.get("latitude"), loc.get("longitude")
    name = (p.get("displayName") or {}).get("text") or ""
    if lat is None or not name or _NOT_A_DOCTOR.search(name):
        return None
    types = p.get("types") or []
    kind = "hospital" if "hospital" in types else "dentist" if "dentist" in types or "dental_clinic" in types else "clinic"
    comps = {t: c.get("longText") for c in p.get("addressComponents") or [] for t in c.get("types", [])}
    hours = parse_google_hours(p.get("regularOpeningHours"))
    specs = infer_specialities(name, kind, [specialty] if specialty else None)
    return _listing(
        source="google", place_id=p["id"], name=name, kind=kind, lat=lat, lng=lng,
        address=p.get("shortFormattedAddress") or p.get("formattedAddress") or "",
        area=comps.get("sublocality_level_1") or comps.get("sublocality") or comps.get("neighborhood") or comps.get("locality") or "",
        city=comps.get("locality") or comps.get("administrative_area_level_3") or "",
        phone=p.get("internationalPhoneNumber") or p.get("nationalPhoneNumber") or "",
        rating=p.get("rating"), reviews=p.get("userRatingCount"),
        hours=hours, hours_text=" · ".join((p.get("regularOpeningHours") or {}).get("weekdayDescriptions") or []),
        specialities=specs, maps_url=p.get("googleMapsUri") or "", origin=origin,
    )


async def google_nearby(lat: float, lng: float, radius_m: int, specialty: str | None) -> list[dict]:
    origin = (lat, lng)
    circle = {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": float(min(radius_m, 50000))}}
    if specialty and specialty != "General":
        data = await _google("POST", "/places:searchText", {
            "textQuery": SPECIALIST_QUERY.get(specialty, specialty), "locationBias": circle, "pageSize": 20,
            "rankPreference": "DISTANCE",
        })
    else:
        data = await _google("POST", "/places:searchNearby", {
            "includedTypes": ["doctor", "hospital", "dentist"], "maxResultCount": 20,
            "locationRestriction": circle, "rankPreference": "DISTANCE",
        })
    out = [x for x in (_from_google(p, origin, specialty) for p in data.get("places") or []) if x]
    # Text search is only biased to the circle, so drop listings outside it
    return [p for p in out if p["distance_km"] is None or p["distance_km"] <= radius_m / 1000]


async def google_text(q: str, lat: float | None, lng: float | None) -> list[dict]:
    body: dict = {"textQuery": q, "pageSize": 15}
    if lat is not None and lng is not None:
        body["locationBias"] = {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": 30000.0}}
    data = await _google("POST", "/places:searchText", body)
    origin = (lat, lng) if lat is not None and lng is not None else None
    return [x for x in (_from_google(p, origin) for p in data.get("places") or []) if x]


async def google_details(place_id: str) -> dict | None:
    data = await _google("GET", f"/places/{place_id}", prefix="")
    return _from_google(data, None)


# ── OpenStreetMap (Nominatim + Photon) ──
async def _nominatim(path: str, params: dict) -> list[dict]:
    """Nominatim allows 1 request / second — requests are serialised and spaced."""
    global _nominatim_last
    async with _nominatim_lock:
        wait = 1.05 - (time.time() - _nominatim_last)
        if wait > 0:
            await asyncio.sleep(wait)
        try:
            async with httpx.AsyncClient(timeout=20, headers={"User-Agent": USER_AGENT}) as http:
                res = await http.get(f"{NOMINATIM}{path}", params={**params, "format": "jsonv2", "accept-language": "en"})
        finally:
            _nominatim_last = time.time()
    if res.status_code >= 300:
        raise RuntimeError(f"Nominatim {res.status_code}")
    return res.json()


OSM_TYPES = {"N": "node", "W": "way", "R": "relation"}


def _osm_id(x: dict) -> str:
    return f"{(x.get('osm_type') or 'n')[0].upper()}{x.get('osm_id')}"


def _from_nominatim(x: dict, origin: tuple[float, float] | None) -> dict | None:
    name = (x.get("name") or "").strip()
    if not name or _NOT_A_DOCTOR.search(name):
        return None
    tags = x.get("extratags") or {}
    addr = x.get("address") or {}
    kind = x.get("type") if x.get("type") in ("hospital", "dentist") else "clinic"
    extra = [_OSM_SPECIALITY.get(s.strip()) for s in (tags.get("healthcare:speciality") or "").split(";")]
    road = ", ".join(v for v in [addr.get("house_number"), addr.get("road")] if v)
    area = addr.get("suburb") or addr.get("neighbourhood") or addr.get("city_district") or addr.get("quarter") or ""
    city = addr.get("city") or addr.get("town") or addr.get("village") or addr.get("state_district") or ""
    osm = _osm_id(x)
    return _listing(
        source="osm", place_id=osm, name=name, kind=kind, lat=float(x["lat"]), lng=float(x["lon"]),
        address=", ".join(v for v in [road, area, city] if v) or (x.get("display_name") or "")[:200],
        area=area, city=city,
        phone=tags.get("phone") or tags.get("contact:phone") or tags.get("contact:mobile") or "",
        rating=None, reviews=None,
        hours=parse_osm_hours(tags.get("opening_hours")), hours_text=tags.get("opening_hours") or "",
        specialities=infer_specialities(name, kind, [e for e in extra if e]),
        maps_url=f"https://www.openstreetmap.org/{OSM_TYPES.get(osm[0], 'node')}/{osm[1:]}",
        origin=origin,
    )


async def osm_nearby(lat: float, lng: float, radius_m: int, specialty: str | None) -> list[dict]:
    # Nominatim isn't distance-ranked and caps results, so a big box returns a random spread
    # and misses close clinics — also search a small box around the patient and merge.
    radii = sorted({min(radius_m, 3000), radius_m})
    amenities = ["dentist"] if specialty == "Dental" else ["clinic", "doctors", "hospital"]
    rows: list[dict] = []
    for r in radii:
        dlat = r / 111_000
        dlng = r / (111_000 * max(math.cos(math.radians(lat)), 0.2))
        viewbox = f"{lng - dlng},{lat + dlat},{lng + dlng},{lat - dlat}"
        for amenity in amenities:
            try:
                rows += await _nominatim("/search", {
                    "amenity": amenity, "viewbox": viewbox, "bounded": 1, "limit": 40, "extratags": 1, "addressdetails": 1,
                })
            except Exception as e:
                log.warning("Nominatim %s search failed: %s", amenity, e)
    out = [x for x in (_from_nominatim(r, (lat, lng)) for r in rows) if x]
    return [p for p in out if p["distance_km"] is None or p["distance_km"] <= radius_m / 1000 * 1.45]


async def osm_text(q: str, lat: float | None, lng: float | None) -> list[dict]:
    params: list[tuple[str, str | float | int]] = [("q", q), ("limit", 15), ("lang", "en")]
    for tag in ("amenity:clinic", "amenity:doctors", "amenity:hospital", "amenity:dentist", "healthcare"):
        params.append(("osm_tag", tag))
    if lat is not None and lng is not None:
        params += [("lat", lat), ("lon", lng)]
    async with httpx.AsyncClient(timeout=15, headers={"User-Agent": USER_AGENT}) as http:
        res = await http.get(PHOTON, params=params)
    res.raise_for_status()
    origin = (lat, lng) if lat is not None and lng is not None else None
    out = []
    for f in res.json().get("features") or []:
        p = f.get("properties") or {}
        name = (p.get("name") or "").strip()
        if not name or _NOT_A_DOCTOR.search(name):
            continue
        lng2, lat2 = f["geometry"]["coordinates"]
        osm = f"{(p.get('osm_type') or 'N')[0].upper()}{p.get('osm_id')}"
        kind = p.get("osm_value") if p.get("osm_value") in ("hospital", "dentist") else "clinic"
        area = p.get("district") or p.get("locality") or ""
        city = p.get("city") or p.get("county") or ""
        road = ", ".join(v for v in [p.get("housenumber"), p.get("street")] if v)
        out.append(_listing(
            source="osm", place_id=osm, name=name, kind=kind, lat=lat2, lng=lng2,
            address=", ".join(v for v in [road, area, city] if v), area=area, city=city, phone="",
            rating=None, reviews=None, hours=None, hours_text="",
            specialities=infer_specialities(name, kind), maps_url=f"https://www.openstreetmap.org/?mlat={lat2}&mlon={lng2}#map=18/{lat2}/{lng2}",
            origin=origin,
        ))
    if origin:  # Photon is biased to the location, not limited to it
        out = [p for p in out if p["distance_km"] is not None and p["distance_km"] <= 40]
    return out


async def osm_details(osm: str) -> dict | None:
    rows = await _nominatim("/lookup", {"osm_ids": osm, "extratags": 1, "addressdetails": 1})
    return _from_nominatim(rows[0], None) if rows else None


# ── Listing shape (shared by every provider and by registered clinics) ──
def _listing(*, source, place_id, name, kind, lat, lng, address, area, city, phone, rating, reviews,
             hours, hours_text, specialities, maps_url, origin) -> dict:
    open_time, close_time = _hours_summary(hours)
    key = f"{source}:{place_id}"
    item = {
        "key": key, "source": source, "place_id": place_id, "name": name, "kind": kind,
        "lat": lat, "lng": lng, "address": address, "area": area, "city": city, "phone": phone,
        "rating": rating, "reviews": reviews, "hours": hours, "hours_known": bool(hours), "hours_text": hours_text,
        "open_time": open_time, "close_time": close_time, "slot_minutes": 30,
        "specialities": specialities, "fee": place_fee(key), "fee_estimated": True, "maps_url": maps_url,
        "distance_km": round(haversine_km(origin[0], origin[1], lat, lng), 1) if origin else None,
        "clinic_id": None, "on_mediflow": False, "doctors": [], "wait_minutes": None,
    }
    _places[key] = item
    if len(_places) > 20000:
        _places.clear()
        _places[key] = item
    return item


# ── Mediflow clinics (registered / already imported) ──
async def _supabase_get(table: str, query: str) -> list[dict]:
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return []
    headers = {"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {SUPABASE_ANON_KEY}"}
    try:
        async with httpx.AsyncClient(timeout=10) as http:
            res = await http.get(f"{SUPABASE_URL}/rest/v1/{table}?{query}", headers=headers)
        return res.json() if res.status_code < 300 else []
    except Exception as e:
        log.warning("Supabase read %s failed: %s", table, e)
        return []


def _from_clinic_row(c: dict, origin: tuple[float, float] | None) -> dict:
    hours = c.get("hours")
    if not hours and c.get("open_time") and c.get("close_time"):
        o, cl = (int(t[:2]) * 60 + int(t[3:5]) for t in (c["open_time"], c["close_time"]))
        hours = {d: [[o, cl]] for d in DAYS[:6]}
    lat, lng = c.get("latitude"), c.get("longitude")
    return {
        "key": f"{c.get('source')}:{c.get('source_place_id')}" if c.get("source_place_id") else f"mediflow:{c['id']}",
        "source": c.get("source") or "mediflow", "place_id": c.get("source_place_id"), "name": c["name"],
        "kind": "clinic", "lat": lat, "lng": lng, "address": c.get("address") or "", "area": c.get("area") or "",
        "city": c.get("city") or "", "phone": c.get("phone") or "", "rating": c.get("rating"), "reviews": c.get("total_reviews"),
        "hours": hours, "hours_known": bool(hours), "hours_text": "",
        "open_time": c.get("open_time"), "close_time": c.get("close_time"), "slot_minutes": c.get("slot_minutes") or 30,
        "specialities": c.get("specialities") or ["General"], "fee": c.get("consultation_fee"),
        "fee_estimated": not c.get("claimed_at"), "maps_url": c.get("maps_url") or (f"https://www.google.com/maps?q={lat},{lng}" if lat is not None else ""),
        "distance_km": round(haversine_km(origin[0], origin[1], lat, lng), 1) if origin and lat is not None else None,
        "clinic_id": c["id"], "on_mediflow": bool(c.get("claimed_at")), "doctors": [], "wait_minutes": c.get("wait_time_minutes"),
    }


async def merge_mediflow(items: list[dict], lat: float | None, lng: float | None, radius_km: float) -> list[dict]:
    """Attach saved clinic rows to map listings and add registered clinics the map doesn't know."""
    origin = (lat, lng) if lat is not None and lng is not None else None
    ids = [i["place_id"] for i in items if i.get("place_id")]
    queries = []
    if ids:
        quoted = ",".join(f'"{p}"' for p in ids[:80])
        queries.append(_supabase_get("clinics", f"select=*&is_active=eq.true&source_place_id=in.({quoted})"))
    if origin:
        d = radius_km / 111
        dl = radius_km / (111 * max(math.cos(math.radians(lat)), 0.2))
        queries.append(_supabase_get(
            "clinics",
            f"select=*&is_active=eq.true&claimed_at=not.is.null&latitude=gte.{lat - d}&latitude=lte.{lat + d}"
            f"&longitude=gte.{lng - dl}&longitude=lte.{lng + dl}",
        ))
    rows = {r["id"]: r for batch in await asyncio.gather(*queries) for r in batch} if queries else {}

    by_place = {(r.get("source"), r.get("source_place_id")): r for r in rows.values() if r.get("source_place_id")}
    seen: set[str] = set()
    out = []
    for item in items:
        row = by_place.get((item["source"], item["place_id"]))
        if row:
            merged = _from_clinic_row(row, origin)
            # Keep live map data (rating, hours) when the clinic hasn't set its own yet
            for k in ("rating", "reviews", "hours_text", "maps_url"):
                merged[k] = merged[k] or item[k]
            if not row.get("claimed_at"):
                merged["hours"], merged["hours_known"] = item["hours"] or merged["hours"], item["hours_known"]
                merged["open_time"], merged["close_time"] = item["open_time"], item["close_time"]
            item = merged
            seen.add(row["id"])
        out.append(item)
    for row in rows.values():
        if row["id"] not in seen and row.get("claimed_at"):
            out.append(_from_clinic_row(row, origin))

    registered = [i["clinic_id"] for i in out if i["on_mediflow"]]
    if registered:
        docs = await _supabase_get("doctors", f"select=*&clinic_id=in.({','.join(registered)})&is_active=eq.true")
        for i in out:
            if i["on_mediflow"]:
                i["doctors"] = [d for d in docs if d["clinic_id"] == i["clinic_id"]]
    return out


def _sort(items: list[dict]) -> list[dict]:
    seen, unique = set(), []
    for i in items:
        if i["key"] not in seen:
            seen.add(i["key"])
            unique.append(i)
    # Registered clinics first when equally close, then nearest
    return sorted(unique, key=lambda i: (i["distance_km"] if i["distance_km"] is not None else 9999) - (0.5 if i["on_mediflow"] else 0))


def provider() -> str:
    return "google" if GOOGLE_KEY else "osm"


# ── Endpoints ──
@router.get("/places/nearby")
async def nearby(lat: float, lng: float, specialty: str = "", radius_km: float = 5, user: dict = Depends(require_user)):
    radius_km = max(1.0, min(radius_km, 25.0))
    spec = specialty if specialty in SPECIALTY_TAGS else None
    key = f"nearby:{provider()}:{round(lat, 2)}:{round(lng, 2)}:{spec}:{radius_km}"
    items = _cached(key)
    if items is None:
        items = []
        try:
            items = await (google_nearby if GOOGLE_KEY else osm_nearby)(lat, lng, int(radius_km * 1000), spec)
        except Exception as e:
            log.warning("%s nearby failed: %s", provider(), e)
            if GOOGLE_KEY:  # Google down / quota → free fallback
                items = await osm_nearby(lat, lng, int(radius_km * 1000), spec)
        if items:
            _store(key, items)
    # Distances are re-computed from the exact position (the cache key is rounded)
    for i in items:
        i["distance_km"] = round(haversine_km(lat, lng, i["lat"], i["lng"]), 1)
    merged = await merge_mediflow([dict(i) for i in items], lat, lng, radius_km)
    if spec:
        merged = [i for i in merged if spec in i["specialities"] or "General" in i["specialities"]]
    return {"provider": provider(), "places": _sort(merged), "fetched_at": int(time.time())}


@router.get("/places/search")
async def search(q: str, lat: float | None = None, lng: float | None = None, user: dict = Depends(require_user)):
    q = q.strip()[:80]
    if len(q) < 2:
        return {"provider": provider(), "places": []}
    key = f"text:{provider()}:{q.lower()}:{round(lat or 0, 1)}:{round(lng or 0, 1)}"
    items = _cached(key)
    if items is None:
        items = []
        try:
            items = await (google_text if GOOGLE_KEY else osm_text)(q, lat, lng)
        except Exception as e:
            log.warning("%s search failed: %s", provider(), e)
            if GOOGLE_KEY:
                items = await osm_text(q, lat, lng)
        _store(key, items, 3600)
    if lat is not None and lng is not None:
        for i in items:
            i["distance_km"] = round(haversine_km(lat, lng, i["lat"], i["lng"]), 1)
    merged = await merge_mediflow([dict(i) for i in items], lat, lng, 10)
    # Registered clinics whose name matches, even if the map doesn't have them
    rows = await _supabase_get("clinics", f"select=*&is_active=eq.true&claimed_at=not.is.null&name=ilike.*{q.replace('*', '')}*&limit=10")
    have = {i["clinic_id"] for i in merged if i["clinic_id"]}
    merged += [_from_clinic_row(r, (lat, lng) if lat is not None and lng is not None else None) for r in rows if r["id"] not in have]
    return {"provider": provider(), "places": _sort(merged)[:20]}


@router.get("/places/geocode")
async def geocode(q: str, user: dict = Depends(require_user)):
    """Address → coordinates (clinic sign-up for clinics that aren't on the map)."""
    rows = await _nominatim("/search", {"q": q[:200], "limit": 5, "addressdetails": 1, "countrycodes": "in"})
    return {"results": [
        {"label": r.get("display_name"), "lat": float(r["lat"]), "lng": float(r["lon"]),
         "area": (r.get("address") or {}).get("suburb") or (r.get("address") or {}).get("neighbourhood") or "",
         "city": (r.get("address") or {}).get("city") or (r.get("address") or {}).get("town") or ""}
        for r in rows
    ]}


@router.post("/places/import")
async def import_place(payload: dict, user: dict = Depends(require_user)):
    """Save a map listing as a clinic (first booking / clinic claim) → {clinic_id}."""
    key = str(payload.get("key") or "")
    source, _, place_id = key.partition(":")
    if source not in ("google", "osm") or not place_id:
        raise HTTPException(400, "Unknown clinic")
    place = _places.get(key)
    if place is None:  # server restarted since the search — look the place up again
        try:
            place = await (google_details(place_id) if source == "google" and GOOGLE_KEY else osm_details(place_id))
        except Exception as e:
            log.warning("place lookup %s failed: %s", key, e)
        if not place:
            raise HTTPException(404, "This clinic couldn't be found on the map any more.")
    params = {
        "p_source": source, "p_place_id": place_id, "p_name": place["name"], "p_address": place["address"],
        "p_area": place["area"], "p_city": place["city"], "p_lat": place["lat"], "p_lng": place["lng"],
        "p_phone": place["phone"], "p_rating": place["rating"], "p_reviews": place["reviews"],
        "p_open": place["open_time"], "p_close": place["close_time"], "p_hours": place["hours"],
        "p_specialities": place["specialities"], "p_maps_url": place["maps_url"],
    }
    headers = {"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {user['_token']}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=15) as http:
        res = await http.post(f"{SUPABASE_URL}/rest/v1/rpc/import_place_clinic", headers=headers, json=params)
    if res.status_code >= 300:
        msg = res.json().get("message", res.text) if res.content else res.text
        log.warning("import_place_clinic failed: %s", msg)
        if "Could not find the function" in msg or "PGRST202" in res.text:
            raise HTTPException(503, "Database update pending: run supabase/migrations/20261019_real_data.sql.")
        raise HTTPException(502, "Couldn't save this clinic. Please try again.")
    return {"clinic_id": res.json()}
