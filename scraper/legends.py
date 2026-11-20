"""Legendy i emeryci do gier: wszyscy, którzy kiedykolwiek punktowali w PŚ (mężczyźni od 1979/80, kobiety od 2011/12).

data/legends.json: {id: {n: nazwisko, c: kraj, g: płeć, y: rocznik, w/p: zwycięstwa/podia PŚ, og/ws/sf: medale (ind.) IO/MŚ/lotów,
                         gl: Kryształowe Kule, tc: wygrane TCS, fl: Kule w lotach, b: najlepsze miejsce, mx: rekord pkt w sezonie,
                         ss: sezony z punktami, f/l: pierwszy/ostatni sezon z punktami}}
Zawodników z profilem (aktywni z punktami w zeszłym sezonie) pomijamy – ich dane są w data/profiles/.
Historia się nie zmienia, więc skrypt uruchamia się ręcznie (bez bota); istniejące wpisy są pomijane.

Użycie:  python scraper/legends.py [--seasons-only]
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from fis import BASE, fetch, parse_standings, text  # noqa: E402
from profiles import bio_url, parse_career  # noqa: E402


def standings(season, gender, discipline=None):
    url = f"{BASE}/general/cup-standings.html?sectorcode=JP&seasoncode={season}&cupcode=WC&gendercode={gender}"
    if discipline:
        url += f"&disciplinecode={discipline}"
    return parse_standings(fetch(url))


def tour_winners(code, seasons, overall):
    """Zwycięzcy cyklu (wszyscy z 1. miejscem – bywa ex aequo) w kolejnych sezonach.

    FIS dla sezonu bez danych cyklu podstawia poprzedni rok albo klasyfikację generalną – takie sezony pomijamy.
    overall: {sezon: [(id, punkty) z top 3 generalnej]}
    """
    out, prev = {}, None
    for s in seasons:
        try:
            rows = standings(s, "M", code)
        except Exception:  # noqa: BLE001
            continue
        top = [(r["id"], r["points"]) for r in rows[:3]]
        if not rows or top == prev or top == overall.get(s):
            prev = top
            continue
        prev = top
        out[s] = [r["id"] for r in rows if r["rank"] == 1]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data")
    args = ap.parse_args()
    path = os.path.join(args.out, "legends.json")
    try:
        with open(path, encoding="utf-8") as f:
            legends = json.load(f)
    except (OSError, ValueError):
        legends = {}
    with open(os.path.join(args.out, "profiles", "index.json"), encoding="utf-8") as f:
        profiled = set(json.load(f))

    # 1) wszyscy punktujący – sezon po sezonie
    people = {}
    overall = {}
    for g, seasons in (("M", range(1980, 2027)), ("W", range(2012, 2027))):
        for s in seasons:
            try:
                rows = standings(s, g)
            except Exception as e:  # noqa: BLE001
                print(f"  {s} {g}: {e}", file=sys.stderr)
                continue
            if g == "M":
                overall[s] = [(r["id"], r["points"]) for r in rows[:3]]
            for r in rows:
                p = people.setdefault(r["id"], {"n": r["name"], "c": r["nation"], "g": g, "seasons": []})
                p["seasons"].append((s, r["rank"], r["points"]))
    print(f"Punktujący w PŚ: {len(people)}")

    # 2) zwycięzcy TCS i PŚ w lotach (sezony 2024 i 2026 FIS nie ma – są w data/tours-*.json)
    tcs = tour_winners("4H", range(1980, 2027), overall)
    fly = tour_winners("SF", range(1991, 2027), overall)
    for season in (2024, 2026):
        try:
            with open(os.path.join(args.out, f"tours-{season}.json"), encoding="utf-8") as f:
                t = json.load(f)
            winners = [aid for aid, v in t.items() if v.get("Four Hills", [0])[0] == 1]
            if winners:
                tcs[season] = winners
        except OSError:
            pass
    print(f"  TCS: {len(tcs)} sezonów, loty: {len(fly)} sezonów")

    # 3) kariera i rocznik z biogramu FIS (jedno zapytanie na zawodnika)
    todo = [aid for aid in people if aid not in profiled and aid not in legends]
    print(f"  do pobrania: {len(todo)} (już w pliku: {len(legends)})")
    for k, aid in enumerate(todo, 1):
        p = people[aid]
        try:
            h = fetch(bio_url(aid, type="career"))
        except Exception as e:  # noqa: BLE001
            print(f"  {p['n']}: {e}", file=sys.stderr)
            continue
        career, _ = parse_career(h)
        t = text(h)
        born = re.search(r"Birthdate\s+(?:\d{2}-\d{2}-)?(\d{4})", t)
        legends[aid] = {"n": p["n"], "c": p["c"], "g": p["g"], "y": int(born.group(1)) if born else None,
                        "w": career.get("WC", {}).get("wins", 0), "p": career.get("WC", {}).get("podiums", 0),
                        "og": career.get("OWG", {}).get("podiums", 0), "ws": career.get("WSC", {}).get("podiums", 0),
                        "sf": career.get("SFWC", {}).get("podiums", 0),
                        "ow": career.get("OWG", {}).get("wins", 0), "ww": career.get("WSC", {}).get("wins", 0)}
        if k % 50 == 0:
            print(f"  {k}/{len(todo)}")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(legends, f, ensure_ascii=False, separators=(",", ":"))

    # 4) liczby z klasyfikacji (zawsze przeliczane – tanie)
    for aid, L in legends.items():
        ss = people.get(aid, {}).get("seasons", [])
        ranks = [r for _, r, _ in ss if r]
        L.update(gl=sum(1 for r in ranks if r == 1), tc=sum(1 for v in tcs.values() if aid in v), fl=sum(1 for v in fly.values() if aid in v),
                 b=min(ranks) if ranks else None, mx=max((pt for _, _, pt in ss), default=0), ss=len(ss),
                 f=min((s for s, _, _ in ss), default=None), l=max((s for s, _, _ in ss), default=None))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(legends, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Legendy: {len(legends)}")


if __name__ == "__main__":
    main()
