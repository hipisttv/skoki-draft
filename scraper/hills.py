"""Zdjęcia skoczni z Wikimedia Commons (wolne licencje) do data/hills/ + data/hills.json z autorem i licencją.

Użycie:  python scraper/hills.py         – pobiera brakujące zdjęcia dla miejsc z data/calendar.json
         python scraper/hills.py --force – pobiera wszystkie od nowa
"""
import argparse
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

UA = "skoki-draft/1.0 (https://github.com/hipisttv/skoki-draft; prywatna liga znajomych) python-urllib"

# Miejsce z kalendarza FIS -> kandydaci na artykuł w Wikipedii (język, tytuł)
HILLS = {
    "Lillehammer": [("en", "Lysgårdsbakken")],
    "Ruka": [("en", "Rukatunturi ski jumping hill"), ("fi", "Rukatunturin hyppyrimäki")],
    "Hinzenbach": [("de", "Aigner-Schanze"), ("en", "Aigner-Schanze")],
    "Wisla": [("en", "Malinka (ski jump)"), ("pl", "Skocznia narciarska im. Adama Małysza")],
    "Titisee-Neustadt": [("en", "Hochfirstschanze"), ("de", "Hochfirstschanze")],
    "Engelberg": [("en", "Gross-Titlis-Schanze"), ("de", "Gross-Titlis-Schanze")],
    "Oberstdorf": [("en", "Schattenbergschanze"), ("de", "Schattenbergschanze")],
    "Garmisch-Partenkirchen": [("en", "Große Olympiaschanze"), ("de", "Große Olympiaschanze")],
    "Innsbruck": [("en", "Bergisel Ski Jump"), ("de", "Bergiselschanze")],
    "Bischofshofen": [("en", "Paul-Außerleitner-Schanze"), ("de", "Paul-Außerleitner-Schanze")],
    "Ljubno": [("en", "Savina Ski Jumping Center"), ("sl", "Skakalnica Savina")],
    "Zhangjiakou": [("en", "National Ski Jumping Centre"), ("commons", "Snow Ruyi ski jumping"), ("commons", "National Ski Jumping Centre Zhangjiakou")],
    "Zakopane": [("en", "Wielka Krokiew"), ("pl", "Wielka Krokiew")],
    "Zao": [("commons", "Kuraray Zao Schanze"), ("commons", "Zao ski jump Yamagata")],
    "Sapporo": [("en", "Ōkurayama Ski Jump Stadium"), ("ja", "大倉山ジャンプ競技場")],
    "Willingen": [("en", "Mühlenkopfschanze"), ("de", "Mühlenkopfschanze")],
    "Lake Placid": [("en", "Olympic Jumping Complex"), ("en", "Lake Placid Olympic Ski Jumping Complex")],
    "Lahti": [("en", "Salpausselkä"), ("fi", "Salpausselän hyppyrimäet")],
    "Vikersund": [("en", "Vikersundbakken"), ("no", "Vikersundbakken")],
    "Villach": [("de", "Villacher Alpenarena"), ("en", "Villacher Alpenarena")],
    "Falun": [("commons", "Lugnet ski jump Falun"), ("commons", "Lugnetbackarna"), ("commons", "Falun hoppbackar")],
    "Oslo": [("en", "Holmenkollbakken")],
    "Planica": [("en", "Letalnica bratov Gorišek")],
}

# Skocznie spoza tegorocznego kalendarza – do Skokdle (kraj i rozmiar do podpowiedzi).
EXTRA = {
    "Klingenthal": ("GER", "duża", [("en", "Vogtland Arena"), ("de", "Vogtland Arena")]),
    "Bad Mitterndorf": ("AUT", "mamucia", [("en", "Kulm (ski flying hill)"), ("de", "Kulm (Skiflugschanze)")]),
    "Harrachov": ("CZE", "mamucia", [("en", "Čerťák"), ("cs", "Čerťák")]),
    "Trondheim": ("NOR", "duża", [("en", "Granåsen"), ("no", "Granåsen")]),
    "Kuopio": ("FIN", "duża", [("commons", "Puijo ski jumps winter 2013")]),
    "Predazzo": ("ITA", "duża", [("en", "Trampolino dal Ben"), ("it", "Trampolino dal Ben")]),
    "Szczyrk": ("POL", "normalna", [("pl", "Skalite (skocznia narciarska)"), ("commons", "Skalite Szczyrk skocznia")]),
    "Kranj": ("SLO", "normalna", [("en", "Bauhenk"), ("sl", "Bauhenk")]),
    "Rasnov": ("ROU", "normalna", [("en", "Trambulina Valea Cărbunării"), ("ro", "Trambulina Valea Cărbunării")]),
    "Nizhny Tagil": ("RUS", "duża", [("en", "Aist (ski jumping hill)"), ("ru", "Аист (трамплин)"), ("commons", "Nizhny Tagil ski jump")]),
    "Seefeld": ("AUT", "normalna", [("de", "Toni-Seelos-Olympiaschanze"), ("en", "Toni-Seelos-Olympiaschanze")]),
    "Hinterzarten": ("GER", "normalna", [("de", "Adler-Skistadion"), ("en", "Adler Ski Stadium")]),
    "Liberec": ("CZE", "duża", [("en", "Ještěd ski jumps"), ("cs", "Skokanské můstky Ještěd")]),
    "Pyeongchang": ("KOR", "duża", [("en", "Alpensia Ski Jumping Stadium")]),
    "Whistler": ("CAN", "duża", [("en", "Whistler Olympic Park")]),
    "Courchevel": ("FRA", "duża", [("en", "Tremplin du Praz"), ("fr", "Tremplin du Praz")]),
    "Hakuba": ("JPN", "duża", [("en", "Hakuba Ski Jumping Stadium"), ("ja", "白馬ジャンプ競技場")]),
    "Almaty": ("KAZ", "duża", [("en", "Sunkar International Ski Jumping Complex")]),
    "Iron Mountain": ("USA", "duża", [("en", "Pine Mountain Ski Jump")]),
    "Oberhof": ("GER", "duża", [("de", "Kanzlersgrundschanze"), ("en", "Kanzlersgrund")]),
    "Brotterode": ("GER", "duża", [("de", "Inselbergschanze")]),
    "Krasnaya Polyana": ("RUS", "duża", [("en", "RusSki Gorki Jumping Center")]),
}


def fetch(url):
    """Wikimedia ogranicza tempo (429) – czekamy i ponawiamy."""
    for attempt in range(6):
        try:
            time.sleep(1.5)
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if attempt == 5:
                raise
            wait = 20 * (attempt + 1)
            print(f"  czekam {wait}s ({e})", file=sys.stderr)
            time.sleep(wait)


def get_json(url):
    return json.loads(fetch(url).decode("utf-8"))


def page_image(lang, title):
    """Nazwa pliku głównego zdjęcia artykułu (z Commons) albo None."""
    q = urllib.parse.urlencode({"action": "query", "prop": "pageimages", "piprop": "name", "redirects": 1,
                                "titles": title, "format": "json", "formatversion": 2})
    d = get_json(f"https://{lang}.wikipedia.org/w/api.php?{q}")
    pages = d.get("query", {}).get("pages", [])
    if not pages or pages[0].get("missing"):
        return None, None
    return pages[0].get("pageimage"), pages[0].get("title")


def commons_search(query):
    """Pierwsze zdjęcie (jpg/png) z wyszukiwarki Wikimedia Commons."""
    q = urllib.parse.urlencode({"action": "query", "list": "search", "srsearch": query, "srnamespace": 6,
                                "srlimit": 10, "format": "json", "formatversion": 2})
    for hit in get_json(f"https://commons.wikimedia.org/w/api.php?{q}").get("query", {}).get("search", []):
        name = hit["title"].split(":", 1)[1]
        if re.search(r"\.(jpe?g|png)$", name, re.I) and not re.search(r"(?i)logo|map|plan|diagram", name):
            return name
    return None


def commons_info(filename):
    q = urllib.parse.urlencode({"action": "query", "titles": f"File:{filename}", "prop": "imageinfo",
                                "iiprop": "url|extmetadata", "iiurlwidth": 900, "format": "json", "formatversion": 2})
    d = get_json(f"https://commons.wikimedia.org/w/api.php?{q}")
    pages = d.get("query", {}).get("pages", [])
    if not pages or "imageinfo" not in pages[0]:
        return None
    ii = pages[0]["imageinfo"][0]
    meta = ii.get("extmetadata", {})
    clean = lambda k: html.unescape(re.sub(r"<[^>]+>", "", meta.get(k, {}).get("value", ""))).strip()
    return {
        "url": ii.get("thumburl") or ii["url"],
        "page": ii.get("descriptionurl"),
        "author": clean("Artist") or "nieznany autor",
        "license": clean("LicenseShortName") or "wolna licencja",
    }


def slug(place):
    return re.sub(r"[^a-z0-9]+", "-", place.lower()).strip("-")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    with open(os.path.join(args.out, "calendar.json"), encoding="utf-8") as f:
        places = sorted({e["place"] for e in json.load(f)["events"]} | set(EXTRA))
    index_path = os.path.join(args.out, "hills.json")
    index = {}
    if os.path.exists(index_path) and not args.force:
        with open(index_path, encoding="utf-8") as f:
            index = json.load(f)
    os.makedirs(os.path.join(args.out, "hills"), exist_ok=True)
    for place in places:
        if place in index and os.path.exists(os.path.join(args.out, index[place]["file"])):
            continue
        found = None
        for lang, title in HILLS.get(place, []) + (EXTRA[place][2] if place in EXTRA else []) + [("en", f"{place} ski jump")]:
            try:
                fname, real_title = (commons_search(title), title) if lang == "commons" else page_image(lang, title)
            except Exception as e:  # noqa: BLE001
                print(f"  {place}: błąd {lang}:{title}: {e}", file=sys.stderr)
                continue
            if fname and re.search(r"\.(jpe?g|png|webp)$", fname, re.I) and not re.search(r"(?i)logo|map|locator|flag", fname):
                found = (lang, real_title, fname)
                break
        if not found:
            print(f"  {place}: brak zdjęcia")
            continue
        info = commons_info(found[2])
        if not info:
            print(f"  {place}: brak danych pliku {found[2]}")
            continue
        try:
            data = fetch(info["url"])
        except Exception as e:  # noqa: BLE001
            print(f"  {place}: nie udało się pobrać zdjęcia ({e}) – spróbuję przy następnym uruchomieniu")
            continue
        ext = os.path.splitext(urllib.parse.urlparse(info["url"]).path)[1].lower() or ".jpg"
        rel = f"hills/{slug(place)}{ext}"
        with open(os.path.join(args.out, rel), "wb") as f:
            f.write(data)
        index[place] = {"file": rel, "hill": found[1], "author": info["author"][:120],
                        "license": info["license"], "source": info["page"]}
        if place in EXTRA:
            index[place].update(nation=EXTRA[place][0], type=EXTRA[place][1], extra=True)
        print(f"  {place}: {found[1]} ({found[0]}) – {info['author'][:40]}, {info['license']}")
        with open(index_path, "w", encoding="utf-8") as f:
            json.dump(index, f, ensure_ascii=False, indent=1)
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    print(f"Zdjęcia: {len(index)} z {len(places)} miejsc")


if __name__ == "__main__":
    main()
