#!/usr/bin/env python3
"""Build the dashboard dataset from the KIISE source CSV(s).

Merges every ``data/excellent_sw_conferences_<year>.csv`` file and writes a
browser-ready ``docs/assets/data.js`` that assigns ``window.KIISE_DATA``.
To add another year, drop a new ``excellent_sw_conferences_2025.csv`` (same
columns) into ``data/`` and re-run — it is picked up automatically.
``data/misc_sw_conferences_<year>.csv`` (기타 — KIISE 비지정 일반 해외 학회,
참고용) is merged too, with grade code ``"M"``. Emitting a
``.js`` file (rather than JSON fetched at runtime) lets the dashboard open
directly from the filesystem as well as from GitHub Pages, with no fetch/CORS
caveats.

Usage:
    python scripts/build_data.py
"""
from __future__ import annotations

import csv
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "data"
SRC_GLOB = "excellent_sw_conferences_*.csv"
# 기타(참고용) 학회 — KIISE 지정 목록에는 없는 일반 해외 학회. 등급 코드 "M".
MISC_GLOB = "misc_sw_conferences_*.csv"
OUT = ROOT / "docs" / "assets" / "data.js"
DOCS_DATA = ROOT / "docs" / "data"

# Full names for the KIISE sub-field abbreviations (소분야).
SUBFIELD_NAMES = {
    "ML": "Machine Learning",
    "NLP": "Natural Language Processing",
    "CV": "Computer Vision",
    "Bio": "Bioinformatics",
    "Robot": "Robotics",
    "SE": "Software Engineering",
    "OS": "Operating Systems",
    "PL": "Programming Languages",
    "Sec": "Security",
    "CGI": "Computer Graphics / HCI",
    "DM": "Data Mining",
    "Net": "Networks",
    "Arch": "Computer Architecture",
    "Alg": "Algorithms / Theory",
    "DB": "Database",
    "HPC": "High Performance Computing",
}

MAJOR_NAMES = {
    "AI": "Artificial Intelligence",
    "CS": "Computer Science",
}


def year_of(no: str, filename: str) -> str:
    """Derive the calendar year from the 번호 (e.g. 2024-S-001), or the filename."""
    m = re.match(r"\s*(\d{4})", no or "")
    if m:
        return m.group(1)
    m = re.search(r"(\d{4})", filename)
    return m.group(1) if m else ""


def parse_file(path: pathlib.Path, records: list, deleted: list) -> None:
    with path.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.reader(fh)
        next(reader, None)  # header: 번호,대분야,소분야,약칭,학회명,등급,비고
        for row in reader:
            if len(row) < 6:
                continue
            no, major, sub, abbr, name, grade = (c.strip() for c in row[:6])
            note = row[6].strip() if len(row) > 6 else ""

            # Rows without an abbreviation are continuation/blank lines.
            if not abbr:
                continue

            rec = {
                "no": no,
                "year": year_of(no, path.name),
                "major": major,
                "sub": sub,
                "subName": SUBFIELD_NAMES.get(sub, sub),
                "abbr": abbr,
                "name": name,
                "grade": grade,
                "note": note,
            }

            # Deleted entries (삭제) have no 번호 — keep them separately.
            if not no or "삭제" in note:
                deleted.append(rec)
            else:
                records.append(rec)


def parse_misc(path: pathlib.Path, records: list) -> None:
    """기타 학회 CSV: 번호,대분야,소분야,약칭,학회명,등급,공식사이트,회차,초록마감,논문마감,주기,비고"""
    with path.open(encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            row = {k: (v or "").strip() for k, v in row.items()}
            if not row.get("약칭"):
                continue
            sub = row["소분야"]
            records.append({
                "no": row["번호"],
                "year": year_of(row["번호"], path.name),
                "major": row["대분야"],
                "sub": sub,
                "subName": SUBFIELD_NAMES.get(sub, sub),
                "abbr": row["약칭"],
                "name": row["학회명"],
                "grade": "M",
                "note": row.get("비고", ""),
                "url": row.get("공식사이트", ""),
            })


def build() -> dict:
    records: list[dict] = []
    deleted: list[dict] = []

    sources = sorted(SRC_DIR.glob(SRC_GLOB))
    if not sources:
        raise SystemExit(f"No source CSV found in {SRC_DIR}/{SRC_GLOB}")
    for path in sources:
        parse_file(path, records, deleted)
    misc_sources = sorted(SRC_DIR.glob(MISC_GLOB))
    for path in misc_sources:
        parse_misc(path, records)
    sources += misc_sources

    years = sorted({r["year"] for r in records if r["year"]})
    grade_rank = {"S": 0, "A": 1, "M": 2}
    records.sort(key=lambda r: (r["year"], grade_rank.get(r["grade"], 3), r["no"]))

    return {
        "records": records,
        "deleted": deleted,
        "majorNames": MAJOR_NAMES,
        "subfieldNames": SUBFIELD_NAMES,
        "years": years,
        "sources": [p.name for p in sources],
    }


def main() -> None:
    data = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, indent=2)
    OUT.write_text(
        "// Auto-generated by scripts/build_data.py — do not edit by hand.\n"
        f"window.KIISE_DATA = {payload};\n",
        encoding="utf-8",
    )
    n = len(data["records"])
    s = sum(1 for r in data["records"] if r["grade"] == "S")
    a = sum(1 for r in data["records"] if r["grade"] == "A")
    m = sum(1 for r in data["records"] if r["grade"] == "M")
    print(f"Wrote {OUT.relative_to(ROOT)}: {n} conferences (S={s}, A={a}, 기타={m}), "
          f"{len(data['deleted'])} deleted. "
          f"years={','.join(data['years'])} sources={len(data['sources'])}")


if __name__ == "__main__":
    main()
