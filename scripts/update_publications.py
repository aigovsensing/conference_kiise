#!/usr/bin/env python3
"""Fetch real yearly conference publication counts from the DBLP Search API.

The count is DBLP's number of indexed records in each conference stream/year.
The generated files intentionally retain source and retrieval metadata so the
dashboard never presents these values as hand-entered or predictive statistics.
"""
import datetime
import http.client
import json
import pathlib
import time
import urllib.parse
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA_OUT = ROOT / "data" / "publications.json"
JS_OUT = ROOT / "docs" / "assets" / "publications.js"

YEARS = list(range(2021, 2026))
CONFERENCES = [
    # KIISE 2024 목록의 16개 소분야를 빠짐없이 대표한다.
    ("ACM CCS", "Sec", "ccs"),
    ("USENIX OSDI", "OS", "osdi"),
    ("IEEE INFOCOM", "Net", "infocom"),
    ("ACM CHI", "CGI", "chi"),
    ("ICSE", "SE", "icse"),
    ("ACM POPL", "PL", "popl"),
    ("SC", "HPC", "sc"),
    ("ISCA", "Arch", "isca"),
    ("STOC", "Alg", "stoc"),
    ("KDD", "DM", "kdd"),
    ("ACL", "NLP", "acl"),
    ("ICML", "ML", "icml"),
    ("ACM SIGMOD", "DB", "sigmod"),
    ("RECOMB", "Bio", "recomb"),
    ("CVPR", "CV", "cvpr"),
    ("ICRA", "Robot", "icra"),
]
API = "https://dblp.org/search/publ/api"
SOURCE_URL = "https://dblp.org/"
USER_AGENT = "conference-kiise-dashboard/1.0 (https://github.com/leemgs/conference_kiise)"


def fetch_count(stream: str, year: int) -> int:
    query = f"stream:streams/conf/{stream}: year:{year}:"
    url = API + "?" + urllib.parse.urlencode({"q": query, "format": "json", "h": 0})
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(10):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.load(response)
            break
        except urllib.error.HTTPError as error:
            if ((error.code != 429 and error.code < 500) or attempt == 9):
                raise
            delay = int(error.headers.get("Retry-After", 10 * (attempt + 1)))
            print(f"DBLP HTTP {error.code}; retrying in {delay}s", flush=True)
            time.sleep(delay)
        except (urllib.error.URLError, ConnectionError, http.client.HTTPException) as error:
            if attempt == 9:
                raise
            delay = 10 * (attempt + 1)
            print(f"DBLP connection error ({error}); retrying in {delay}s", flush=True)
            time.sleep(delay)
    return int(payload["result"]["hits"]["@total"])


def main() -> None:
    records = []
    for abbr, field, stream in CONFERENCES:
        counts = []
        for year in YEARS:
            counts.append(fetch_count(stream, year))
            time.sleep(3)  # DBLP asks automated clients to keep request rates low
        records.append({"abbr": abbr, "field": field, "stream": stream, "counts": counts})
        print(f"{abbr}: {counts}")

    today = datetime.date.today().isoformat()
    data = {
        "sample": False,
        "source": "DBLP Computer Science Bibliography",
        "sourceUrl": SOURCE_URL,
        "method": "DBLP Search API conference-stream record count",
        "retrieved": today,
        "years": YEARS,
        "records": records,
    }
    serialized = json.dumps(data, ensure_ascii=False, indent=2)
    DATA_OUT.write_text(serialized + "\n", encoding="utf-8")
    JS_OUT.write_text(
        "// DBLP에서 자동 수집한 실제 등재 레코드 수 — 직접 수정하지 마세요.\n"
        "window.KIISE_PUBLICATIONS = " + serialized + ";\n",
        encoding="utf-8",
    )
    print(f"updated {len(records)} conferences ({YEARS[0]}–{YEARS[-1]}) on {today}")


if __name__ == "__main__":
    main()
