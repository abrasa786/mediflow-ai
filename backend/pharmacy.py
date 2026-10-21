"""Live medicine prices from Tata 1mg, PharmEasy and Netmeds (their public website search APIs).

Every price shown in the app comes from here — the AI never invents prices. Results are cached
for 30 minutes; if a pharmacy is unreachable it's simply left out (and reported in "sources").
"""

import asyncio
import logging
import re
import time

import httpx
from fastapi import APIRouter, Depends

from security import require_user

log = logging.getLogger("mediflow.pharmacy")
router = APIRouter()

BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
CACHE_TTL = 30 * 60
_cache: dict[str, tuple[float, dict]] = {}

PLATFORMS = {
    "1mg": "Tata 1mg",
    "pharmeasy": "PharmEasy",
    "netmeds": "Netmeds",
}


def search_links(term: str) -> dict[str, str]:
    from urllib.parse import quote

    q = quote(term.strip())
    return {
        "1mg": f"https://www.1mg.com/search/all?name={q}",
        "pharmeasy": f"https://pharmeasy.in/search/all?name={q}",
        "netmeds": f"https://www.netmeds.com/products?q={q}",
    }


def _num(v) -> float | None:
    try:
        n = float(v)
        return n if n > 0 else None
    except (TypeError, ValueError):
        return None


def _offer(platform, name, price, mrp, pack, url, rx, maker="", available=True) -> dict | None:
    price = _num(price)
    mrp = _num(mrp)
    if not name or price is None:
        return None
    if mrp is not None and mrp < price:
        mrp = None
    return {
        "platform": platform, "platform_name": PLATFORMS[platform], "name": name.strip(), "price": round(price, 2),
        "mrp": round(mrp, 2) if mrp else None,
        "discount_pct": round((1 - price / mrp) * 100) if mrp else 0,
        "pack": pack or "", "url": url, "rx_required": bool(rx), "manufacturer": maker or "", "available": bool(available),
    }


async def _onemg(http: httpx.AsyncClient, term: str) -> list[dict]:
    res = await http.get(
        "https://www.1mg.com/api/v1/search/autocomplete",
        params={"name": term, "pageSize": 15, "types": "sku,allopathy"},
    )
    res.raise_for_status()
    out = []
    for x in res.json().get("results") or []:
        if x.get("type") == "query_suggestion" or not x.get("url_path") or x.get("hide_sku_price"):
            continue
        out.append(_offer(
            "1mg", x.get("label") or re.sub(r"<[^>]+>", "", x.get("name") or ""),
            x.get("discounted_price") or x.get("price"), x.get("price"), x.get("pack_size_label"),
            f"https://www.1mg.com{x['url_path']}", x.get("rx_required"), x.get("marketer_name"), x.get("saleable", True),
        ))
    return [o for o in out if o]


async def _pharmeasy(http: httpx.AsyncClient, term: str) -> list[dict]:
    res = await http.get("https://pharmeasy.in/api/search/search/", params={"intent_id": 1, "q": term, "page": 1})
    res.raise_for_status()
    out = []
    for x in ((res.json().get("data") or {}).get("products") or [])[:15]:
        if x.get("isSponsored"):
            continue
        path = "online-medicine-order" if x.get("productType") == 1 else "health-care/products"
        out.append(_offer(
            "pharmeasy", x.get("name"), x.get("salePriceDecimal"), x.get("mrpDecimal"), x.get("measurementUnit"),
            f"https://pharmeasy.in/{path}/{x.get('slug')}", x.get("isRxRequired"), x.get("manufacturer"),
            (x.get("productAvailabilityFlags") or {}).get("isAvailable", True),
        ))
    return [o for o in out if o]


async def _netmeds(http: httpx.AsyncClient, term: str) -> list[dict]:
    res = await http.get(
        "https://www.netmeds.com/ext/search/application/api/v1.0/products", params={"q": term, "page_size": 15}
    )
    res.raise_for_status()
    out = []
    for x in res.json().get("items") or []:
        price = x.get("price") or {}
        attrs = x.get("attributes") or {}
        out.append(_offer(
            "netmeds", x.get("name"), (price.get("effective") or {}).get("min"), (price.get("marked") or {}).get("min"),
            attrs.get("mstar-packlabel") or "", f"https://www.netmeds.com/product/{x.get('slug')}",
            str(attrs.get("mstar-rxrequired") or "").lower().startswith("rx"),
            attrs.get("marketername") or attrs.get("manufacturername") or "", x.get("sellable", True) is not False,
        ))
    return [o for o in out if o]


_FETCHERS = {"1mg": _onemg, "pharmeasy": _pharmeasy, "netmeds": _netmeds}


def _tokens(s: str) -> list[str]:
    return re.findall(r"[a-z]+|\d+", s.lower())


def relevance(query: str, name: str) -> float:
    """Share of query words found in the product name; every number (strength) must match."""
    q, n = _tokens(query), set(_tokens(name))
    if not q:
        return 0
    if any(t.isdigit() and t not in n for t in q):
        return 0
    # Whole-word matches count fully; a typed prefix ("azithro" → azithromycin) only half,
    # so "Dolo 650" doesn't match other brands like "Dolosen 650"
    hits = sum(1 if t in n else 0.5 if len(t) >= 5 and any(w.startswith(t) for w in n) else 0 for t in q)
    first = 0.5 if q[0] in n or name.lower().startswith(q[0]) else 0
    return hits / len(q) + first


async def search_prices(term: str) -> dict:
    """All offers for a medicine across pharmacies, best matches first."""
    term = re.sub(r"\s+", " ", term.strip())[:60]
    key = term.lower()
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]

    async with httpx.AsyncClient(timeout=12, headers={"User-Agent": BROWSER_UA, "Accept": "application/json"}) as http:
        results = await asyncio.gather(*(f(http, term) for f in _FETCHERS.values()), return_exceptions=True)

    sources, offers = {}, []
    for platform, r in zip(_FETCHERS, results):
        if isinstance(r, Exception):
            log.warning("%s price search failed for %r: %s", platform, term, r)
            sources[platform] = False
        else:
            sources[platform] = True
            offers += r
    for o in offers:
        o["relevance"] = round(relevance(term, o["name"]), 2)
    offers = [o for o in offers if o["relevance"] > 0.5]
    offers.sort(key=lambda o: (-o["relevance"], not o["available"], o["price"]))

    data = {
        "query": term, "offers": offers[:30], "best": best_per_platform(offers),
        "sources": sources, "links": search_links(term), "fetched_at": int(time.time()),
    }
    if any(sources.values()):
        _cache[key] = (time.time() + CACHE_TTL, data)
    return data


def best_per_platform(offers: list[dict]) -> list[dict]:
    """Same product on each pharmacy (top match per platform), cheapest first."""
    if not offers:
        return []
    top = max(o["relevance"] for o in offers)
    best: dict[str, dict] = {}
    for o in offers:
        if o["relevance"] >= top - 0.25 and o["available"]:
            if o["platform"] not in best or o["price"] < best[o["platform"]]["price"]:
                best[o["platform"]] = o
    return sorted(best.values(), key=lambda o: o["price"])


def price_line(data: dict) -> str | None:
    """Short real-price summary for chat cards, e.g. "₹25.18 – ₹32.28 (15 tablets) · live"."""
    best = data.get("best") or []
    if not best:
        return None
    lo, hi = best[0]["price"], best[-1]["price"]
    pack = f" ({best[0]['pack']})" if best[0].get("pack") else ""
    return (f"₹{lo:g}" if lo == hi else f"₹{lo:g} – ₹{hi:g}") + pack


@router.get("/medicine/prices")
async def medicine_prices(q: str, user: dict = Depends(require_user)):
    return await search_prices(q)
