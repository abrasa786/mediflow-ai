"""Real health facts for the home page ticker — from MyHealthfinder (U.S. ODPHP, health.gov).

Each fact is the opening sentence of an evidence-based health topic, with a link to its source.
The topic list is fetched live and cached for 12 hours; each request gets a fresh random selection.
"""

import html
import logging
import random
import re
import time

import httpx
from fastapi import APIRouter

log = logging.getLogger("mediflow.facts")
router = APIRouter()

SOURCE = "https://odphp.health.gov/myhealthfinder/api/v4/topicsearch.json"
CACHE_TTL = 12 * 3600
_cache: dict = {"at": 0.0, "facts": []}

ICONS = [
    (r"heart|blood pressure|cholesterol", "🫀"), (r"nutrition|food|eat|diet", "🥗"), (r"physical activity|exercise|active", "🏃"),
    (r"sleep", "😴"), (r"cancer|screen", "🔬"), (r"vaccin|immuniz|shot", "💉"), (r"child|baby|teen", "👶"),
    (r"mental|stress|depress", "🧠"), (r"tobacco|smok|alcohol", "🚭"), (r"diabetes", "🩸"), (r"oral|teeth|dental", "🦷"),
    (r"safety|fall|injur", "🦺"), (r"pregnan|women", "🤰"),
]


def _first_sentence(content: str) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", content or ""))
    text = re.sub(r"\s+", " ", text).strip()
    m = re.match(r"(.{30,220}?[.!?])(\s|$)", text)
    return m.group(1) if m else ""


def _icon(title: str, category: str) -> str:
    for pattern, icon in ICONS:
        if re.search(pattern, f"{title} {category}", re.I):
            return icon
    return "💡"


async def load_facts() -> list[dict]:
    if _cache["facts"] and _cache["at"] > time.time():
        return _cache["facts"]
    try:
        async with httpx.AsyncClient(timeout=20) as http:
            res = await http.get(SOURCE, params={"lang": "en"})
        res.raise_for_status()
        resources = res.json()["Result"]["Resources"]["Resource"]
    except Exception as e:
        log.warning("MyHealthfinder fetch failed: %s", e)
        return _cache["facts"]  # keep serving the last good copy

    facts = []
    for r in resources:
        sections = (r.get("Sections") or {}).get("section") or []
        sentence = next((s for s in (_first_sentence(x.get("Content", "")) for x in sections) if s), "")
        if not sentence or len(sentence) > 220:
            continue
        facts.append({
            "text": sentence, "topic": html.unescape(r.get("Title", "")).strip(), "category": r.get("Categories", ""),
            "icon": _icon(r.get("Title", ""), r.get("Categories", "")), "url": r.get("AccessibleVersion", ""),
            "updated": int(r["LastUpdate"]) if str(r.get("LastUpdate", "")).isdigit() else None,
        })
    if facts:
        _cache.update(at=time.time() + CACHE_TTL, facts=facts)
    return facts


@router.get("/health/facts")
async def health_facts(count: int = 8):
    facts = await load_facts()
    pick = random.sample(facts, min(max(count, 1), 20, len(facts))) if facts else []
    return {"source": "MyHealthfinder — U.S. Office of Disease Prevention and Health Promotion (health.gov)", "facts": pick}
