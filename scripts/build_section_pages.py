#!/usr/bin/env python3
"""Generate one HTML page per main menu tab and per sub-menu entry.

The main menu (📊 대시보드, 🌏 개최지별, 📅 달력, 📋 목록) and each view's quick-jump
sub-menu (📊 대분야별 등급 분포, ⏳ 다가오는 마감, …) link to real page URLs such
as ``korea.html`` or ``major.html`` instead of ``#hash`` anchors. Each of those
pages is a copy of docs/index.html that opens directly on its view/section, so
every menu entry can be bookmarked and shared.

The page list is read from docs/index.html itself: every
``<a href="xxx.html" data-view="...">`` tab and every
``<a href="xxx.html" data-target="...">`` sub-menu link becomes docs/xxx.html.
Re-run this script whenever docs/index.html changes (update_deadlines.py does so):

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

TAB_RE = re.compile(r'<a href="([\w-]+\.html)" data-view="([\w-]+)"(?: class="active")?>([^<]+)</a>')
VIEW_RE = re.compile(r'<div id="view-([\w-]+)"( hidden)?>')
LINK_RE = re.compile(r'<a (?:class="active" )?href="([\w-]+\.html)" data-target="([\w-]+)">([^<]+)</a>')


def pages(src: str) -> list:
    """[(page, view, section-or-None, label)] in menu order."""
    out = [(page, view, None, label) for page, view, label in TAB_RE.findall(src)]
    starts = [(m.start(), m.group(1)) for m in VIEW_RE.finditer(src)]
    for m in LINK_RE.finditer(src):
        owner = [v for pos, v in starts if pos < m.start()]
        if owner:
            out.append((m.group(1), owner[-1], m.group(2), m.group(3)))
    if not out:
        raise SystemExit("no .html menu links found in docs/index.html")
    return out


def page_for(src: str, page: str, view: str, section, label: str) -> str:
    name = re.sub(r"^\W+", "", htmllib.unescape(label)).strip()   # drop the leading emoji
    attr = f'data-section="{section}"' if section else f'data-view="{view}"'
    out = src.replace("<!DOCTYPE html>\n", "<!DOCTYPE html>\n" + BANNER, 1)
    out = out.replace('<html lang="ko">', f'<html lang="ko" {attr}>', 1)
    out = re.sub(r"<title>(.*?)</title>",
                 lambda m: f"<title>{name} · {m.group(1)}</title>\n"
                           f'  <link rel="canonical" href="{SITE}{page}">', out, count=1)
    # render the right tab/view/sub-menu entry before JS runs (no flash of the dashboard)
    out = re.sub(r'(href="[\w-]+\.html" data-view="[\w-]+") class="active">', r"\1>", out)
    out = re.sub(rf'(href="[\w-]+\.html" data-view="{view}")>', r'\1 class="active">', out, count=1)
    out = VIEW_RE.sub(lambda m: f'<div id="view-{m.group(1)}"'
                                + ("" if m.group(1) == view else " hidden") + ">", out)
    if section:
        nav_start = out.index(f'<div id="view-{view}"')
        nav_end = out.index("</nav>", nav_start)
        nav = out[nav_start:nav_end]
        nav = re.sub(r'<a class="active" (href="[\w-]+\.html" data-target=)', r"<a \1", nav)
        nav = nav.replace(f'<a href="{page}" data-target="{section}">',
                          f'<a class="active" href="{page}" data-target="{section}">', 1)
        out = out[:nav_start] + nav + out[nav_end:]
    return out


def main() -> None:
    src = INDEX.read_text(encoding="utf-8")
    for page, view, section, label in pages(src):
        path = DOCS / page
        text = page_for(src, page, view, section, label)
        if not path.exists() or path.read_text(encoding="utf-8") != text:
            path.write_text(text, encoding="utf-8")
            print(f"wrote docs/{page}  ({section or 'view ' + view})")


if __name__ == "__main__":
    main()
