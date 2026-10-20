#!/usr/bin/env python3
"""Roll the paper-deadline calendar window forward.

Reads data/deadlines.json (canonical deadline seed), projects every entry
forward year by year (same month/day, edition +1) so the calendar always
covers roughly [today - 60 days, today + 400 days], then rewrites:

  - data/deadlines.json        (rolled canonical data)
  - docs/assets/deadlines.js   (asset consumed by the dashboard)
  - docs/index.html            (cache-busting ?v= stamp for deadlines.js)

Deadlines of the 기타(misc) conferences live in the 초록마감/논문마감 columns
of data/misc_sw_conferences_*.csv. They are projected the same way and
merged into deadlines.js only (tagged "cat": "misc"); data/deadlines.json
stays KIISE-only.

All projected dates are estimates based on the previous cycle; the
dashboard already labels them as such. An entry verified against the
official CFP may carry "status": "confirmed" (shown as 확정); the flag is
dropped when the entry is projected to later years. Run weekly via GitHub Actions
(.github/workflows/update-deadlines.yml) or manually:

  python3 scripts/update_deadlines.py
"""
import csv
import datetime
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "deadlines.json"
MISC_GLOB = "misc_sw_conferences_*.csv"
OUT = ROOT / "docs" / "assets" / "deadlines.js"
INDEX = ROOT / "docs" / "index.html"

PAST_DAYS = 60     # keep this much recent history visible
FUTURE_DAYS = 400  # keep at least ~13 months of upcoming deadlines

JS_HEADER = """\
// 자동 생성 파일 — 직접 수정하지 마세요.
// 원본은 data/deadlines.json 이며 scripts/update_deadlines.py 가 이 파일을 생성합니다.
// (GitHub Actions 가 매주 실행하여 달력 범위를 오늘 기준으로 연장합니다.)
//
// 날짜는 직전 개최 연도 일정을 기반으로 한 "예상치"이므로,
// 실제 마감일은 반드시 각 학회 공식 홈페이지에서 확인해야 합니다.
// abbr 은 docs/assets/data.js 의 약칭과 일치해야 캘린더 칩이 학회 정보와 연결됩니다.
"""


def shift_years(item: dict, years: int) -> dict:
    """Return a copy of item moved forward by N years (edition bumped too)."""
    d = datetime.date.fromisoformat(item["date"])
    try:
        nd = d.replace(year=d.year + years)
    except ValueError:  # Feb 29 on a non-leap target year
        nd = d.replace(year=d.year + years, day=28)
    out = dict(item)
    out["date"] = nd.isoformat()
    out.pop("status", None)  # a projected date is always an estimate
    edition = str(item.get("edition", ""))
    if edition.isdigit():
        out["edition"] = str(int(edition) + years)
    return out


def roll(seed: list, lo: datetime.date, hi: datetime.date) -> list:
    """Project every seed item forward (every N years, default 1) into [lo, hi]."""
    seen = set()
    items = []
    for item in seed:
        every = int(item.pop("every", 1) or 1)
        n = 0
        while True:
            it = shift_years(item, n) if n else dict(item)
            d = datetime.date.fromisoformat(it["date"])
            if d > hi:
                break
            if d >= lo:
                key = (it["abbr"], it["kind"], it["date"])
                if key not in seen:
                    seen.add(key)
                    items.append(it)
            n += every
    items.sort(key=lambda i: (i["date"], i["abbr"], i["kind"]))
    return items


def misc_seed() -> list:
    """Deadline seeds of the 기타 conferences (초록마감/논문마감 columns)."""
    seed = []
    for path in sorted((ROOT / "data").glob(MISC_GLOB)):
        with path.open(encoding="utf-8-sig", newline="") as fh:
            for row in csv.DictReader(fh):
                row = {k: (v or "").strip() for k, v in row.items()}
                for kind, col in (("초록", "초록마감"), ("논문", "논문마감")):
                    if row.get("약칭") and row.get(col):
                        seed.append({"abbr": row["약칭"], "edition": row["회차"],
                                     "kind": kind, "date": row[col],
                                     "cat": "misc", "every": row.get("주기") or 1})
    return seed


def main() -> None:
    today = datetime.date.today()
    lo = today - datetime.timedelta(days=PAST_DAYS)
    hi = today + datetime.timedelta(days=FUTURE_DAYS)

    data = json.loads(SRC.read_text(encoding="utf-8"))
    data["items"] = roll(data["items"], lo, hi)
    data["updated"] = today.isoformat()
    items = data["items"]
    misc = roll(misc_seed(), lo, hi)

    SRC.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                   encoding="utf-8")
    out = dict(data, items=sorted(items + misc,
                                  key=lambda i: (i["date"], i["abbr"], i["kind"])))
    OUT.write_text(JS_HEADER + "window.KIISE_DEADLINES = "
                   + json.dumps(out, ensure_ascii=False, indent=2) + ";\n",
                   encoding="utf-8")

    html = INDEX.read_text(encoding="utf-8")
    stamp = today.strftime("%Y%m%d")
    html2 = re.sub(r"deadlines\.js\?v=[0-9A-Za-z]+",
                   f"deadlines.js?v={stamp}", html)
    if html2 != html:
        INDEX.write_text(html2, encoding="utf-8")

    print(f"deadline window: {lo} .. {hi} — {len(items)} items "
          f"({len({i['abbr'] for i in items})} conferences) + 기타 {len(misc)} items "
          f"({len({i['abbr'] for i in misc})} conferences)")


if __name__ == "__main__":
    main()
