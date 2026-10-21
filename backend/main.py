from fastapi import Depends, FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from groq import Groq
from pypdf import PdfReader
import asyncio
import io
import os
import re
import time
import traceback
import json

load_dotenv()

# Imported after load_dotenv so they see the .env values
from emergency import lifespan, router as emergency_router  # noqa: E402
from facts import router as facts_router  # noqa: E402
from pharmacy import price_line, router as pharmacy_router, search_prices  # noqa: E402
from places import router as places_router  # noqa: E402
from security import redact, require_user  # noqa: E402

app = FastAPI(title="Mediflow AI Backend", lifespan=lifespan)

# Website origins allowed to call the API — comma-separated, e.g.
# ALLOWED_ORIGINS=https://mediflowai.in,https://www.mediflowai.in,https://clinic.mediflowai.in
DEFAULT_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000,https://mediflowai.in,https://www.mediflowai.in,https://clinic.mediflowai.in"
ALLOWED_ORIGINS = [o.strip().rstrip("/") for o in (os.getenv("ALLOWED_ORIGINS") or DEFAULT_ORIGINS).split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    # Vercel preview deployments (https://<project>-<hash>.vercel.app) when ALLOWED_ORIGIN_REGEX is set
    allow_origin_regex=os.getenv("ALLOWED_ORIGIN_REGEX") or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

app.include_router(emergency_router)
app.include_router(places_router)
app.include_router(pharmacy_router)
app.include_router(facts_router)

# Single model used by every endpoint
MODEL = "openai/gpt-oss-20b"


# ─────────────────────────────────────────────
# MAIN CHAT — Mediflow AI Agent
# ─────────────────────────────────────────────
SYSTEM_PROMPT = """You are Mediflow AI — a warm, caring health assistant for India. Think of yourself as the patient's doctor friend: kind, reassuring, knowledgeable, never robotic.
You help patients with THREE things ONLY:
1. Booking a clinic appointment
2. Ordering medicines
3. Analysing health reports (blood test, CBC, lipid profile, thyroid, etc.)

ANY symptom, disease or condition (e.g. "cancer", "diabetes", "back pain", "anxiety") is ON-TOPIC:
respond with empathy in 1–2 lines, say which specialist helps, and offer to book.
Example for "Cancer": "I'm really sorry you're dealing with this 💙 An oncologist is the right specialist, and a General Physician can guide you on the first steps. Would you like me to find a doctor near you?"
[🏥 Book Appointment] [Ask a question] [🏠 Main menu]

Only truly unrelated requests (movies, coding, cricket scores…) → reply: "I'd love to help! I can book appointments, help with medicines, or analyse your health reports. Which would you like?"
[🏥 Book Appointment] [💊 Order Medicine] [🔬 Analyse My Report]

Every question you ask MUST end with a question mark (?).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OPTION FORMAT (CRITICAL — the app turns these into tappable buttons)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- EVERY reply that expects an answer MUST end with 2–7 short options in square brackets on their own line:
  [Option A] [Option B] [Option C]
- Square brackets are ONLY for options. Never use them for anything else.
- Never nest brackets. Never use Markdown links like [text](url) — write URLs as plain text.
- Keep each option under 5 words.
- In this prompt, {curly braces} are placeholders you fill in — never print curly braces or square brackets around filled-in values.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PERSONALITY RULES (ALWAYS FOLLOW)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Warm and friendly, like a caring doctor friend. Show empathy ("Oh no, sorry you're feeling unwell 😟")
- Ask ONLY ONE question per reply — never bombard with multiple questions
- Keep replies short and scannable — no walls of text, no Markdown tables
- Use simple Indian English
- Use the conversation history — never re-ask something the patient already answered
- End medicine advice with: ⚕️ Please consult a doctor before taking any medicine.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MODULE 1 — BOOKING FLOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Trigger: "book", "appointment", "need doctor", "see doctor", "find clinic"

IMPORTANT: In the Mediflow app, booking runs as a guided flow with REAL clinics from our database.
In free chat, never invent clinics or doctors — reply in one warm line and offer:
[🏥 Book Appointment] [🏠 Main menu]
The steps below describe that guided flow (concern → budget → 2 clinics → time slot → confirm).

The app shares the patient's location automatically (see PATIENT CONTEXT at the end).
If a location is known, NEVER ask for it. If it's unknown, ask once: "Which area are you in?"

STEP 1 — HEALTH CONCERN:
"I have your location 📍 {area}. What's bothering you today?"
[Fever / Cold / Flu] [Stomach Issue] [Skin Problem] [Eye / Ear / Throat] [Body Pain] [General Checkup] [Other]

STEP 2 — SPECIALTY (suggest the right one):
Fever/Cold → General Physician | Skin → Dermatologist | Eye → Ophthalmologist
Ear/Throat → ENT | Stomach → Gastroenterologist | Body Pain → Orthopedic | Kids → Pediatrician
"For this, a {specialty} would be best. Shall I look for one?"
[Yes, {specialty}] [General Physician] [Different specialist]
(If the suggestion already IS General Physician, offer: [Yes, please] [Different specialist])

STEP 3 — BUDGET:
"What's your budget for the consultation fee?"
[Under ₹300] [₹300-500] [₹500-1000] [No preference]

STEP 4 — SHOW EXACTLY 2 CLINICS near their area, within their budget:

🏥 Option 1 — {Clinic Name}
👨‍⚕️ Dr. {Name} | {Specialty} | {X} yrs exp
💰 ₹{fee} consultation
⭐ {rating}/5 ({reviews} reviews) | 📍 {X} km away

🏥 Option 2 — {Clinic Name}
👨‍⚕️ Dr. {Name} | {Specialty} | {X} yrs exp
💰 ₹{fee} consultation
⭐ {rating}/5 ({reviews} reviews) | 📍 {X} km away

"Which one works for you?"
[Book Option 1] [Book Option 2] [See more clinics]

STEP 5 — TIME SLOT:
"Great choice! 😊 Pick a time slot for today:"
[9:00 AM] [10:00 AM] [11:00 AM] [2:00 PM] [3:00 PM] [5:00 PM] [6:00 PM]

STEP 6 — CONFIRM:
✅ Appointment Booked!

🏥 {Clinic Name}
👨‍⚕️ Dr. {Name}
📅 Today at {time}
💰 ₹{fee} (pay at clinic)

Show your Mediflow Patient ID at reception.
You'll get a reminder 30 minutes before. Get well soon! 💙

[Book another] [Go to Home]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MODULE 2 — MEDICINE ORDERING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Trigger: "medicine", "order", "buy tablet", or any medicine name.
If they haven't named a medicine yet, ask: "Which medicine do you need, or what symptom is it for?"

STEP 1 — DETECT OTC vs PRESCRIPTION:
OTC (no prescription needed):
Paracetamol, Dolo 650, Crocin, Calpol, Ibuprofen, Combiflam,
Vitamin C/D/B12, Zinc, Calcium, Antacids (Digene, Eno, Gelusil),
Allergy (Cetirizine, Allegra), Cough (Benadryl, Honitus),
Ayurvedic (Giloy, Tulsi drops, Ashwagandha), Balms (Vicks, Moov, Volini)

Prescription required:
Antibiotics, Montelukast (Montair), Diabetes meds, BP meds, Thyroid meds, Steroids,
Sleeping pills, Antidepressants, Blood thinners, Painkillers with codeine/tramadol

STEP 2A — OTC MEDICINE:
✅ {Medicine} doesn't need a prescription!

💊 Allopathy: {Brand}
Active: {ingredient} | Works in: {time}
Side effects: {brief list}
Avoid if: {conditions}

🌿 Ayurvedic alternative: {name}
Works in: {time} (gentler)
Good for: mild cases, if you prefer natural

🛒 Live prices: tap "💊 Order Medicine" to compare today's prices on 1mg, PharmEasy & Netmeds.
NEVER state a medicine price yourself — prices change daily and the app fetches them live.

⚕️ Please consult a doctor before taking any medicine.
[Ask about another medicine] [Book a doctor] [Go to Home]

STEP 2B — PRESCRIPTION MEDICINE:
🔒 {Medicine} needs a valid prescription — it's safest taken under a doctor's guidance.
"What would you like to do?"
[Upload prescription] [Book doctor] [Ask about alternatives]

If upload → thank them, then suggest "💊 Order Medicine" to compare live prices.
If book doctor → switch to MODULE 1.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MODULE 3 — REPORT ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Trigger: "report", "blood test", "analyse", or the patient pastes test values.
If they haven't shared values yet, ask: "Please paste your report values here (e.g. Hb 10.2, Vitamin D 14, TSH 5.8) 📋"
[I'll paste it now] [What tests should I do?]

Once you have values, analyse immediately:

📋 REPORT SUMMARY
• Each abnormal value: "{Test}: {Value} (Normal: {range}) — {1-line explanation}"
• If all normal: "Great news! All your values look normal 🎉"

🔍 WHAT THIS MEANS FOR YOU
• Plain language, Indian daily-life context (energy, sleep, digestion, immunity)

🥗 WHAT TO EAT MORE
• Specific Indian foods per issue, e.g. "Low iron → palak, rajma, dates, jaggery, beetroot"

🏃 EXERCISE & LIFESTYLE
• Specific to their values — plus sleep, stress, hydration tips

💊 SUPPLEMENTS TO CONSIDER
• Based on deficiencies; mention which need a prescription

⚠️ WHEN TO SEE A DOCTOR
• Flag urgent values clearly: "Your {test} is significantly {high/low} — please see a doctor within {timeframe}"

"Would you like me to book a follow-up with a doctor?"
[Yes, book appointment] [Ask a question] [Analyse another report]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SAFETY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If the patient mentions chest pain, difficulty breathing, fainting, stroke signs, heavy bleeding, or suicidal thoughts:
"🚨 This sounds urgent. Please call 112 or go to the nearest emergency room right now."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LANGUAGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Match the patient's language exactly — English or Hindi.
If they mix both (Hinglish), you mix both too. Keep option labels short in the same language."""


# ─────────────────────────────────────────────
# MEDICINE COMPARISON — JSON endpoint
# ─────────────────────────────────────────────
MEDICINE_PROMPT = """You are Mediflow AI's medicine comparison engine for India.
Respond ONLY with valid JSON in this exact format — no extra text:
{
  "comparison": "2-3 line honest summary comparing options. Patient decides.",
  "medicines": [
    {
      "name": "Medicine name",
      "type": "Allopathy or Ayurvedic or Homeopathy",
      "origin": "India or USA or Germany",
      "works_in": "30-45 minutes",
      "recovery_time": "1-2 days",
      "best_for": "Short description",
      "evidence": "Strong or Moderate or Limited",
      "side_effects": "Honest list",
      "avoid": "Who should not take this",
      "search_term": "Exact product name as sold in Indian pharmacies, e.g. Dolo 650 or Patanjali Giloy Ghanvati"
    }
  ]
}
Give 2–4 options. Always include one Ayurvedic option if it exists.
Do NOT include prices — the app fetches live prices from pharmacies using search_term.
Accuracy rules:
- Use the exact Indian brand strength (e.g. Dolo = Dolo 650, Paracetamol 650 mg).
- The Ayurvedic option MUST treat the same condition (e.g. fever → Giloy / Tulsi; acidity → Avipattikar;
  cold → Sitopaladi). Never suggest an unrelated tonic like Ashwagandha for fever or pain.
- Never invent Ayurvedic options for prescription-only conditions (antibiotics, diabetes, BP, thyroid).
Return ONLY JSON."""


# ─────────────────────────────────────────────
# FITNESS COACH
# ─────────────────────────────────────────────
FITNESS_PROMPT = """You are an expert AI Fitness Coach, Dietitian, and Personal Trainer for India.
You care deeply about your client — patient, encouraging, consistent like a great teacher.

YOUR PERSONALITY:
- Warm, motivating, specific
- Ask ONE question at a time
- Use Indian food and lifestyle references
- Celebrate small wins enthusiastically
- Give actionable advice, not generic tips
- Use emojis to make responses friendly

WHAT YOU DO:
1. COACHING: Ask about daily routine, sleep, stress, energy
2. DIET: Suggest Indian meals — dal, roti, sabzi, fruits, millets
3. EXERCISE: Explain step-by-step, suggest home workouts
4. FOOD ANALYSIS: When they describe what they ate, analyse it
5. BLOOD REPORTS: When they share values, explain and suggest diet changes
6. MOTIVATION: Check progress, encourage consistency

RULES:
- Only fitness, diet, exercise, wellness topics
- Never prescribe medicines — refer to doctor
- Always end with an encouraging message or clear next step
- Respond in English or Hindi based on what the patient uses"""


def own_names(user: dict) -> list[str]:
    """The signed-in patient's name — scrubbed from text before it reaches the AI."""
    meta = user.get("user_metadata") or {}
    return [n for n in [meta.get("name"), meta.get("full_name")] if n]


def clean_json_response(raw: str):
    """Parse JSON from a model reply — tolerates code fences and stray text around it."""
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("Empty model reply")
    start, end = raw.find("{"), raw.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(raw[start:end + 1])
        except json.JSONDecodeError:
            pass
    if raw.startswith("```json"):
        raw = raw[7:]
    elif raw.startswith("```"):
        raw = raw[3:]
    if raw.endswith("```"):
        raw = raw[:-3]
    return json.loads(raw.strip())


# ─────────────────────────────────────────────
# ENDPOINTS
# ─────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "Mediflow AI backend is running ✅"}


@app.post("/chat")
def chat(payload: dict, user: dict = Depends(require_user)):
    """Main AI chat — handles booking, medicine, report analysis."""
    try:
        names = own_names(user)
        user_message = redact(payload.get("message", ""), names)
        history = payload.get("history", []) or []  # conversation history for context
        location = (payload.get("location") or "").strip()

        context = (
            "\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nPATIENT CONTEXT\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            f"Location: {location or 'unknown — ask for their area only when booking'}"
        )
        messages = [{"role": "system", "content": SYSTEM_PROMPT + context}]

        # Include last 10 messages for context (keeps token usage reasonable)
        for msg in history[-10:]:
            if msg.get("role") in ("user", "assistant") and msg.get("content"):
                messages.append({"role": msg["role"], "content": redact(msg["content"], names)})

        messages.append({"role": "user", "content": user_message})

        # gpt-oss is a reasoning model — reasoning tokens count towards max_tokens,
        # so keep effort low and leave enough room for a full report analysis.
        response = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            max_tokens=2000,
            temperature=0.7,
            reasoning_effort="low",
        )

        reply = (response.choices[0].message.content or "").strip()
        if not reply:
            reply = (
                "Hmm, I lost my train of thought there 😅 Could you say that again?\n"
                "[🏥 Book Appointment] [💊 Order Medicine] [🔬 Analyse My Report]"
            )
        return {"reply": reply}

    except Exception as e:
        return {
            "error": str(e),
            "reply": "Sorry, I'm having a moment 😅 Please try again in a second.",
        }


# ─────────────────────────────────────────────
# GUIDED-BOT HELPERS (structured JSON for the chat UI)
# ─────────────────────────────────────────────
SPECIALTY_TAGS = [
    "General", "Pediatric", "Cardio", "Ortho", "Skin", "Neuro", "Gynecology",
    "Dental", "Eye", "ENT", "Gastro", "Psychiatry", "Oncology", "Other",
]

TRIAGE_PROMPT = f"""You are a medical triage assistant for an Indian clinic-booking app.
Given the patient's health concern, respond ONLY with valid JSON:
{{
  "tag": one of {SPECIALTY_TAGS},
  "specialist": "Human name of the right specialist, e.g. Dermatologist, Oncologist, General Physician",
  "emergency": true or false,
  "empathy": "ONE warm, short sentence acknowledging the concern (max 15 words, no question)"
}}
emergency = true ONLY for: chest pain, difficulty breathing, stroke signs, fainting, severe bleeding,
seizures, suicidal thoughts, poisoning, severe injury.
Return ONLY JSON."""

MEDICINE_CHECK_PROMPT = """You are a licensed Indian pharmacist assistant.
The patient typed a medicine name OR a symptom. Respond ONLY with valid JSON:
{
  "found": true,
  "name": "Brand or common name, e.g. Dolo 650",
  "generic": "Active ingredient + strength, e.g. Paracetamol 650 mg",
  "category": "e.g. Fever & pain relief",
  "requires_prescription": false,
  "uses": "One short line",
  "allopathy": {
    "name": "Dolo 650",
    "works_in": "30–60 min",
    "side_effects": "Short honest list",
    "avoid_if": "Short list"
  },
  "ayurvedic": {
    "name": "e.g. Patanjali Giloy Ghanvati (or null if no sensible alternative)",
    "works_in": "e.g. 2–3 days (gentler)",
    "note": "When it makes sense"
  },
  "advice": "One practical safety line",
  "search_term": "short term to search on pharmacy sites, e.g. dolo 650"
}
Rules:
- If the patient typed a symptom, pick the most common SAFE OTC option for it in India.
- requires_prescription = true for antibiotics, antivirals, diabetes, BP, thyroid, heart, steroids,
  sleeping pills, antidepressants, anti-epileptics, blood thinners, opioids, montelukast, and any Schedule H/H1/X drug.
- If prescription is required, set "ayurvedic" to null.
- If it is not a medicine or symptom at all, return {"found": false}.
- Never include prices (the app shows live pharmacy prices).
Return ONLY JSON."""

# Safety net — these always require a prescription, whatever the model says
RX_PATTERNS = re.compile(
    r"(azithro|amoxi|augmentin|cipro|ofloxa|levoflox|doxy|cefix|ceftri|cephalex|metronid|"
    r"metformin|glimepir|insulin|sitaglip|amlodip|telmisar|losartan|atenolol|metoprolol|"
    r"thyrox|eltroxin|levothyrox|predniso|dexameth|methylpred|alprazol|clonazep|lorazep|zolpidem|"
    r"sertral|escitalo|fluoxet|warfarin|clopidogrel|atorvast|rosuvast|tramadol|codeine|montelukast|montair|"
    r"sildenafil|oseltamivir|acyclovir|valacyclo)",
    re.IGNORECASE,
)


@app.post("/triage")
def triage(payload: dict, user: dict = Depends(require_user)):
    """Map a free-text concern to a specialty tag (for clinic matching)."""
    concern = redact((payload.get("concern") or "").strip(), own_names(user))
    try:
        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": TRIAGE_PROMPT},
                {"role": "user", "content": concern[:500]},
            ],
            max_tokens=600,
            temperature=0.2,
            reasoning_effort="low",
        )
        data = clean_json_response(response.choices[0].message.content or "")
        if data.get("tag") not in SPECIALTY_TAGS:
            data["tag"] = "Other"
        return data
    except Exception as e:
        return {
            "tag": "General",
            "specialist": "General Physician",
            "emergency": False,
            "empathy": "Thanks for sharing that.",
            "error": str(e),
        }


def _complete(**kwargs):
    """Groq call off the event loop (the SDK is synchronous)."""
    return asyncio.to_thread(client.chat.completions.create, **kwargs)


@app.post("/medicine-check")
async def medicine_check(payload: dict, user: dict = Depends(require_user)):
    """Structured OTC vs prescription check + allopathy / ayurvedic comparison, with live prices."""
    query = redact((payload.get("query") or "").strip(), own_names(user))
    try:
        response = await _complete(
            model=MODEL,
            messages=[
                {"role": "system", "content": MEDICINE_CHECK_PROMPT},
                {"role": "user", "content": query[:200]},
            ],
            max_tokens=1200,
            temperature=0.2,
            reasoning_effort="low",
        )
        data = clean_json_response(response.choices[0].message.content or "")
        if data.get("found") and RX_PATTERNS.search(
            f"{data.get('name', '')} {data.get('generic', '')} {query}"
        ):
            data["requires_prescription"] = True
            data["ayurvedic"] = None
        if data.get("found"):
            allo = data.get("allopathy") or {}
            ayur = data.get("ayurvedic") or {}
            terms = [allo.get("name") or data.get("search_term") or data.get("name"), ayur.get("name")]
            prices = await asyncio.gather(*(search_prices(t) for t in terms if t), return_exceptions=True)
            prices = [p if isinstance(p, dict) else None for p in prices]
            if allo and prices and prices[0]:
                allo["prices"] = prices[0]["best"]
                allo["price"] = price_line(prices[0])
            if ayur and len(prices) > 1 and prices[1]:
                ayur["prices"] = prices[1]["best"]
                ayur["price"] = price_line(prices[1])
            data["prices_fetched_at"] = next((p["fetched_at"] for p in prices if p), None)
        return data
    except Exception as e:
        return {"found": False, "error": str(e)}


@app.post("/extract-report")
async def extract_report(file: UploadFile = File(...), user: dict = Depends(require_user)):
    """Extract text from an uploaded report (PDF or text file)."""
    try:
        content = await file.read()
        name = (file.filename or "").lower()
        if name.endswith(".pdf") or file.content_type == "application/pdf":
            reader = PdfReader(io.BytesIO(content))
            text = "\n".join((page.extract_text() or "") for page in reader.pages[:10])
        elif name.endswith((".txt", ".csv")) or (file.content_type or "").startswith("text/"):
            text = content.decode("utf-8", errors="ignore")
        else:
            return {"text": "", "error": "unsupported"}
        return {"text": text.strip()[:6000]}
    except Exception as e:
        return {"text": "", "error": str(e)}


@app.post("/medicine")
async def medicine_compare(payload: dict, user: dict = Depends(require_user)):
    """Compare treatment options for a symptom or medicine — clinical info from the AI, prices live from pharmacies."""
    try:
        query = redact(payload.get("query", ""), own_names(user))

        response = await _complete(
            model=MODEL,
            messages=[
                {"role": "system", "content": MEDICINE_PROMPT},
                {"role": "user", "content": f"Compare treatment options for: {query}"},
            ],
            max_tokens=3000,
            reasoning_effort="low",
        )

        data = clean_json_response(response.choices[0].message.content)
        meds = [m for m in data.get("medicines") or [] if isinstance(m, dict) and m.get("name")][:4]
        results = await asyncio.gather(
            *(search_prices(m.get("search_term") or m["name"]) for m in meds), return_exceptions=True
        )
        for med, live in zip(meds, results):
            live = live if isinstance(live, dict) else None
            med["prices"] = live["best"] if live else []
            med["other_offers"] = [o for o in (live["offers"] if live else []) if o not in med["prices"]][:6]
            med["links"] = live["links"] if live else {}
            med["sources"] = live["sources"] if live else {}
        data["medicines"] = meds
        data["prices_fetched_at"] = int(time.time())
        return data

    except Exception as e:
        return {
            "comparison": "Unable to load comparison right now. Please try again.",
            "medicines": [],
            "error": str(e),
        }


@app.post("/fitness-coach")
def fitness_coach(payload: dict, user: dict = Depends(require_user)):
    """AI Fitness Coach with patient profile context."""
    try:
        names = own_names(user)
        user_message = redact(payload.get("message", ""), names)
        body_stats = payload.get("bodyStats", {})
        bmi = payload.get("bmi", None)
        history = payload.get("history", [])

        has_stats = any(body_stats.values()) if body_stats else False
        context = f"""
Height: {body_stats.get('height', 'unknown')} cm
Weight: {body_stats.get('weight', 'unknown')} kg
Age: {body_stats.get('age', 'unknown')}
Gender: {body_stats.get('gender', 'unknown')}
Goal: {body_stats.get('goal', 'unknown')}
Activity Level: {body_stats.get('activityLevel', 'unknown')}
BMI: {bmi if bmi else 'not calculated'}
""" if has_stats else "Patient profile not yet provided."

        messages = [
            {
                "role": "system",
                "content": FITNESS_PROMPT + f"\n\nPATIENT PROFILE:\n{context}",
            }
        ]

        for msg in history[-10:]:
            if msg.get("role") in ("user", "assistant") and msg.get("content"):
                messages.append({"role": msg["role"], "content": redact(msg["content"], names)})

        messages.append({"role": "user", "content": user_message})

        response = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            max_tokens=1500,
            reasoning_effort="low",
            temperature=0.7,
        )

        return {"reply": response.choices[0].message.content}

    except Exception as e:
        return {
            "error": str(e),
            "reply": "Sorry, I'm having trouble connecting 😅 Please try again.",
        }


@app.post("/analyze-food")
def analyze_food(payload: dict, user: dict = Depends(require_user)):
    """Analyse nutrition content of a food description. Returns JSON."""
    try:
        food = redact(payload.get("food", ""), own_names(user))

        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {
                    "role": "system",
                    "content": """You are a nutrition expert. Respond ONLY with valid JSON:
{
  "calories": 250,
  "protein": 8,
  "carbs": 45,
  "fat": 6,
  "rating": "Good",
  "suggestion": "Add more protein — try a boiled egg or paneer"
}
Rating must be: Excellent, Good, Average, or Poor.
Suggestion must be practical and India-specific.
Return ONLY valid JSON. No extra text.""",
                },
                {"role": "user", "content": f"Analyse nutrition for: {food}"},
            ],
            max_tokens=1000,
            reasoning_effort="low",
        )

        return clean_json_response(response.choices[0].message.content)

    except Exception as e:
        return {
            "calories": 0,
            "protein": 0,
            "carbs": 0,
            "fat": 0,
            "rating": "Unknown",
            "suggestion": "Could not analyse. Please try again.",
            "error": str(e),
        }


@app.post("/meal-plan")
def meal_plan(payload: dict, user: dict = Depends(require_user)):
    """Generate a personalised 3-month Indian meal plan."""
    try:
        body_stats = payload.get("bodyStats", {})
        bmi = payload.get("bmi", None)

        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {
                    "role": "system",
                    "content": """You are an expert Indian dietitian. Create a 3-month personalised meal plan.
Respond ONLY with valid JSON:
{
  "summary": "2-3 lines about the plan and expected results",
  "months": [
    {
      "title": "Month 1 — Reset & Foundation",
      "focus": "Clean eating, reduce processed food, build habits",
      "days": [
        {
          "day": "Monday",
          "breakfast": "Oats with banana and 5 almonds — 300 cal",
          "lunch": "2 chapati + moong dal + sabzi + salad — 450 cal",
          "snack": "Apple + 1 handful roasted chana — 150 cal",
          "dinner": "Khichdi with ghee + curd — 350 cal"
        }
      ]
    }
  ]
}
Include all 3 months with 7 days each. Use realistic Indian meals.
Calories must match the patient's goal. Return ONLY JSON.""",
                },
                {
                    "role": "user",
                    "content": (
                        f"Create 3-month meal plan for: "
                        f"Height {body_stats.get('height')}cm, "
                        f"Weight {body_stats.get('weight')}kg, "
                        f"Age {body_stats.get('age')}, "
                        f"Goal: {body_stats.get('goal')}, "
                        f"BMI: {bmi}"
                    ),
                },
            ],
            max_tokens=10000,
            reasoning_effort="low",
        )

        return clean_json_response(response.choices[0].message.content)

    except Exception as e:
        return {
            "summary": "Could not generate plan. Please try again.",
            "months": [],
            "error": str(e),
        }


@app.post("/analyze-blood-report")
def analyze_blood_report(payload: dict, user: dict = Depends(require_user)):
    """Full blood report analysis with diet and lifestyle recommendations."""
    try:
        report_text = redact(payload.get("report_text", ""), own_names(user))
        body_stats = payload.get("bodyStats", {})
        bmi = payload.get("bmi", None)

        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {
                    "role": "system",
                    "content": f"""You are an expert medical analyst and health coach.
Analyse this blood report for the patient and give clear, compassionate, actionable advice.

Structure your response EXACTLY like this — use these exact headers:

📋 REPORT SUMMARY
[List each abnormal value: "[Test]: [Value] (Normal: [range]) — simple explanation"]
[If all normal: "All your values look normal! Great health."]

🔍 WHAT THIS MEANS FOR YOU
[Plain language, Indian daily life context, no jargon]

🥗 WHAT TO EAT MORE
[Specific Indian foods for each issue — palak, rajma, dates, etc.]

🏃 EXERCISE & LIFESTYLE
[Specific recommendations based on values — not generic advice]

💊 SUPPLEMENTS TO CONSIDER
[Based on deficiencies. Note which need prescription]

⚠️ WHEN TO SEE A DOCTOR
[Flag any urgent values. Be specific about timeframe]

Patient: BMI {bmi}, Goal: {body_stats.get('goal', 'stay healthy')}
Keep language warm, simple, encouraging. Use Indian food examples.""",
                },
                {
                    "role": "user",
                    "content": f"Please analyse this blood report:\n\n{report_text[:3000]}",
                },
            ],
            max_tokens=3000,
            reasoning_effort="low",
        )

        return {"analysis": response.choices[0].message.content}

    except Exception as e:
        return {
            "analysis": "Sorry, I couldn't analyse the report right now. Please try again.",
            "error": str(e),
        }
