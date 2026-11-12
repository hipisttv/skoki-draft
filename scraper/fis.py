"""Pobiera dane z bazy FIS (skoki narciarskie, Puchar Świata) i zapisuje je jako JSON w katalogu data/.

Użycie:
    python scraper/fis.py                 # bieżący sezon (wg daty)
    python scraper/fis.py --season 2027   # sezon 2026/27
    python scraper/fis.py --out data_test --season 2026

Pliki wynikowe:
    data/athletes.json    – zawodnicy (M i K) posortowani wg punktów PŚ z zeszłego sezonu
    data/calendar.json    – weekendy PŚ z listą konkursów
    data/results/<raceid>.json – wyniki konkursu (miejsca, odległości)
"""
import argparse
import datetime as dt
import html
import json
import os
import re
import sys
import time
import urllib.request

BASE = "https://www.fis-ski.com/DB"
UA = "Mozilla/5.0 (skoki-draft scraper)"
MONTHS = {m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}


def fetch(url, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", errors="replace")
        except Exception as e:  # noqa: BLE001
            if attempt == retries - 1:
                raise
            print(f"  retry {url}: {e}", file=sys.stderr)
            time.sleep(3 * (attempt + 1))


def text(fragment):
    t = re.sub(r"<[^>]+>", " ", fragment)
    return re.sub(r"\s+", " ", html.unescape(t)).strip()


def current_season(today=None):
    """Sezon FIS oznaczany jest rokiem zakończenia (2026/27 -> 2027)."""
    today = today or dt.date.today()
    return today.year + 1 if today.month >= 7 else today.year


def season_date(day, mon, season):
    m = MONTHS[mon]
    year = season - 1 if m >= 7 else season
    return dt.date(year, m, int(day)).isoformat()


# ---------------------------------------------------------------- zawodnicy

def parse_standings(h):
    out = []
    for row in re.split(r'<a class="table-row', h)[1:]:
        cid = re.search(r"competitorid=(\d+)", row)
        if not cid:
            continue
        name = re.search(r'justify-left bold align-xs-top">\s*(.*?)\s*<', row, re.S)
        nation = re.search(r'country__name-short">(\w+)<', row)
        bolds = re.findall(r'justify-right bold">([^<]*)<', row)
        if not name or len(bolds) < 2:
            continue
        out.append({
            "id": cid.group(1),
            "name": html.unescape(name.group(1)).strip(),
            "nation": nation.group(1) if nation else "",
            "rank": int(bolds[0]) if bolds[0].strip().isdigit() else None,
            "points": int(re.sub(r"\D", "", bolds[1]) or 0),
        })
    return out


def standings(season, gender, cup="WC"):
    url = (f"{BASE}/general/cup-standings.html?sectorcode=JP&seasoncode={season}"
           f"&cupcode={cup}&disciplinecode=ALL&gendercode={gender}")
    return parse_standings(fetch(url))


def build_athletes(season):
    """Zawodnicy z punktami w PŚ zeszłego sezonu lub w tegorocznym Letnim Grand Prix.

    Sortowanie: punkty PŚ zeszłego sezonu, potem punkty LGP.
    Zawodnicy, którzy pojawią się w wynikach bieżącego sezonu, są dopisywani w main().
    """
    prev = season - 1
    athletes = {}
    for gender in ("M", "W"):
        for cup, key in (("WC", "wc"), ("GP", "gp")):
            try:
                rows = standings(prev if cup != "GP" else season, gender, cup)
            except Exception as e:  # noqa: BLE001
                print(f"  brak {cup} {gender}: {e}", file=sys.stderr)
                rows = []
            print(f"  {cup} {gender}: {len(rows)} zawodników")
            for r in rows:
                a = athletes.setdefault(r["id"], {
                    "id": r["id"], "name": r["name"], "nation": r["nation"],
                    "gender": gender, "wc": 0, "wcRank": None, "gp": 0,
                })
                a[key] = r["points"]
                if cup == "WC":
                    a["wcRank"] = r["rank"]
    lst = sorted(athletes.values(), key=lambda a: (-a["wc"], -a["gp"], a["name"]))
    return lst


# ---------------------------------------------------------------- kalendarz

def parse_calendar(h, season):
    events = []
    for row in re.split(r'<div class="table-row', h)[1:]:
        eid = re.search(r'id="(\d+)"', row)
        dates = re.search(r'target="_self">(\d+)(?:-(\d+))? (\w{3})(?: - (\d+) (\w{3}))? (\d{4})</a>', row)
        if not eid or not dates:
            continue
        place = re.search(r'clip-xs">\s*(.*?)\s*<', row, re.S)
        nation = re.search(r'country__name-short">(\w+)<', row)
        d1, d2, m1, d3, m2, year = dates.groups()
        y = int(year)
        start = dt.date(y if not d3 or MONTHS[m1] <= MONTHS[m2] else y - 1, MONTHS[m1], int(d1))
        end_day = int(d3 or d2 or d1)
        end = dt.date(y, MONTHS[m2 or m1], end_day)
        events.append({
            "id": eid.group(1),
            "place": html.unescape(place.group(1)).strip() if place else "?",
            "nation": nation.group(1) if nation else "",
            "start": start.isoformat(),
            "end": end.isoformat(),
            "cancelled": 'title="Cancelled"' in row,
        })
    return events


def parse_event(h, season):
    races = []
    for row in re.split(r'<div class="table-row', h)[1:]:
        rid = re.search(r"raceid=(\d+)", row)
        if not rid:
            continue
        t = text(row)
        # przyszłe: "20 Nov 0315 ...", rozegrane: "21 Nov 2025 10:30 3061 ..."
        m = re.search(r"(\d{1,2}) (\w{3})(?: \d{4})?(?: (\d{1,2}:\d{2}))? (\d{4}) (.+?) \5 (\w+) (M|W|A) \6 \7", t)
        if not m:
            continue
        day, mon, time_, codex, disc, cat, gender = m.groups()
        races.append({
            "id": rid.group(1),
            "date": season_date(day, mon, season),
            "time": time_,
            "codex": codex,
            "discipline": disc,
            "category": cat,
            "gender": gender,
            "team": "Team" in disc or "Mixed" in disc or "Super" in disc,
            "cancelled": 'title="Cancelled"' in row,
        })
    races.sort(key=lambda r: (r["date"], r["codex"]))
    return races


def build_calendar(season):
    url = (f"{BASE}/ski-jumping/calendar-results.html?eventselection=&place=&sectorcode=JP"
           f"&seasoncode={season}&categorycode=WC&disciplinecode=&gendercode=&racedate=&racecodex="
           f"&nationcode=&seasonmonth=X-{season}&saveselection=-1&seasonselection=")
    events = parse_calendar(fetch(url), season)
    for ev in events:
        eh = fetch(f"{BASE}/general/event-details.html?sectorcode=JP&eventid={ev['id']}&seasoncode={season}")
        # punktowane: konkursy indywidualne PŚ + kwalifikacje do nich
        ev["races"] = [r for r in parse_event(eh, season)
                       if r["category"] in ("WC", "QUA") and not r["team"] and r["gender"] in ("M", "W")]
        print(f"  {ev['start']} {ev['place']}: {len(ev['races'])} konkursów")
    return events


# ---------------------------------------------------------------- wyniki

def parse_results(h):
    body = h[h.find('id="events-info-results"'):]
    out = []
    for row in re.split(r'<a class="table-row"', body)[1:]:
        cid = re.search(r"competitorid=(\d+)", row)
        name = re.search(r'g-lg g-md g-sm g-xs justify-left bold">\s*(.*?)\s*<', row, re.S)
        if not cid or not name:
            continue
        rank = re.search(r'g-xs-2 justify-right pr-1 bold">\s*(\d*)\s*<', row)
        nation = re.search(r'country__name-short">(\w+)<', row)
        jumps = []
        for item in re.findall(r'split-row__item reset-padding.*?</div>\s*</div>\s*</div>', row, re.S):
            vals = [v.strip() for v in re.findall(r'style="text-align: right">\s*([^<]*?)\s*<', item)]
            if len(vals) >= 2 and re.match(r"^\d+(\.\d)?$", vals[1]):
                jumps.append(float(vals[1]))
        total = re.findall(r'justify-right blue bold hidden-sm hidden-xs">\s*([\d.]+)', row)
        out.append({
            "id": cid.group(1),
            "name": html.unescape(name.group(1)).strip(),
            "nation": nation.group(1) if nation else "",
            "rank": int(rank.group(1)) if rank and rank.group(1) else None,
            "jumps": jumps,
            "total": float(total[0]) if total else None,
        })
        # wiersze bez miejsca (DSQ, DNS) są na końcu listy
    return out


def build_results(race, outdir):
    path = os.path.join(outdir, "results", f"{race['id']}.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
        if old.get("final"):
            return old
    h = fetch(f"{BASE}/general/results.html?sectorcode=JP&raceid={race['id']}")
    rows = parse_results(h)
    if not rows:
        return None
    days_ago = (dt.date.today() - dt.date.fromisoformat(race["date"])).days
    data = {
        "raceId": race["id"],
        "date": race["date"],
        # po 2 dniach uznajemy wyniki za ostateczne (FIS czasem poprawia DSQ)
        "final": days_ago >= 2,
        "fetched": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "results": rows,
    }
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    return data


def save(obj, path):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=current_season())
    ap.add_argument("--out", default="data")
    ap.add_argument("--skip-athletes", action="store_true", help="nie odświeżaj listy zawodników")
    args = ap.parse_args()
    out = args.out
    today = dt.date.today().isoformat()

    print(f"Sezon {args.season - 1}/{args.season % 100:02d}")
    athletes_path = os.path.join(out, "athletes.json")
    if not (args.skip_athletes and os.path.exists(athletes_path)):
        print("Zawodnicy...")
        save({"season": args.season, "generated": today, "athletes": build_athletes(args.season)}, athletes_path)

    print("Kalendarz...")
    events = build_calendar(args.season)

    print("Wyniki...")
    for ev in events:
        for race in ev["races"]:
            if race["cancelled"] or race["date"] > today:
                continue
            res = build_results(race, out)
            race["hasResults"] = bool(res)
            if res:
                print(f"  {race['date']} {ev['place']} {race['category']} {race['gender']}: {len(res['results'])} zawodników")
    save({"season": args.season, "updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
          "events": events}, os.path.join(out, "calendar.json"))

    # zawodnicy spoza listy, którzy wystartowali w tym sezonie
    with open(athletes_path, encoding="utf-8") as f:
        adata = json.load(f)
    known = {a["id"] for a in adata["athletes"]}
    added = 0
    for ev in events:
        for race in ev["races"]:
            path = os.path.join(out, "results", f"{race['id']}.json")
            if not race.get("hasResults") or not os.path.exists(path):
                continue
            with open(path, encoding="utf-8") as f:
                for r in json.load(f)["results"]:
                    if r["id"] not in known:
                        known.add(r["id"])
                        adata["athletes"].append({"id": r["id"], "name": r["name"], "nation": r["nation"],
                                                  "gender": race["gender"], "wc": 0, "wcRank": None, "gp": 0})
                        added += 1
    if added:
        print(f"  dopisano {added} nowych zawodników")
        save(adata, athletes_path)
    print("Gotowe.")


if __name__ == "__main__":
    main()
