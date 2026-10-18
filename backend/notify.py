"""WhatsApp + missed-call alerts via Twilio.

Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM (e.g. +14155238886)
and TWILIO_VOICE_FROM (a Twilio voice number) in backend/.env to send for real.
Without them every alert runs in TEST MODE: logged, recorded on the case timeline
as "test mode", and nothing is sent.
"""

import logging
import os
import re

import httpx

log = logging.getLogger("mediflow.notify")

SID = os.getenv("TWILIO_ACCOUNT_SID") or ""
TOKEN = os.getenv("TWILIO_AUTH_TOKEN") or ""
WA_FROM = os.getenv("TWILIO_WHATSAPP_FROM") or ""
VOICE_FROM = os.getenv("TWILIO_VOICE_FROM") or ""


def live_whatsapp() -> bool:
    return bool(SID and TOKEN and WA_FROM)


def live_calls() -> bool:
    return bool(SID and TOKEN and VOICE_FROM)


def normalize_phone(phone: str | None) -> str | None:
    """'+91 98765 43210' / '9876543210' → '+919876543210'."""
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 10:
        return "+91" + digits
    if len(digits) == 12 and digits.startswith("91"):
        return "+" + digits
    return "+" + digits if len(digits) >= 10 else None


async def send_whatsapp(to: str | None, body: str) -> str:
    """Returns 'sent', 'test_mode', 'no_number' or 'failed'."""
    number = normalize_phone(to)
    if not number:
        return "no_number"
    if not live_whatsapp():
        log.info("[TEST MODE] WhatsApp → %s: %s", number, body.replace("\n", " | "))
        return "test_mode"
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            res = await http.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json",
                auth=(SID, TOKEN),
                data={"From": f"whatsapp:{WA_FROM}", "To": f"whatsapp:{number}", "Body": body},
            )
        if res.status_code >= 300:
            log.warning("WhatsApp to %s failed: %s %s", number, res.status_code, res.text[:200])
            return "failed"
        return "sent"
    except Exception as e:  # network errors must never break the emergency flow
        log.warning("WhatsApp to %s failed: %s", number, e)
        return "failed"


async def missed_call(to: str | None) -> str:
    """Rings the number for ~20s then hangs up — a 'missed call' buzz."""
    number = normalize_phone(to)
    if not number:
        return "no_number"
    if not live_calls():
        log.info("[TEST MODE] Missed call → %s", number)
        return "test_mode"
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            res = await http.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{SID}/Calls.json",
                auth=(SID, TOKEN),
                data={
                    "From": VOICE_FROM,
                    "To": number,
                    "Timeout": "20",
                    "Twiml": "<Response><Say>Mediflow emergency alert. Please check your dashboard.</Say><Hangup/></Response>",
                },
            )
        return "sent" if res.status_code < 300 else "failed"
    except Exception as e:
        log.warning("Missed call to %s failed: %s", number, e)
        return "failed"
