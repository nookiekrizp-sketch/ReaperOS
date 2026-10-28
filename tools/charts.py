#!/usr/bin/env python3
"""Builds charts.json for ReaperOS: IMDb's most popular movies, the Billboard Hot 100,
and the newest videos from game-modding YouTube channels.

Runs in GitHub Actions (see .github/workflows/web.yml) every few hours. Any section that
fails keeps the previously published data, so a site change never empties a row.

usage: charts.py OUT.json [PREVIOUS.json]
"""
import json, re, sys, time, datetime, urllib.request, urllib.error
import xml.etree.ElementTree as ET

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
HEADERS = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9",
           "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}

# Game modders: console and handheld modding, emulation setups, and PC game mods.
MODDERS = [
    ("ModernVintageGamer", "Modern Vintage Gamer", "Console hacking, homebrew and how old games were made"),
    ("ETAPRIME", "ETA Prime", "Emulation and PC gaming on handhelds and mini PCs, with setup guides"),
    ("RetroGameCorps", "Retro Game Corps", "Retro handhelds, emulation setups and guides"),
    ("TakiUdon", "Taki Udon", "Console mods, custom builds and retro hardware"),
    ("Voultar", "Voultar", "Console modding and repair"),
    ("WulffDen", "Wulff Den", "Handhelds, emulation and console hacks"),
    ("ThePhawx", "The Phawx", "Handheld PC tuning and performance"),
    ("MrBossFTW", "MrBossFTW", "GTA V and FiveM mods"),
    ("GamerPoets", "GamerPoets", "Skyrim, Fallout and Starfield modding guides"),
    ("Brodual", "Brodual", "Skyrim and Bethesda mod showcases"),
]


def get(url, timeout=30, headers=None):
    req = urllib.request.Request(url, headers=headers or HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def log(*a):
    print(*a, file=sys.stderr, flush=True)


_browser = None
def page_html(url, wait_for=None):
    """Loads a page in headless Chromium (handles sites that block plain requests)."""
    global _browser
    from playwright.sync_api import sync_playwright
    if _browser is None:
        _browser = sync_playwright().start().chromium.launch()
    ctx = _browser.new_context(user_agent=UA, locale="en-US", viewport={"width": 1366, "height": 900})
    pg = ctx.new_page()
    try:
        pg.goto(url, wait_until="domcontentloaded", timeout=60000)
        if wait_for:
            try:
                pg.wait_for_selector(wait_for, state="attached", timeout=30000)
            except Exception:
                pass
        html = pg.content()
    finally:
        ctx.close()
    return html


def snippet(html):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", html, flags=re.S)
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", t)[:200]


# ------------------------------------------------------------------ IMDb
def imdb_size(url, w=300):
    # IMDb image URLs end in ._V1_<ops>.jpg; ask for a poster-sized copy.
    if not url:
        return ""
    return re.sub(r"\._V1_.*?\.(jpg|png|webp)$", r"._V1_UX%d_.\1" % w, url) if "._V1_" in url else url


def imdb_popular():
    html = page_html("https://www.imdb.com/chart/moviemeter/", "script#__NEXT_DATA__")
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    out, seen = [], set()
    if m:
        data = json.loads(m.group(1))

        def walk(o):
            if isinstance(o, dict):
                tid = o.get("id")
                if isinstance(tid, str) and re.fullmatch(r"tt\d+", tid) and isinstance(o.get("titleText"), dict) and tid not in seen:
                    seen.add(tid)
                    rating = (o.get("ratingsSummary") or {}).get("aggregateRating")
                    year = (o.get("releaseYear") or {}).get("year")
                    img = (o.get("primaryImage") or {}).get("url")
                    plot = (((o.get("plot") or {}).get("plotText") or {}).get("plainText")) or ""
                    genres = [g.get("genre", {}).get("text") for g in ((o.get("titleGenres") or {}).get("genres") or []) if isinstance(g, dict)]
                    runtime = (o.get("runtime") or {}).get("seconds")
                    out.append({"id": tid, "title": o["titleText"].get("text", ""), "year": year, "rating": rating,
                                "poster": imdb_size(img), "plot": plot, "genres": [g for g in genres if g][:3],
                                "runtime": runtime})
                for v in o.values():
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)
        walk(data)
    if not out:
        # Older page layout: JSON-LD item list.
        for blk in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
            try:
                ld = json.loads(blk)
            except ValueError:
                continue
            for el in ld.get("itemListElement", []):
                it = el.get("item", {})
                mm = re.search(r"(tt\d+)", it.get("url", ""))
                if not mm or mm.group(1) in seen:
                    continue
                seen.add(mm.group(1))
                out.append({"id": mm.group(1), "title": it.get("name", ""), "year": None,
                            "rating": (it.get("aggregateRating") or {}).get("ratingValue"),
                            "poster": imdb_size(it.get("image")), "plot": it.get("description", ""),
                            "genres": [g for g in (it.get("genre") or "").split(", ") if g][:3], "runtime": None})
    if not out:
        log("imdb page:", len(html), snippet(html))
    return out[:50]


# ------------------------------------------------------------------ Billboard
def hot100():
    from bs4 import BeautifulSoup
    html = page_html("https://www.billboard.com/charts/hot-100/", "h3#title-of-a-story")
    soup = BeautifulSoup(html, "html.parser")
    m = re.search(r"Week of ([A-Z][a-z]+ \d{1,2}, \d{4})", soup.get_text(" "))
    date = parse_date(m.group(1)) if m else None
    out = []
    for row in soup.select("div.o-chart-results-list-row-container"):
        h = row.select_one("h3#title-of-a-story")
        if not h:
            continue
        title = h.get_text(" ", strip=True)
        labels = [x.get_text(" ", strip=True) for x in row.select("span.c-label")]
        # first label is the rank, then the artist, then last week / peak / weeks (also repeated for mobile)
        artist = next((x for x in labels if x and not re.fullmatch(r"[\d\-]+|NEW|RE-\s*ENTRY", x, re.I)), "")
        nums = [x for x in labels[labels.index(artist) + 1:] if re.fullmatch(r"\d+|-", x)] if artist in labels else []
        img = row.select_one("img")
        src = ""
        if img:
            src = img.get("data-lazy-src") or img.get("src") or ""
            if "lazyload-fallback" in src or src.startswith("data:"):
                src = ""
        def n(i):
            return int(nums[i]) if len(nums) > i and nums[i].isdigit() else None
        out.append({"rank": len(out) + 1, "title": title, "artist": artist, "image": src,
                    "last": n(0), "peak": n(1) or len(out) + 1, "weeks": n(2) or 1, "isNew": bool(re.search(r"\bNEW\b", " ".join(labels[:3])))})
    if not out:
        log("billboard page:", len(html), snippet(html))
    return {"date": date, "entries": out[:100]}


# ------------------------------------------------------------------ YouTube
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def is_short(vid):
    opener = urllib.request.build_opener(NoRedirect)
    try:
        r = opener.open(urllib.request.Request("https://www.youtube.com/shorts/" + vid, headers=HEADERS), timeout=15)
        return r.status == 200
    except urllib.error.HTTPError:
        return False      # 3xx (normal video) shows up here because redirects are refused
    except Exception:
        return False


def channel(handle, want=3, keep=None):
    html = get("https://www.youtube.com/@" + handle)
    m = (re.search(r'"externalId":"(UC[\w-]{22})"', html)
         or re.search(r'<link rel="canonical" href="https://www\.youtube\.com/channel/(UC[\w-]{22})"', html)
         or re.search(r'"channelId":"(UC[\w-]{22})"', html))
    if not m:
        raise ValueError("no channel id")
    cid = m.group(1)
    feed = get("https://www.youtube.com/feeds/videos.xml?channel_id=" + cid)
    ns = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015",
          "media": "http://search.yahoo.com/mrss/"}
    root = ET.fromstring(feed)
    vids = []
    for en in root.findall("a:entry", ns):
        vid = en.findtext("yt:videoId", "", ns)
        title = en.findtext("a:title", "", ns)
        if not vid or "#shorts" in title.lower():
            continue
        if keep and not keep(title):
            continue
        if is_short(vid):
            continue
        vids.append({"id": vid, "title": title, "published": en.findtext("a:published", "", ns)})
        if len(vids) >= want:
            break
    return cid, vids


def modders():
    out = []
    for handle, name, about in MODDERS:
        try:
            cid, vids = channel(handle)
            out.append({"handle": handle, "name": name, "about": about, "channelId": cid, "videos": vids})
            log("youtube ok", handle, len(vids))
        except Exception as e:
            log("youtube skip", handle, e)
        time.sleep(0.5)
    return out


# Official studio and trailer channels: only videos with "trailer" or "teaser" in the title.
TRAILER_CHANNELS = [
    ("RottenTomatoesTRAILERS", "Rotten Tomatoes Trailers"),
    ("warnerbrospictures", "Warner Bros. Pictures"),
    ("UniversalPictures", "Universal Pictures"),
    ("SonyPictures", "Sony Pictures"),
    ("ParamountPictures", "Paramount Pictures"),
    ("WaltDisneyStudios", "Walt Disney Studios"),
    ("marvel", "Marvel Entertainment"),
    ("20thCenturyStudios", "20th Century Studios"),
    ("LionsgateMovies", "Lionsgate Movies"),
    ("A24", "A24"),
    ("FocusFeatures", "Focus Features"),
    ("neonrated", "NEON"),
    ("Netflix", "Netflix"),
    ("PrimeVideo", "Prime Video"),
]


def trailers():
    is_trailer = lambda t: re.search(r"\b(trailer|teaser)\b", t, re.I) and not re.search(r"\breaction\b", t, re.I)
    out, seen = [], set()
    for handle, name in TRAILER_CHANNELS:
        try:
            cid, vids = channel(handle, want=4, keep=is_trailer)
            for v in vids:
                key = re.sub(r"[^a-z0-9]", "", v["title"].lower())[:40]
                if key in seen:
                    continue
                seen.add(key)
                v["channel"] = name
                out.append(v)
            log("trailers ok", handle, len(vids))
        except Exception as e:
            log("trailers skip", handle, e)
        time.sleep(0.5)
    out.sort(key=lambda v: v["published"], reverse=True)
    return out[:50]


# ------------------------------------------------------------------ release timers
def post_json(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={
        "User-Agent": UA, "Content-Type": "application/json", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def anime_timers():
    """Next episodes of popular airing anime (exact air times) and upcoming premieres, from AniList."""
    now = int(time.time())
    q = """query($from:Int,$to:Int,$page:Int){Page(page:$page,perPage:50){pageInfo{hasNextPage}
      airingSchedules(airingAt_greater:$from,airingAt_lesser:$to,sort:TIME){airingAt episode
      media{id isAdult format popularity siteUrl title{romaji english} coverImage{large} episodes}}}}"""
    eps, page = [], 1
    while page <= 6:
        d = post_json("https://graphql.anilist.co", {"query": q, "variables": {"from": now, "to": now + 8 * 86400, "page": page}})["data"]["Page"]
        eps += d["airingSchedules"]
        if not d["pageInfo"]["hasNextPage"]:
            break
        page += 1
        time.sleep(1)
    out, seen = [], set()
    eps = [e for e in eps if e["media"] and not e["media"]["isAdult"] and e["media"]["format"] in ("TV", "ONA", "TV_SHORT")]
    eps.sort(key=lambda e: -(e["media"]["popularity"] or 0))
    for e in eps:
        m = e["media"]
        if m["id"] in seen:
            continue
        seen.add(m["id"])
        out.append({"title": m["title"]["english"] or m["title"]["romaji"], "at": e["airingAt"], "episode": e["episode"],
                    "episodes": m["episodes"], "image": (m["coverImage"] or {}).get("large", ""), "url": m["siteUrl"],
                    "kind": "episode"})
        if len(out) >= 40:
            break
    q2 = """query{Page(perPage:30){media(type:ANIME,status:NOT_YET_RELEASED,sort:POPULARITY_DESC,isAdult:false){
      id siteUrl title{romaji english} coverImage{large} format startDate{year month day} nextAiringEpisode{airingAt}}}}"""
    for m in post_json("https://graphql.anilist.co", {"query": q2})["data"]["Page"]["media"]:
        at = (m.get("nextAiringEpisode") or {}).get("airingAt")
        sd = m.get("startDate") or {}
        if not at and not sd.get("year"):
            continue
        out.append({"title": m["title"]["english"] or m["title"]["romaji"], "at": at,
                    "date": None if at else "%04d-%02d-%02d" % (sd["year"], sd.get("month") or 0, sd.get("day") or 0) if sd.get("day") else None,
                    "when": None if (at or sd.get("day")) else ("%s %d" % (datetime.date(2000, sd["month"], 1).strftime("%B"), sd["year"]) if sd.get("month") else str(sd["year"])),
                    "image": (m["coverImage"] or {}).get("large", ""), "url": m["siteUrl"], "kind": "premiere", "format": m["format"]})
    return out


DATE_FORMATS = ("%b %d, %Y", "%d %b, %Y", "%B %d, %Y", "%d %B, %Y", "%b %d %Y", "%Y-%m-%d")


def parse_date(txt):
    txt = (txt or "").strip().replace("Sept", "Sep")
    for f in DATE_FORMATS:
        try:
            return datetime.datetime.strptime(txt, f).date().isoformat()
        except ValueError:
            pass
    return None


def game_timers():
    """Most-wanted upcoming games on Steam with their release dates."""
    data = json.loads(get("https://store.steampowered.com/search/results/?filter=popularcomingsoon&count=50&json=1&cc=us&l=english",
                          headers=dict(HEADERS, Accept="application/json")))
    ids = []
    for it in data.get("items", []):
        m = re.search(r"/apps/(\d+)/", it.get("logo", ""))
        if m and m.group(1) not in ids:
            ids.append(m.group(1))
    out = []
    for appid in ids[:45]:
        try:
            d = json.loads(get("https://store.steampowered.com/api/appdetails?appids=%s&cc=us&l=english" % appid,
                               headers=dict(HEADERS, Accept="application/json")))[appid]
            if not d.get("success"):
                continue
            g = d["data"]
            rd = g.get("release_date") or {}
            if not rd.get("coming_soon", True):
                continue
            iso = parse_date(rd.get("date"))
            out.append({"id": appid, "title": g.get("name", ""), "date": iso, "when": None if iso else (rd.get("date") or "Coming soon"),
                        "image": g.get("header_image", ""), "desc": g.get("short_description", ""),
                        "genres": [x.get("description") for x in (g.get("genres") or [])][:3],
                        "url": "https://store.steampowered.com/app/%s/" % appid})
        except Exception as e:
            log("steam skip", appid, e)
        time.sleep(1.2)
    return out


def movie_timers():
    """Upcoming US movie releases from IMDb's release calendar."""
    html = page_html("https://www.imdb.com/calendar/?region=US&type=MOVIE", "script#__NEXT_DATA__")
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    if not m:
        log("calendar page:", len(html), snippet(html))
        raise ValueError("no page data")
    data = json.loads(m.group(1))
    out, seen = [], set()

    def date_of(o):
        for k in ("releaseDate", "group", "date"):
            v = o.get(k)
            if isinstance(v, str) and parse_date(v):
                return parse_date(v)
            if isinstance(v, dict) and v.get("year") and v.get("month") and v.get("day"):
                return "%04d-%02d-%02d" % (v["year"], v["month"], v["day"])
        return None

    def walk(o, ctx_date):
        if isinstance(o, dict):
            ctx_date = date_of(o) or ctx_date
            tid = o.get("id")
            tt = o.get("titleText")
            if isinstance(tid, str) and re.fullmatch(r"tt\d+", tid) and tid not in seen and (isinstance(tt, (dict, str))):
                seen.add(tid)
                img = (o.get("imageModel") or o.get("primaryImage") or {}).get("url")
                genres = o.get("titleGenres") or o.get("genres") or []
                if isinstance(genres, dict):
                    genres = genres.get("genres") or []
                gl = [g if isinstance(g, str) else (g.get("genre") or {}).get("text") or g.get("text") for g in genres]
                out.append({"id": tid, "title": tt.get("text", "") if isinstance(tt, dict) else tt, "date": ctx_date,
                            "poster": imdb_size(img), "genres": [g for g in gl if g][:3],
                            "url": "https://www.imdb.com/title/%s/" % tid})
            for v in o.values():
                walk(v, ctx_date)
        elif isinstance(o, list):
            for v in o:
                walk(v, ctx_date)
    walk(data, None)
    today = datetime.date.today().isoformat()
    out = [x for x in out if x["date"] and x["date"] >= today]
    if not out:
        log("calendar keys:", list((data.get("props", {}).get("pageProps") or {}).keys()))
    return out[:60]


def main():
    dest = sys.argv[1]
    prev = {}
    if len(sys.argv) > 2:
        try:
            prev = json.load(open(sys.argv[2]))
        except Exception:
            prev = {}
    out = {"updated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")}
    for key, fn in (("imdb", imdb_popular), ("hot100", hot100), ("modders", modders), ("trailers", trailers),
                     ("anime_timers", anime_timers), ("game_timers", game_timers), ("movie_timers", movie_timers)):
        try:
            val = fn()
            n = len(val["entries"]) if isinstance(val, dict) else len(val)
            if not n:
                raise ValueError("empty")
            out[key] = val
            log(key, "ok", n)
        except Exception as e:
            log(key, "FAILED:", repr(e), "(keeping previous data)" if key in prev else "")
            if key in prev:
                out[key] = prev[key]
    json.dump(out, open(dest, "w"), ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
