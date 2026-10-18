"""Emergency SOS: case creation, clinic confirmation, and the escalation worker.

Escalation chain (until the clinic taps "Spoke to Patient" or "Doctor Assigned"):
  • clinic WhatsApp every 60 s     • clinic missed call every 90 s
  • emergency contact every 2 min  • re-assign to next clinic after 3 min (SQL: escalate_emergencies)
The worker also sends appointment reminders 30 minutes before. It needs
SUPABASE_SERVICE_ROLE_KEY; without it, alerts still fire when a case is created /
confirmed, and re-assignment still runs via pg_cron and open status pages.
"""

import asyncio
import contextlib
import logging
import os
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException

from notify import live_whatsapp, missed_call, send_whatsapp
from security import SUPABASE_ANON_KEY, SUPABASE_URL, require_user

log = logging.getLogger("mediflow.emergency")
router = APIRouter()

SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
CLINIC_PORTAL_URL = os.getenv("CLINIC_PORTAL_URL") or "https://clinic.mediflowai.in"
APP_URL = os.getenv("APP_URL") or "https://mediflowai.in"
IST = timezone(timedelta(hours=5, minutes=30))

CLINIC_WHATSAPP_EVERY = 60
CLINIC_CALL_EVERY = 90
CONTACT_EVERY = 120
WORKER_TICK = 15


class DB:
    """Minimal PostgREST client — as a user (RLS applies) or as the service role."""

    def __init__(self, token: str | None = None):
        key = SERVICE_KEY if token is None else SUPABASE_ANON_KEY
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {token or SERVICE_KEY}",
            "Content-Type": "application/json",
        }

    async def rpc(self, fn: str, params: dict | None = None):
        async with httpx.AsyncClient(timeout=15) as http:
            res = await http.post(f"{SUPABASE_URL}/rest/v1/rpc/{fn}", headers=self.headers, json=params or {})
        if res.status_code >= 300:
            raise HTTPException(res.status_code if res.status_code < 500 else 502, res.json().get("message", res.text))
        return res.json() if res.content else None

    async def select(self, table: str, query: str) -> list[dict]:
        async with httpx.AsyncClient(timeout=15) as http:
            res = await http.get(f"{SUPABASE_URL}/rest/v1/{table}?{query}", headers=self.headers)
        if res.status_code >= 300:
            log.warning("select %s failed: %s", table, res.text[:200])
            return []
        return res.json()

    async def update(self, table: str, query: str, values: dict):
        async with httpx.AsyncClient(timeout=15) as http:
            await http.patch(f"{SUPABASE_URL}/rest/v1/{table}?{query}", headers=self.headers, json=values)


def _maps(lat, lng) -> str:
    return f"https://maps.google.com/?q={lat},{lng}" if lat is not None and lng is not None else ""


def _due(ts: str | None, every: int) -> bool:
    if not ts:
        return True
    return datetime.fromisoformat(ts.replace("Z", "+00:00")) <= datetime.now(timezone.utc) - timedelta(seconds=every)


async def _load(db: DB, case_id: str) -> tuple[dict | None, dict, dict]:
    cases = await db.select("emergency_cases", f"id=eq.{case_id}&select=*")
    if not cases:
        return None, {}, {}
    case = cases[0]
    clinic = (await db.select("clinics", f"id=eq.{case['clinic_id']}&select=*"))[0] if case.get("clinic_id") else {}
    patients = await db.select(
        "patients",
        f"id=eq.{case['patient_id']}&select=name,phone,patient_id,emergency_contact_name,emergency_contact_phone",
    )
    return case, clinic, (patients[0] if patients else {})


async def _record(db: DB, case_id: str, kind: str, message: str, result: str):
    """Timeline entry + bump the matching last_*_at timestamp (via SQL function)."""
    with contextlib.suppress(Exception):
        await db.rpc("record_emergency_alert", {"p_case": case_id, "p_kind": kind, "p_message": message, "p_mode": result})


async def alert_round(db: DB, case: dict, clinic: dict, patient: dict):
    """Send whatever alerts are due for one active case."""
    name = patient.get("name") or "A Mediflow patient"
    if case["status"] == "assigned" and clinic:
        if _due(case.get("last_clinic_alert_at"), CLINIC_WHATSAPP_EVERY):
            dist = f" ({case['distance_km']} km)" if case.get("distance_km") is not None else ""
            body = (
                f"🚨 EMERGENCY CASE ASSIGNED — {name}, {case['case_type']}, {case.get('area') or 'location shared'}{dist}\n"
                f"Mediflow ID: {patient.get('patient_id') or '—'} · Patient phone: {patient.get('phone') or '—'}\n"
                f"{_maps(case.get('latitude'), case.get('longitude'))}\n"
                f"Open {CLINIC_PORTAL_URL} and tap 'Spoke to Patient' or 'Doctor Assigned' to stop these alerts."
            )
            res = await send_whatsapp(clinic.get("whatsapp_phone") or clinic.get("phone"), body)
            await _record(db, case["id"], "whatsapp_clinic", f"WhatsApp alert sent to {clinic.get('name')}", res)
        if _due(case.get("last_clinic_call_at"), CLINIC_CALL_EVERY):
            res = await missed_call(clinic.get("phone"))
            await _record(db, case["id"], "call_clinic", f"Missed-call alert to {clinic.get('name')}", res)

    contact = patient.get("emergency_contact_phone")
    if contact and case["status"] in ("assigned", "unassigned") and _due(case.get("last_contact_alert_at"), CONTACT_EVERY):
        if not case.get("last_contact_alert_at"):
            where = f"Assigned to {clinic.get('name')}, {clinic.get('area')}. {_maps(clinic.get('latitude'), clinic.get('longitude'))}" if clinic else "Finding the nearest clinic now."
            body = f"⚠️ {name} triggered an emergency on Mediflow AI. {where}\nIf you can, call {name} and dial 108 for an ambulance."
        else:
            body = f"Still reaching a doctor for {name}. Please also call 108 for an ambulance."
        res = await send_whatsapp(contact, body)
        await _record(db, case["id"], "whatsapp_contact", f"Emergency contact {patient.get('emergency_contact_name') or ''} updated on WhatsApp".strip(), res)


async def final_messages(db: DB, case: dict, clinic: dict, patient: dict):
    name = patient.get("name") or "The patient"
    cname = clinic.get("name") or "the clinic"
    if case["status"] == "doctor_assigned":
        to_patient = f"✅ {case.get('doctor_name') or 'A doctor'} is ready for you at {cname}. Show Mediflow ID {patient.get('patient_id') or ''} at reception."
        to_contact = f"✅ {case.get('doctor_name') or 'A doctor'} assigned at {cname}. {name}'s case is being handled."
    else:
        to_patient = f"✅ {cname} has your case and will guide you. Show Mediflow ID {patient.get('patient_id') or ''} at reception."
        to_contact = f"✅ {cname} spoke to {name}. The case is being handled."
    await send_whatsapp(patient.get("phone"), to_patient)
    if patient.get("emergency_contact_phone"):
        await send_whatsapp(patient["emergency_contact_phone"], to_contact)


# ── Endpoints ──

@router.post("/emergency")
async def create_emergency(payload: dict, user: dict = Depends(require_user)):
    """Create + auto-assign an SOS case and fire the first alerts immediately."""
    db = DB(user["_token"])
    case_id = await db.rpc(
        "create_emergency_case",
        {
            "p_type": (payload.get("type") or "Emergency")[:60],
            "p_message": (payload.get("message") or "")[:500],
            "p_lat": payload.get("lat"),
            "p_lng": payload.get("lng"),
            "p_area": (payload.get("area") or "")[:120],
        },
    )
    case, clinic, patient = await _load(db, case_id)
    if case:
        await alert_round(db, case, clinic, patient)
    return {"case_id": case_id, "whatsapp_live": live_whatsapp()}


@router.post("/emergency/confirm")
async def confirm_emergency(payload: dict, user: dict = Depends(require_user)):
    """Clinic marks 'spoke_to_patient' or 'doctor_assigned' — stops all escalation."""
    db = DB(user["_token"])
    await db.rpc(
        "clinic_respond_emergency",
        {"p_case": payload.get("case_id"), "p_action": payload.get("action"), "p_doctor": payload.get("doctor") or None},
    )
    case, clinic, patient = await _load(db, payload.get("case_id"))
    if case:
        await final_messages(db, case, clinic, patient)
    return {"ok": True}


@router.post("/emergency/dispatch")
async def dispatch_ambulance(payload: dict, user: dict = Depends(require_user)):
    """Clinic dispatches its ambulance → returns the driver's secret tracking token."""
    db = DB(user["_token"])
    token = await db.rpc(
        "clinic_dispatch_ambulance",
        {
            "p_case": payload.get("case_id"),
            "p_driver": (payload.get("driver") or "")[:80],
            "p_phone": (payload.get("phone") or "")[:20],
            "p_vehicle": (payload.get("vehicle") or "")[:20],
        },
    )
    case, clinic, patient = await _load(db, payload.get("case_id"))
    if case:
        vehicle = case.get("ambulance_vehicle") or "Ambulance"
        driver = f"Driver {case.get('ambulance_driver_name')}" if case.get("ambulance_driver_name") else "Driver"
        phone = f" ({case.get('ambulance_driver_phone')})" if case.get("ambulance_driver_phone") else ""
        await send_whatsapp(
            patient.get("phone"),
            f"🚑 {vehicle} is on the way from {clinic.get('name', 'the clinic')}. {driver}{phone}.\n"
            f"Track it live: {APP_URL}/emergency/{case['id']}",
        )
        if patient.get("emergency_contact_phone"):
            await send_whatsapp(
                patient["emergency_contact_phone"],
                f"🚑 An ambulance ({vehicle}) from {clinic.get('name', 'the clinic')} is on the way to "
                f"{patient.get('name') or 'the patient'}. {driver}{phone}.",
            )
    return {"token": token}


@router.post("/emergency/cancel")
async def cancel_emergency(payload: dict, user: dict = Depends(require_user)):
    """Patient is safe — cancel and tell the clinic + contact."""
    db = DB(user["_token"])
    case, clinic, patient = await _load(db, payload.get("case_id"))
    await db.rpc("cancel_emergency", {"p_case": payload.get("case_id")})
    if case and case["status"] in ("assigned", "unassigned"):
        name = patient.get("name") or "The patient"
        if clinic:
            await send_whatsapp(clinic.get("whatsapp_phone") or clinic.get("phone"), f"ℹ️ Emergency for {name} was cancelled by the patient. No action needed.")
        if patient.get("emergency_contact_phone"):
            await send_whatsapp(patient["emergency_contact_phone"], f"ℹ️ {name} marked themselves safe on Mediflow. The emergency was cancelled.")
    return {"ok": True}


# ── Background worker ──

async def _process_events(db: DB):
    events = await db.select("emergency_events", "needs_notify=eq.true&notified_at=is.null&select=*&order=id.asc&limit=50")
    for ev in events:
        # Only re-assignment needs a message here: new-clinic alerts come from alert_round,
        # and final / cancel messages are sent by the /emergency/confirm and /cancel endpoints.
        if ev["kind"] == "cancel_notice" and ev["data"].get("clinic_id"):
            old = (await db.select("clinics", f"id=eq.{ev['data']['clinic_id']}&select=phone,whatsapp_phone")) or [{}]
            await send_whatsapp(
                old[0].get("whatsapp_phone") or old[0].get("phone"),
                "ℹ️ Mediflow: the emergency case sent to you was re-assigned to another clinic. No action needed.",
            )
        await db.update("emergency_events", f"id=eq.{ev['id']}", {"notified_at": datetime.now(timezone.utc).isoformat()})


async def _reminders(db: DB):
    now = datetime.now(IST)
    today = now.strftime("%Y-%m-%d")
    rows = await db.select(
        "appointments",
        f"appointment_date=eq.{today}&status=eq.confirmed&reminder_sent_at=is.null&select=id,patient_id,clinic_id,appointment_time",
    )
    for a in rows:
        try:
            t = datetime.strptime(f"{today} {a['appointment_time']}", "%Y-%m-%d %I:%M %p").replace(tzinfo=IST)
        except ValueError:
            continue
        if timedelta(0) <= t - now <= timedelta(minutes=30):
            p = (await db.select("patients", f"id=eq.{a['patient_id']}&select=name,phone,patient_id")) or [{}]
            c = (await db.select("clinics", f"id=eq.{a['clinic_id']}&select=name,address")) or [{}]
            await send_whatsapp(
                p[0].get("phone"),
                f"⏰ Reminder: your appointment at {c[0].get('name')} is at {a['appointment_time']} today.\n"
                f"📍 {c[0].get('address') or ''}\nShow Mediflow ID {p[0].get('patient_id') or ''} at reception.",
            )
            await db.update("appointments", f"id=eq.{a['id']}", {"reminder_sent_at": datetime.now(timezone.utc).isoformat()})


async def worker_loop():
    if not SERVICE_KEY:
        log.warning("SUPABASE_SERVICE_ROLE_KEY not set — repeat alerts & reminders are disabled "
                    "(re-assignment still runs via pg_cron / open status pages).")
        return
    db = DB()
    while True:
        try:
            await db.rpc("escalate_emergencies")
            for case in await db.select("emergency_cases", "status=in.(assigned,unassigned)&select=id"):
                c, clinic, patient = await _load(db, case["id"])
                if c:
                    await alert_round(db, c, clinic, patient)
            await _process_events(db)
            await _reminders(db)
        except Exception as e:
            log.warning("worker tick failed: %s", e)
        await asyncio.sleep(WORKER_TICK)


@contextlib.asynccontextmanager
async def lifespan(_app):
    task = asyncio.create_task(worker_loop())
    yield
    task.cancel()
