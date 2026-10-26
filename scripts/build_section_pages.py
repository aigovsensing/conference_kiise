#!/usr/bin/env python3
"""Generate one HTML page per dashboard section menu.

The dashboard's quick-jump menu (📊 대분야별 등급 분포, 🍩 등급 구성, …) links to
real page URLs such as ``major.html`` instead of ``#major-card`` hashes. Each of
those pages is a copy of docs/index.html that opens directly on its section, so
the menu entries can be bookmarked and shared.

The section list is read from the dashboard menu in docs/index.html: every
``<a href="xxx.html" data-target="section-id">`` becomes docs/xxx.html. Re-run
this script whenever docs/index.html changes (update_deadlines.py does so):

  python3 scripts/build_section_pages.py
"""
import html as htmllib
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
INDEX = DOCS / "index.html"
SITE = "https://leemgs.github.io/conference_kiise/"

BANNER = ("<!-- 자동 생성 파일 — 직접 수정하지 마세요. docs/index.html 을 수정한 뒤\n"
          "     python3 scripts/build_section_pages.py 를 실행하면 다시 만들어집니다. -->\n")

NAV_RE = re.compile(r'<nav class="section-nav" aria-label="대시보드 섹션 바로가기">(.*?)</nav>', re.S)
LINK_RE = re.compile(r'<a (?:class="active" )?href="([\w-]+\.html)" data-target="([\w-]+)">([^<]+)</a>')


def sections(src: str) -> list:
    nav = NAV_RE.search(src)
    if not nav:
        raise SystemExit("dashboard section menu not found in docs/index.html")
    found = LINK_RE.findall(nav.group(1))
    if not found:
        raise SystemExit("no .html links in the dashboard section menu")
    return found


def page_for(src: str, page: str, target: str, label: str) -> str:
    name = re.sub(r"^\W+", "", htmllib.unescape(label)).strip()   # drop the leading emoji
    out = src.replace("<!DOCTYPE html>\n", "<!DOCTYPE html>\n" + BANNER, 1)
    out = out.replace('<html lang="ko">', f'<html lang="ko" data-section="{target}">', 1)
    out = re.sub(r"<title>(.*?)</title>",
                 lambda m: f"<title>{name} · {m.group(1)}</title>\n"
                           f'  <link rel="canonical" href="{SITE}{page}">', out, count=1)
    # mark this page's menu entry as the active one before JS runs
    out = re.sub(r'<a class="active" (href="[\w-]+\.html" data-target=)', r"<a \1", out)
    out = out.replace(f'<a href="{page}" data-target="{target}">',
                      f'<a class="active" href="{page}" data-target="{target}">', 1)
    return out


def main() -> None:
    src = INDEX.read_text(encoding="utf-8")
    for page, target, label in sections(src):
        path = DOCS / page
        text = page_for(src, page, target, label)
        if not path.exists() or path.read_text(encoding="utf-8") != text:
            path.write_text(text, encoding="utf-8")
            print(f"wrote docs/{page}  ({target})")


if __name__ == "__main__":
    main()
