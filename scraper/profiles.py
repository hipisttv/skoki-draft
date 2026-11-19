"""Profile zawodników: kariera z bazy FIS -> data/profiles/<id>.json + data/profiles/index.json.

Dla każdego zawodnika z punktami PŚ zeszłego sezonu (i emerytów z tej listy):
  - miejsce i punkty w klasyfikacji PŚ w każdym sezonie (+ Turniej Czterech Skoczni, loty, Raw Air…),
  - podia PŚ w każdym sezonie (1., 2., 3. miejsca),
  - bilans: starty / podia / zwycięstwa w PŚ, na igrzyskach, MŚ i MŚ w lotach,
  - medale (igrzyska, MŚ, MŚ w lotach) z datą i miejscem, debiuty.

Profil odświeżany raz na tydzień; jedno uruchomienie aktualizuje najwyżej --max zawodników (domyślnie 20),
żeby bot co 15 minut nie pobierał wszystkiego naraz.

Użycie:  python scraper/profiles.py [--max 20] [--all]
"""
import argparse
import datetime as dt
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from fis import BASE, fetch, text  # noqa: E402

CAREER = {
    "Olympic Winter Games": "OWG",
    "FIS Ski-Flying World Championships": "SFWC",
    "World Championships": "WSC",
    "World Cup": "WC",
}


def bio_url(cid, **params):
    q = "".join(f"&{k}={v}" for k, v in params.items())
    return f"{BASE}/general/athlete-biography.html?sectorcode=JP&competitorid={cid}{q}"


def num(s):
    s = (s or "").replace("'", "").replace("’", "").strip()
    return int(s) if s.isdigit() else None


def parse_cups(h):
    """Sezon po sezonie: klasyfikacja generalna PŚ i cykle (Four Hills, Ski Flying, Raw Air…)."""
    seasons = {}
    for m in re.finditer(r'<a class="table-row" href="[^"]*cup-standings\.html\?[^"]*seasoncode=(\d{4})&amp;cupcode=WC[^"]*"(.*?)</a>|'
                         r'<a class="table-row" href="[^"]*cup-standings\.html\?[^"]*seasoncode=(\d{4})&cupcode=WC[^"]*"(.*?)</a>', h, re.S):
        season = int(m.group(1) or m.group(3))
        body = m.group(2) or m.group(4)
        cups = {}
        for g in re.finditer(r'hidden-md-up justify-left">\s*([^<]+?)\s*</div>\s*<div[^>]*>\s*([^<]*?)\s*</div>\s*<div[^>]*>\s*([^<]*?)\s*</div>', body):
            rank, pts = num(g.group(2)), num(g.group(3))
            if rank or pts:
                cups[g.group(1).strip()] = [rank, pts]
        if cups:
            seasons[season] = cups
    return seasons


def parse_podiums(h):
    t = text(h)
    i = t.find("Season Position 1 Position 2 Position 3 Podiums")
    if i < 0:
        return {}
    seg = t[i:t.find("Sign up", i)]
    return {int(s): [int(a), int(b), int(c)] for s, a, b, c, _ in re.findall(r"\b(\d{4}) (\d+) (\d+) (\d+) (\d+)\b", seg)}


def parse_career(h):
    t = text(h)
    i = t.find("Career Information Career Information")
    t = t[i:] if i >= 0 else t
    out = {}
    names = "|".join(re.escape(n) for n in CAREER)
    for m in re.finditer(rf"({names}) IND Individual(.*?)(?=(?:{names}) IND Individual|Numbers for team|Debut|$)", t, re.S):
        block = m.group(2)
        st = re.search(r"Starts (\d+)", block)
        po = re.search(r"Podiums (\d+)", block)
        vi = re.search(r"Victories (\d+)", block)
        out[CAREER[m.group(1)]] = {"starts": int(st.group(1)) if st else 0, "podiums": int(po.group(1)) if po else 0,
                                   "wins": int(vi.group(1)) if vi else 0}
    debut = {}
    for kind, d, place, rank in re.findall(r"First (FIS event|OWG|SFWC|WSC|WC) start (\d{2}\.\d{2}\.\d{4}) (.+?), IND rank: (\d+)", t):
        debut[{"FIS event": "FIS"}.get(kind, kind)] = {"date": d, "place": place, "rank": int(rank)}
    return out, debut


def parse_medals(h, cat):
    t = text(h)
    out = []
    for d, place, hill, nation, pos in re.findall(
            rf"(\d{{2}}-\d{{2}}-\d{{4}}) (.+?) \2 ((?:Mixed Team |Super Team |Team )?(?:Normal|Large|Flying) Hill(?: HS\d+)?) ([A-Z]{{3}}) {cat} {cat} .+? (\d+) //", t):
        if int(pos) <= 3:
            out.append({"date": d, "place": place, "hill": hill, "nation": nation, "cat": cat, "pos": int(pos),
                        "team": bool(re.match(r"(Mixed |Super )?Team", hill))})
    return out


WC_POINTS = [100, 80, 60, 50, 45, 40, 36, 32, 29, 26, 24, 22, 20, 18, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
TCS_PLACES = ("Oberstdorf", "Garmisch-Partenkirchen", "Innsbruck", "Bischofshofen")


def season_tours(season, out):
    """Klasyfikacje cykli sezonu policzone z oficjalnych wyników konkursów.

    FIS w biogramach i na stronach cykli nie ma jeszcze sezonu 2025/26 (podstawia poprzedni rok), więc:
      - Turniej Czterech Skoczni (mężczyźni) / Two Nights Tour (kobiety, Garmisch + Oberstdorf):
        suma not łącznych z konkursów turnieju,
      - PŚ w lotach: suma punktów PŚ z konkursów indywidualnych na skoczniach mamucich.
    Wynik w data/tours-<sezon>.json: {id: {"Four Hills": [miejsce, punkty], ...}}.
    """
    path = os.path.join(out, f"tours-{season}.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    from fis import calendar_url, parse_calendar, parse_event, parse_results
    sums = {}  # (cykl, płeć) -> {id: punkty}
    for ev in parse_calendar(fetch(calendar_url(season, "WC")), season):
        if ev["nation"] == "FIS":
            continue
        eh = fetch(f"{BASE}/general/event-details.html?sectorcode=JP&eventid={ev['id']}&seasoncode={season}")
        for r in parse_event(eh, season):
            if r["category"] != "WC" or r["team"] or r["cancelled"]:
                continue
            md = r["date"][5:]
            tcs = ev["place"] in TCS_PLACES and (md >= "12-25" or md <= "01-10")
            flying = "Flying" in r["discipline"]
            if not (tcs or flying):
                continue
            rows = parse_results(fetch(f"{BASE}/general/results.html?sectorcode=JP&raceid={r['id']}"))
            for x in rows:
                if tcs and x["total"]:
                    key = ("Four Hills" if r["gender"] == "M" else "Two Nights Tour", r["gender"])
                    sums.setdefault(key, {})[x["id"]] = sums.get(key, {}).get(x["id"], 0) + x["total"]
                if flying and x["rank"] and x["rank"] <= 30:
                    key = ("Ski Flying Standing", r["gender"])
                    sums.setdefault(key, {})[x["id"]] = sums.get(key, {}).get(x["id"], 0) + WC_POINTS[x["rank"] - 1]
    result = {}
    for (name, _), pts in sums.items():
        ranked = sorted(pts.items(), key=lambda kv: -kv[1])
        rank = 0
        for i, (aid, p) in enumerate(ranked):
            if i == 0 or p != ranked[i - 1][1]:
                rank = i + 1
            result.setdefault(aid, {})[name] = [rank, round(p, 1) if name != "Ski Flying Standing" else int(p)]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  cykle {season}: " + ", ".join(f"{n} ({g}) – {len(v)} zawodników" for (n, g), v in sums.items()))
    return result


def add_tours(prof, tours, season):
    """Uzupełnia cykle sezonu, którego FIS nie ma w biogramie (puste „---”)."""
    t = tours.get(prof["id"])
    if not t:
        return
    for s in prof["seasons"]:
        if s["season"] == season and not s.get("tours"):
            s["tours"] = t


def build_profile(cid):
    cups = parse_cups(fetch(bio_url(cid, type="cups")))
    podiums = parse_podiums(fetch(bio_url(cid, type="podiums")))
    career, debut = parse_career(fetch(bio_url(cid, type="career")))
    medals = []
    for cat in ("OWG", "WSC", "SFWC"):
        if career.get(cat, {}).get("starts"):
            medals += parse_medals(fetch(bio_url(cid, type="result", categorycode=cat, seasoncode="", position=3)), cat)
    seasons = []
    for s in sorted(set(cups) | set(podiums)):
        c = cups.get(s, {})
        ov = c.get("Overall") or [None, None]
        seasons.append({"season": s, "rank": ov[0], "points": ov[1], "podiums": podiums.get(s, [0, 0, 0]),
                        "tours": {k: v for k, v in c.items() if k != "Overall"}})
    medals.sort(key=lambda m: (m["date"][6:], m["date"][3:5], m["date"][:2]), reverse=True)
    return {"id": cid, "updated": dt.date.today().isoformat(), "career": career, "debut": debut,
            "seasons": seasons, "medals": medals}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data")
    ap.add_argument("--max", type=int, default=20)
    ap.add_argument("--all", action="store_true", help="odśwież wszystkie od razu")
    ap.add_argument("--ids", nargs="*", help="tylko ci zawodnicy (test)")
    args = ap.parse_args()
    folder = os.path.join(args.out, "profiles")
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(args.out, "athletes.json"), encoding="utf-8") as f:
        adata = json.load(f)
    people = [a for a in adata["athletes"] if a.get("wc")]
    prev = adata["season"] - 1
    try:
        tours = season_tours(prev, args.out)
    except Exception as e:  # noqa: BLE001
        print(f"  cykle {prev}: {e}", file=sys.stderr)
        tours = {}
    try:
        with open(os.path.join(args.out, "standings.json"), encoding="utf-8") as f:
            people += json.load(f).get("previous", {}).get("retired", [])
    except (OSError, ValueError):
        pass
    if args.ids:
        people = [a for a in people if a["id"] in args.ids]

    def age(a):
        p = os.path.join(folder, f"{a['id']}.json")
        if not os.path.exists(p):
            return 999
        with open(p, encoding="utf-8") as f:
            return (dt.date.today() - dt.date.fromisoformat(json.load(f).get("updated", "2000-01-01"))).days

    todo = [a for a in people if args.all or args.ids or age(a) >= 7]
    todo.sort(key=age, reverse=True)
    if not (args.all or args.ids):
        todo = todo[:args.max]
    for a in todo:
        try:
            prof = build_profile(a["id"])
            add_tours(prof, tours, prev)
        except Exception as e:  # noqa: BLE001
            print(f"  {a['name']}: {e}", file=sys.stderr)
            continue
        with open(os.path.join(folder, f"{a['id']}.json"), "w", encoding="utf-8") as f:
            json.dump(prof, f, ensure_ascii=False, separators=(",", ":"))
        wc = prof["career"].get("WC", {})
        print(f"  {a['name']}: {len(prof['seasons'])} sezonów, PŚ {wc.get('wins', 0)} zw. / {wc.get('podiums', 0)} podiów, medale {len(prof['medals'])}")
    # indeks: kto ma profil (tylko ci z jakimkolwiek startem w PŚ)
    index = []
    for name in sorted(os.listdir(folder)):
        if name.endswith(".json") and name != "index.json":
            with open(os.path.join(folder, name), encoding="utf-8") as f:
                p = json.load(f)
            before = json.dumps(p, sort_keys=True)
            add_tours(p, tours, prev)
            if json.dumps(p, sort_keys=True) != before:
                with open(os.path.join(folder, name), "w", encoding="utf-8") as f:
                    json.dump(p, f, ensure_ascii=False, separators=(",", ":"))
            if p.get("career", {}).get("WC", {}).get("starts") or p.get("seasons"):
                index.append(p["id"])
    with open(os.path.join(folder, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f)
    print(f"Profile: {len(index)} (zaktualizowano {len(todo)})")


if __name__ == "__main__":
    main()
