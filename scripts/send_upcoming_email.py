#!/usr/bin/env python3
"""Email the "⏳ 다가오는 마감" (upcoming deadlines) digest.

Settings live in data/email.json (edited from the web page's
"📧 이메일 발송관리" menu, or by hand):

  {
    "enabled": true,
    "smtp_host": "smtp.gmail.com", "smtp_port": 587,
    "smtp_user": "me@gmail.com", "sender": "me@gmail.com",
    "schedule": {"timezone": "Asia/Seoul", "days": ["MON"], "time": "07:00"},
    "dday": 7,                         # include deadlines from D-Day to D-7
    "categories": ["S", "A", "M"],     # S 최우수 · A 우수 · M 기타(참고용)
    "send_if_empty": true,
    "page_url": "https://…/upcoming.html",
    "receivers": [
      "plain@example.com",                                   # stock-alert style
      {"email": "a@example.com", "name": "", "dday": 14, "enabled": true}
    ]
  }

A receiver's own "dday" overrides the default one. Each receiver gets a
separate message, so addresses are never exposed to one another.

GitHub Actions (.github/workflows/upcoming-deadline-email.yml) runs this
every hour; the script only sends when the latest slot of the schedule
(e.g. Monday 07:00 KST) has passed within the last GRACE_HOURS and has not
been sent yet. The sent slot is recorded in data/email_state.json, which
the workflow commits. Changing the schedule on the web page therefore needs
no workflow edit.

The SMTP password comes from the GMAIL_APP_PASSWORD environment variable
(a repository secret) — never from email.json. SMTP_HOST, SMTP_PORT,
SMTP_USER, EMAIL_FROM and EMAIL_TO (comma list) environment variables,
when set, override the file (same convention as leemgs/stock-alert).

  python3 scripts/send_upcoming_email.py            # scheduled run (sends if due)
  python3 scripts/send_upcoming_email.py --force    # send now, ignore schedule
  python3 scripts/send_upcoming_email.py --dry-run --preview /tmp/mail.html
"""
import argparse
import datetime as dt
import html
import json
import os
import pathlib
import smtplib
import ssl
import sys
import urllib.parse
import urllib.request
from email.message import EmailMessage
from email.utils import formataddr
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONFIG = ROOT / "data" / "email.json"
STATE = ROOT / "data" / "email_state.json"
DEADLINES_JS = ROOT / "docs" / "assets" / "deadlines.js"
DATA_JS = ROOT / "docs" / "assets" / "data.js"

DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
DOW_KO = ["월", "화", "수", "목", "금", "토", "일"]
GRADE_KO = {"S": "최우수(S)", "A": "우수(A)", "M": "기타"}
GRACE_HOURS = 6        # a late (delayed / re-tried) run still sends within this window
DEFAULT_PAGE = "https://aigovsensing.github.io/conference_kiise/upcoming.html"


def log(msg: str) -> None:
    print(f"[UPCOMING-EMAIL] {msg}", flush=True)


# ---------------------------------------------------------------- config
def load_config() -> dict:
    cfg = json.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.exists() else {}
    env = {k: v.strip() for k, v in os.environ.items() if v and v.strip()}
    if "SMTP_HOST" in env:
        cfg["smtp_host"] = env["SMTP_HOST"]
    if "SMTP_PORT" in env:
        cfg["smtp_port"] = env["SMTP_PORT"]
    if "SMTP_USER" in env:
        cfg["smtp_user"] = env["SMTP_USER"]
    if "EMAIL_FROM" in env:
        cfg["sender"] = env["EMAIL_FROM"]
    if "EMAIL_TO" in env:
        cfg["receivers"] = [x.strip() for x in env["EMAIL_TO"].split(",") if x.strip()]
    cfg.setdefault("smtp_host", "smtp.gmail.com")
    cfg["smtp_port"] = int(cfg.get("smtp_port") or 587)
    cfg.setdefault("sender", cfg.get("smtp_user"))
    cfg["dday"] = clamp_dday(cfg.get("dday"), 7)
    cfg["categories"] = [c for c in (cfg.get("categories") or ["S", "A", "M"])
                         if c in GRADE_KO] or ["S", "A", "M"]
    sch = cfg.setdefault("schedule", {})
    sch.setdefault("timezone", "Asia/Seoul")
    sch["days"] = [d.upper()[:3] for d in (sch.get("days") or ["MON"])
                   if d.upper()[:3] in DAYS] or ["MON"]
    sch.setdefault("time", "07:00")
    return cfg


def clamp_dday(value, default: int) -> int:
    try:
        return max(0, min(365, int(value)))
    except (TypeError, ValueError):
        return default


def receivers(cfg: dict) -> list:
    """Normalized [{email, name, dday}] of enabled receivers (deduplicated)."""
    out, seen = [], set()
    for r in cfg.get("receivers") or []:
        if isinstance(r, str):
            r = {"email": r}
        email = (r.get("email") or "").strip()
        if not email or "@" not in email or r.get("enabled") is False:
            continue
        if email.lower() in seen:
            continue
        seen.add(email.lower())
        out.append({"email": email, "name": (r.get("name") or "").strip(),
                    "dday": clamp_dday(r.get("dday"), cfg["dday"])})
    return out


# ---------------------------------------------------------------- schedule
def latest_slot(now: dt.datetime, cfg: dict):
    """Most recent scheduled send time <= now (within the past week)."""
    sch = cfg["schedule"]
    hh, mm = (int(x) for x in sch["time"].split(":")[:2])
    for back in range(8):
        day = (now - dt.timedelta(days=back)).date()
        if DAYS[day.weekday()] in sch["days"]:
            slot = dt.datetime(day.year, day.month, day.day, hh, mm, tzinfo=now.tzinfo)
            if slot <= now:
                return slot
    return None


def load_state() -> dict:
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(state: dict) -> None:
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- data
def load_js_object(path: pathlib.Path):
    """Parse a generated `window.X = {...};` asset as JSON."""
    text = path.read_text(encoding="utf-8")
    start = text.index("=", text.index("window.")) + 1
    return json.loads(text[start:text.rindex(";")])


def load_items() -> list:
    """Upcoming-deadline items enriched with conference name/grade (as the web page does)."""
    deadlines = load_js_object(DEADLINES_JS)["items"]
    data = load_js_object(DATA_JS)
    by_abbr, misc_by_abbr = {}, {}
    for year in reversed(data.get("years") or []):       # prefer the latest survey year
        for r in data["records"]:
            if r.get("year") != year:
                continue
            m = misc_by_abbr if r.get("grade") == "M" else by_abbr
            m.setdefault(r["abbr"], r)
    out = []
    for it in deadlines:
        misc = it.get("cat") == "misc"
        rec = (misc_by_abbr if misc else by_abbr).get(it["abbr"]) or {}
        out.append(dict(it, grade="M" if misc else rec.get("grade", ""),
                        name=rec.get("name", ""), subName=rec.get("subName", ""),
                        major=rec.get("major", "")))
    return out


def select(items: list, today: dt.date, dday: int, categories: list) -> list:
    every = set(categories) >= {"S", "A", "M"}
    out = []
    for it in items:
        d = dt.date.fromisoformat(it["date"])
        left = (d - today).days
        if 0 <= left <= dday and (it["grade"] in categories or (every and not it["grade"])):
            out.append(dict(it, left=left, d=d))
    out.sort(key=lambda i: (i["date"], i["abbr"], i["kind"]))
    return out


# ---------------------------------------------------------------- message
def search_url(it: dict) -> str:
    q = f"{it['name'] or it['abbr']} {it['edition']} call for papers deadline"
    return "https://www.google.com/search?q=" + urllib.parse.quote_plus(q)


def subject_for(items: list, today: dt.date, dday: int) -> str:
    day = f"{today.isoformat()}({DOW_KO[today.weekday()]})"
    if not items:
        return f"[KIISE 선정 학회 마감 알림] D-{dday} 이내 예정된 마감 없음 · {day}"
    return f"[KIISE 선정 학회 마감 알림] D-{dday} 이내 다가오는 마감 {len(items)}건 · {day}"


def html_body(items: list, today: dt.date, dday: int, cfg: dict, name: str = "") -> str:
    e = html.escape
    page = cfg.get("page_url") or DEFAULT_PAGE
    manage = page.rsplit("/", 1)[0] + "/email.html"
    rows = []
    for it in items:
        left = it["left"]
        badge_bg = "#d93025" if left <= 3 else "#d9560b" if left <= 7 else "#2a78d6"
        dlabel = "D-Day" if left == 0 else f"D-{left}"
        grade = it["grade"]
        gpill = ""
        if grade:
            gbg = {"S": "#2a78d6", "A": "#9ec5f4", "M": "#c3c1b8"}[grade]
            gfg = "#ffffff" if grade == "S" else "#0b0b0b"
            gpill = (f'<span style="display:inline-block;margin-left:6px;padding:1px 7px;'
                     f'border-radius:9px;font-size:11px;background:{gbg};color:{gfg}">'
                     f"{GRADE_KO[grade]}</span>")
        est = ("" if it.get("status") == "confirmed" else
               '<span style="display:inline-block;margin-left:6px;padding:1px 7px;'
               'border-radius:9px;font-size:11px;border:1px dashed #898781;color:#52514e">예상</span>')
        note = f" · {e(it['note'])}" if it.get("note") else ""
        sub = f" · {e(it['subName'])}" if it.get("subName") else ""
        rows.append(
            '<tr>'
            f'<td style="padding:10px 8px;border-bottom:1px solid #e1e0d9;white-space:nowrap;vertical-align:top">'
            f'<span style="display:inline-block;min-width:52px;text-align:center;padding:3px 6px;'
            f'border-radius:6px;background:{badge_bg};color:#fff;font-weight:700;font-size:13px">{dlabel}</span>'
            f'<div style="font-size:12px;color:#52514e;margin-top:4px">{it["d"]:%Y.%m.%d} ({DOW_KO[it["d"].weekday()]})</div></td>'
            f'<td style="padding:10px 8px;border-bottom:1px solid #e1e0d9;vertical-align:top">'
            f'<a href="{e(search_url(it))}" style="color:#0b0b0b;text-decoration:none;font-weight:700">'
            f'{e(it["abbr"])} {e(str(it["edition"]))}</a>{gpill}{est}'
            f'<div style="font-size:13px;color:#0b0b0b;margin-top:3px">{e(it["kind"])} 마감{note}</div>'
            + (f'<div style="font-size:12px;color:#898781;margin-top:2px">{e(it["name"])}{sub}</div>'
               if it["name"] else "")
            + '</td></tr>')
    if not rows:
        rows.append('<tr><td colspan="2" style="padding:24px 8px;text-align:center;color:#898781">'
                    f"D-{dday} 이내에 예정된 초록·논문 마감이 없습니다.</td></tr>")
    hello = f"{e(name)}님, " if name else ""
    return f"""<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f9f9f7;font-family:system-ui,-apple-system,'Segoe UI','Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#0b0b0b">
<div style="max-width:640px;margin:0 auto;padding:20px 14px">
  <div style="background:#fcfcfb;border:1px solid #e1e0d9;border-radius:14px;padding:20px 18px">
    <h1 style="margin:0 0 4px;font-size:20px">⏳ 다가오는 마감 (D-{dday} 이내)</h1>
    <p style="margin:0 0 14px;font-size:13px;color:#52514e">{hello}{today:%Y년 %m월 %d일}({DOW_KO[today.weekday()]}) 기준
      KIISE 우수 SW 국제학술대회의 초록·논문 마감 <b>{len(items)}건</b>을 알려드립니다.</p>
    <table role="presentation" style="width:100%;border-collapse:collapse">{''.join(rows)}</table>
    <p style="margin:16px 0 0;font-size:12px;color:#52514e">⚠️ 직전 연도 일정 기반 <b>예상일</b>이 포함되어 있습니다.
      실제 마감일은 반드시 각 학회 공식 홈페이지에서 확인하세요. 학회명을 누르면 CFP 검색 결과가 열립니다.</p>
    <p style="margin:16px 0 0">
      <a href="{e(page)}" style="display:inline-block;padding:9px 16px;border-radius:8px;background:#2a78d6;color:#fff;text-decoration:none;font-size:14px;font-weight:600">전체 마감 일정 보기 ↗</a>
    </p>
  </div>
  <p style="font-size:11px;color:#898781;text-align:center;margin:12px 0 0">
    KIISE 우수 SW 국제학술대회 대시보드 · 발송 설정 변경/수신 해지:
    <a href="{e(manage)}" style="color:#898781">📧 이메일 발송관리</a></p>
</div></body></html>"""


def text_body(items: list, today: dt.date, dday: int, cfg: dict) -> str:
    lines = [f"⏳ 다가오는 마감 (D-{dday} 이내) — {today.isoformat()}({DOW_KO[today.weekday()]}) 기준", ""]
    for it in items:
        dl = "D-Day" if it["left"] == 0 else f"D-{it['left']}"
        tag = "" if it.get("status") == "confirmed" else " [예상]"
        grade = f" [{GRADE_KO[it['grade']]}]" if it["grade"] else ""
        lines.append(f"{dl:>6}  {it['date']}  {it['abbr']} {it['edition']} {it['kind']} 마감{grade}{tag}")
        if it["name"]:
            lines.append(f"        {it['name']}")
    if not items:
        lines.append(f"D-{dday} 이내에 예정된 초록·논문 마감이 없습니다.")
    lines += ["", "실제 마감일은 반드시 각 학회 공식 홈페이지에서 확인하세요.",
              f"전체 일정: {cfg.get('page_url') or DEFAULT_PAGE}"]
    return "\n".join(lines)


# ---------------------------------------------------------------- delivery
def create_issue(title: str, body: str) -> None:
    token, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    if not token or not repo:
        log("GITHUB_TOKEN/GITHUB_REPOSITORY 가 없어 실패 이슈를 생성하지 않습니다.")
        return
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/issues", method="POST",
        data=json.dumps({"title": title, "body": body}).encode(),
        headers={"Authorization": f"Bearer {token}",
                 "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            log(f"실패 이슈 생성: {json.load(res).get('html_url')}")
    except Exception as exc:  # noqa: BLE001 — best effort
        log(f"실패 이슈 생성 중 오류(무시): {exc}")


def send_all(cfg: dict, messages: list) -> list:
    """Send [(to, EmailMessage)] over one SMTP session. Returns [(to, error)]."""
    host, port, user = cfg["smtp_host"], cfg["smtp_port"], cfg.get("smtp_user")
    pw = os.environ.get("GMAIL_APP_PASSWORD", "").strip()
    if not user or not pw:
        raise RuntimeError("SMTP 설정 누락: smtp_user(email.json) 또는 GMAIL_APP_PASSWORD(Secret)")
    ctx = ssl.create_default_context()
    failed = []
    smtp = (smtplib.SMTP_SSL(host, port, context=ctx, timeout=30) if port == 465
            else smtplib.SMTP(host, port, timeout=30))
    with smtp as s:
        if port != 465:
            s.starttls(context=ctx)
        s.login(user, pw)
        for to, msg in messages:
            try:
                s.send_message(msg)
                log(f"발송 성공: {to}")
            except Exception as exc:  # noqa: BLE001 — keep sending to the others
                log(f"발송 실패: {to} — {exc}")
                failed.append((to, str(exc)))
    return failed


def build_messages(cfg: dict, items: list, today: dt.date) -> list:
    out = []
    for r in receivers(cfg):
        picked = select(items, today, r["dday"], cfg["categories"])
        if not picked and not cfg.get("send_if_empty", True):
            log(f"{r['email']}: D-{r['dday']} 이내 마감 없음 — 건너뜀")
            continue
        msg = EmailMessage()
        msg["Subject"] = subject_for(picked, today, r["dday"])
        msg["From"] = formataddr((cfg.get("sender_name") or "", cfg.get("sender") or cfg.get("smtp_user") or ""))
        msg["To"] = formataddr((r["name"], r["email"]))
        msg.set_content(text_body(picked, today, r["dday"], cfg))
        msg.add_alternative(html_body(picked, today, r["dday"], cfg, r["name"]), subtype="html")
        out.append((r["email"], msg))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--force", action="store_true", help="send now, ignoring the schedule")
    ap.add_argument("--dry-run", action="store_true", help="build messages but do not send")
    ap.add_argument("--preview", help="write the first message's HTML to this path")
    ap.add_argument("--now", help="override the current time (ISO 8601, for testing)")
    args = ap.parse_args()

    cfg = load_config()
    tz = ZoneInfo(cfg["schedule"]["timezone"])
    now = dt.datetime.fromisoformat(args.now).astimezone(tz) if args.now else dt.datetime.now(tz)
    state = load_state()

    slot = latest_slot(now, cfg)
    if not args.force:
        if cfg.get("enabled") is False:
            log("email.json 의 enabled=false — 자동 발송이 꺼져 있습니다.")
            return 0
        if slot is None or now - slot > dt.timedelta(hours=GRACE_HOURS):
            log(f"발송 시각 아님 (now={now:%Y-%m-%d %H:%M %Z}, "
                f"schedule={','.join(cfg['schedule']['days'])} {cfg['schedule']['time']})")
            return 0
        if state.get("last_slot") == slot.isoformat():
            log(f"이미 발송한 회차입니다: {slot.isoformat()}")
            return 0

    today = now.date()
    messages = build_messages(cfg, load_items(), today)
    log(f"{now:%Y-%m-%d %H:%M %Z} — 수신자 {len(messages)}명에게 발송 준비")
    if args.preview and messages:
        body = messages[0][1].get_body(("html",)).get_content()
        pathlib.Path(args.preview).write_text(body, encoding="utf-8")
        log(f"미리보기 저장: {args.preview}")
    if args.dry_run:
        for to, msg in messages:
            log(f"(dry-run) {to}: {msg['Subject']}")
        return 0
    if not messages:
        log("보낼 메시지가 없습니다.")
        return 0

    error, failed = None, []
    try:
        failed = send_all(cfg, messages)
    except Exception as exc:  # noqa: BLE001
        error = str(exc)
        log(f"발송 실패: {error}")

    # Record the slot even on failure so a broken setup files one issue,
    # not one per hourly retry. Re-send with workflow_dispatch (force).
    if not args.force and slot is not None:
        state["last_slot"] = slot.isoformat()
    state.update({
        "last_run": now.isoformat(timespec="seconds"),
        "last_mode": "force" if args.force else "schedule",
        "last_sent": len(messages) - len(failed) if error is None else 0,
        "last_failed": len(failed) if error is None else len(messages),
        "last_error": error or "; ".join(f"{to}: {err}" for to, err in failed) or None,
    })
    save_state(state)

    if error or failed:
        detail = error or "\n".join(f"- {to}: `{err}`" for to, err in failed)
        create_issue(
            f"[Email] 다가오는 마감 이메일 발송 실패 — {today.isoformat()}",
            "## 📧 다가오는 마감 이메일(Gmail SMTP) 발송 실패\n\n"
            "Gmail 앱 비밀번호(Secret `GMAIL_APP_PASSWORD`) 또는 `data/email.json` 의 "
            "SMTP 설정을 확인한 뒤, Actions 의 **Upcoming deadline email** 워크플로를 "
            "수동 실행(Run workflow)해 다시 발송하세요.\n\n"
            "| 항목 | 값 |\n| --- | --- |\n"
            f"| 발생 시각 | {now:%Y-%m-%d %H:%M:%S %Z} |\n"
            f"| SMTP 호스트 | {cfg['smtp_host']}:{cfg['smtp_port']} |\n"
            f"| SMTP 사용자 | {cfg.get('smtp_user')} |\n"
            f"| 수신자 수 | {len(messages)} |\n\n"
            f"### 오류\n{detail}\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
