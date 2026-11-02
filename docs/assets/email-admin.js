/* 📧 이메일 발송관리 — edits data/email.json and commits it through the GitHub API.
 *
 * The site is static (GitHub Pages), so settings are read from the repository
 * (GitHub contents API, falling back to raw.githubusercontent.com) and written back
 * with a Personal Access Token the visitor enters. Unsaved edits stay in this
 * browser (localStorage) until committed. GitHub Actions
 * (.github/workflows/upcoming-deadline-email.yml → scripts/send_upcoming_email.py)
 * then sends the "⏳ 다가오는 마감" digest on the configured schedule.
 *
 * Exposes window.KIISE_EMAIL_ADMIN.activate(), called by app.js the first time
 * the 📧 view is shown (nothing is fetched on the other pages).
 */
(function () {
  "use strict";

  const LS_GH = "kiise-email-gh";        // {owner, repo, branch, path, token?}
  const LS_DRAFT = "kiise-email-draft";  // {cfg, baseline, source}
  const WORKFLOW = "upcoming-deadline-email.yml";
  const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const DAY_KO = { MON: "월", TUE: "화", WED: "수", THU: "목", FRI: "금", SAT: "토", SUN: "일" };
  const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"];      // Date#getUTCDay order
  const GRADE_KO = { S: "최우수(S)", A: "우수(A)", M: "기타" };
  const KST_OFFSET = 9 * 3600 * 1000;    // Asia/Seoul has no DST
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const KEY_ORDER = ["_comment", "enabled", "smtp_host", "smtp_port", "smtp_user", "sender",
    "sender_name", "schedule", "dday", "categories", "send_if_empty", "page_url", "receivers"];
  const DEFAULTS = {
    _comment: "다가오는 마감 이메일 발송 설정 — 웹페이지 '📧 이메일 발송관리' 메뉴에서 편집·커밋할 수 있습니다. " +
      "비밀번호(Gmail 앱 비밀번호)는 이 파일에 넣지 말고 저장소 Secret GMAIL_APP_PASSWORD 로 등록하세요.",
    enabled: true,
    smtp_host: "smtp.gmail.com",
    smtp_port: 587,
    smtp_user: "",
    sender: "",
    sender_name: "KIISE 학회 마감 알림",
    schedule: { timezone: "Asia/Seoul", days: ["MON"], time: "07:00" },
    dday: 7,
    categories: ["S", "A", "M"],
    send_if_empty: true,
    page_url: "https://aigovsensing.github.io/conference_kiise/upcoming.html",
    receivers: [],
  };

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } },
  };
  const b64encode = (s) => {
    let bin = "";
    new TextEncoder().encode(s).forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  };
  const b64decode = (b) =>
    new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
  const clampDday = (v, dflt) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(365, n)) : dflt;
  };

  let cfg = null;        // settings being edited
  let baseline = null;   // serialized settings as last loaded from / committed to GitHub
  let source = "";       // where baseline came from
  let loadError = "";
  let started = false;

  /* ---------------- toast ---------------- */
  let toastTimer = 0;
  function toast(msg, ms = 3500) {
    const t = $("#em-toast");
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  /* ---------------- settings model ---------------- */
  function normalize(raw) {
    const c = Object.assign({}, JSON.parse(JSON.stringify(DEFAULTS)), raw || {});
    c.schedule = Object.assign({}, DEFAULTS.schedule, c.schedule || {});
    c.schedule.days = (c.schedule.days || []).map((d) => String(d).toUpperCase().slice(0, 3))
      .filter((d) => DAYS.includes(d));
    if (!/^\d{1,2}:\d{2}$/.test(c.schedule.time || "")) c.schedule.time = "07:00";
    c.dday = clampDday(c.dday, 7);
    c.categories = (c.categories || []).filter((x) => GRADE_KO[x]);
    c.receivers = (c.receivers || []).map((r) => (typeof r === "string" ? { email: r } : r || {}))
      .filter((r) => r.email)
      .map((r) => Object.assign({}, r, {
        email: String(r.email).trim(),
        name: r.name || "",
        dday: r.dday == null || r.dday === "" ? null : clampDday(r.dday, null),
        enabled: r.enabled !== false,
      }));
    return c;
  }
  function serialize(c) {
    const out = {};
    KEY_ORDER.forEach((k) => { if (k in c) out[k] = c[k]; });
    Object.keys(c).forEach((k) => { if (!(k in out)) out[k] = c[k]; });
    out.schedule.days = DAYS.filter((d) => out.schedule.days.includes(d));
    out.smtp_port = parseInt(out.smtp_port, 10) || 587;
    return JSON.stringify(out, null, 2) + "\n";
  }
  const isDirty = () => cfg && serialize(cfg) !== baseline;
  const canonical = (text) => { try { return serialize(normalize(JSON.parse(text))); } catch (_) { return text; } };

  /* ---------------- GitHub settings form ---------------- */
  function initGhForm() {
    const g = store.get(LS_GH) || {};
    let owner = g.owner, repo = g.repo;
    if ((!owner || !repo) && location.hostname.endsWith("github.io")) {
      owner = owner || location.hostname.split(".")[0];
      repo = repo || location.pathname.split("/").filter(Boolean)[0] || "";
    }
    $("#gh-owner").value = owner || "leemgs";
    $("#gh-repo").value = repo || "conference_kiise";
    $("#gh-branch").value = g.branch || "main";
    $("#gh-path").value = g.path || "data/email.json";
    if (g.token) { $("#gh-token").value = g.token; $("#gh-remember").checked = true; }
    ["#gh-owner", "#gh-repo", "#gh-branch", "#gh-path"].forEach((s) =>
      $(s).addEventListener("change", saveGh));
    $("#gh-token").addEventListener("change", saveGh);
    $("#gh-remember").addEventListener("change", () => {
      saveGh();
      toast($("#gh-remember").checked ? "토큰을 이 브라우저에 기억합니다." : "기억된 토큰을 지웠습니다.");
    });
    $("#gh-forget").onclick = () => {
      $("#gh-token").value = ""; $("#gh-remember").checked = false; saveGh();
      toast("저장된 토큰을 삭제했습니다.");
    };
  }
  function gh() {
    return {
      owner: $("#gh-owner").value.trim(),
      repo: $("#gh-repo").value.trim(),
      branch: $("#gh-branch").value.trim() || "main",
      path: ($("#gh-path").value.trim() || "data/email.json").replace(/^\/+/, ""),
      token: $("#gh-token").value.trim(),
    };
  }
  function saveGh() {
    const g = gh();
    const keep = { owner: g.owner, repo: g.repo, branch: g.branch, path: g.path };
    if ($("#gh-remember").checked && g.token) keep.token = g.token;
    store.set(LS_GH, keep);
  }
  const apiUrl = (g) => `https://api.github.com/repos/${encodeURIComponent(g.owner)}/` +
    `${encodeURIComponent(g.repo)}/contents/${g.path.split("/").map(encodeURIComponent).join("/")}`;
  const headers = (g) => Object.assign({ Accept: "application/vnd.github+json" },
    g.token ? { Authorization: "Bearer " + g.token } : {});

  /** Current file on GitHub → {text, sha} (sha only via the API), or throws. */
  async function fetchRemote(g) {
    const r = await fetch(`${apiUrl(g)}?ref=${encodeURIComponent(g.branch)}`,
      { headers: headers(g), cache: "no-store" }).catch(() => null);
    if (r && r.ok) {
      const j = await r.json();
      return { text: b64decode(j.content || ""), sha: j.sha, via: "GitHub API" };
    }
    if (r && r.status === 404) throw new Error("파일 없음 (404)");
    // unauthenticated rate limit etc. → raw CDN (may lag a few minutes behind)
    const raw = await fetch(`https://raw.githubusercontent.com/${g.owner}/${g.repo}/` +
      `${g.branch}/${g.path}?t=${Date.now()}`, { cache: "no-store" }).catch(() => null);
    if (raw && raw.ok) return { text: await raw.text(), sha: null, via: "raw.githubusercontent.com" };
    throw new Error(r ? `HTTP ${r.status}` : "네트워크 오류");
  }

  async function load(discardDraft = false) {
    const draft = !discardDraft && store.get(LS_DRAFT);
    if (draft && draft.cfg) {
      cfg = normalize(draft.cfg);
      baseline = draft.baseline;
      source = draft.source || "";
      loadError = "";
      renderAll();
      return;
    }
    store.del(LS_DRAFT);
    setStatus("", "설정 불러오는 중…", "");
    const g = gh();
    try {
      const { text, via } = await fetchRemote(g);
      cfg = normalize(JSON.parse(text));
      baseline = canonical(text);   // formatting-only differences are not edits
      source = `${g.owner}/${g.repo}@${g.branch}:${g.path} (${via})`;
      loadError = "";
    } catch (err) {
      cfg = normalize({});
      baseline = null;
      source = "";
      loadError = `${g.owner}/${g.repo}@${g.branch}:${g.path} — ${err.message}`;
    }
    renderAll();
  }

  function changed() {
    store.set(LS_DRAFT, isDirty() ? { cfg, baseline, source } : null);
    if (!isDirty()) store.del(LS_DRAFT);
    renderPreview();
    renderRecipients();
    renderJson();
    renderStatus();
  }

  /* ---------------- status bar ---------------- */
  function setStatus(kind, title, sub) {
    const box = $("#em-status");
    box.className = "em-status" + (kind ? " " + kind : "");
    $("#em-status-title").textContent = title;
    $("#em-status-sub").textContent = sub;
  }
  function renderStatus() {
    if (isDirty()) {
      setStatus("dirty", "● 커밋되지 않은 변경사항이 있습니다",
        "이 브라우저에만 임시 저장되었습니다 — 💾 GitHub에 커밋해야 실제 발송에 반영됩니다.");
    } else if (loadError) {
      setStatus("err", "저장소에서 설정을 불러오지 못해 기본값을 표시합니다", loadError);
    } else {
      setStatus("ok", "✓ 저장소 설정과 동일합니다", "출처: " + source);
    }
  }

  /* ---------------- KST date helpers ---------------- */
  // A "KST date" is a Date whose UTC fields hold the Seoul wall-clock time.
  const kstNow = () => new Date(Date.now() + KST_OFFSET);
  const ymd = (d) => d.toISOString().slice(0, 10);
  const dayCode = (d) => DAYS[(d.getUTCDay() + 6) % 7];
  function nextSlot() {
    const now = kstNow();
    const [hh, mm] = cfg.schedule.time.split(":").map(Number);
    for (let i = 0; i <= 7; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i, hh, mm));
      if (cfg.schedule.days.includes(dayCode(d)) && d > now) return d;
    }
    return null;
  }

  /* ---------------- deadline items (same data as ⏳ 다가오는 마감) ---------------- */
  let itemsCache = null;
  function items() {
    if (itemsCache) return itemsCache;
    const dl = (window.KIISE_DEADLINES || {}).items || [];
    const data = window.KIISE_DATA || { records: [], years: [] };
    const byAbbr = new Map(), miscByAbbr = new Map();
    (data.years || []).slice().reverse().forEach((y) => data.records.forEach((r) => {
      if (r.year !== y) return;
      const m = r.grade === "M" ? miscByAbbr : byAbbr;
      if (!m.has(r.abbr)) m.set(r.abbr, r);
    }));
    itemsCache = dl.map((it) => {
      const misc = it.cat === "misc";
      const rec = (misc ? miscByAbbr : byAbbr).get(it.abbr) || {};
      return Object.assign({}, it, { grade: misc ? "M" : rec.grade || "", name: rec.name || "" });
    });
    return itemsCache;
  }
  /** deadlines between baseDate (YYYY-MM-DD) and D-dday, filtered by category */
  function pick(baseDate, dday) {
    const base = Date.parse(baseDate + "T00:00:00Z");
    const every = ["S", "A", "M"].every((c) => cfg.categories.includes(c));
    return items().map((it) => Object.assign({ left: Math.round((Date.parse(it.date + "T00:00:00Z") - base) / 864e5) }, it))
      .filter((it) => it.left >= 0 && it.left <= dday &&
        (cfg.categories.includes(it.grade) || (every && !it.grade)))
      .sort((a, b) => a.date.localeCompare(b.date) || a.abbr.localeCompare(b.abbr));
  }
  const fmtDay = (d) => `${ymd(d).replace(/-/g, ".")} (${DOW_KO[d.getUTCDay()]})`;
  function previewBase() {
    const slot = cfg.enabled && cfg.schedule.days.length ? nextSlot() : null;
    return { slot, date: slot ? ymd(slot) : ymd(kstNow()) };
  }

  /* ---------------- schedule card ---------------- */
  function initSchedule() {
    const days = $("#em-days");
    DAYS.forEach((d) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.dataset.val = d; b.textContent = DAY_KO[d];
      b.onclick = () => {
        const on = cfg.schedule.days.includes(d);
        cfg.schedule.days = on ? cfg.schedule.days.filter((x) => x !== d) : cfg.schedule.days.concat(d);
        renderSchedule(); changed();
      };
      days.appendChild(b);
    });
    const quick = $("#em-dday-quick");
    [3, 7, 14, 30].forEach((n) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.dataset.val = String(n); b.textContent = "D-" + n;
      b.onclick = () => { cfg.dday = n; renderSchedule(); changed(); };
      quick.appendChild(b);
    });
    $("#em-enabled").onchange = (e) => { cfg.enabled = e.target.checked; changed(); };
    $("#em-time").onchange = (e) => {
      if (/^\d{2}:\d{2}$/.test(e.target.value)) { cfg.schedule.time = e.target.value; changed(); }
    };
    $("#em-dday").oninput = (e) => {
      if (e.target.value === "") return;
      cfg.dday = clampDday(e.target.value, cfg.dday);
      renderDdayQuick(); changed();
    };
    $("#em-dday").onchange = renderSchedule;
    document.querySelectorAll("#em-cats input").forEach((cb) => {
      cb.onchange = () => {
        cfg.categories = [...document.querySelectorAll("#em-cats input:checked")].map((x) => x.value);
        changed();
      };
    });
    $("#em-send-empty").onchange = (e) => { cfg.send_if_empty = e.target.checked; changed(); };
    [["#em-smtp-host", "smtp_host"], ["#em-smtp-port", "smtp_port"], ["#em-smtp-user", "smtp_user"],
     ["#em-sender", "sender"], ["#em-sender-name", "sender_name"], ["#em-page-url", "page_url"]]
      .forEach(([sel, key]) => {
        $(sel).oninput = (e) => {
          cfg[key] = key === "smtp_port" ? parseInt(e.target.value, 10) || 587 : e.target.value.trim();
          changed();
        };
      });
  }
  function renderDdayQuick() {
    document.querySelectorAll("#em-dday-quick .chip").forEach((b) =>
      b.setAttribute("aria-pressed", String(Number(b.dataset.val) === cfg.dday)));
  }
  function renderSchedule() {
    $("#em-enabled").checked = cfg.enabled !== false;
    document.querySelectorAll("#em-days .chip").forEach((b) =>
      b.setAttribute("aria-pressed", String(cfg.schedule.days.includes(b.dataset.val))));
    $("#em-time").value = cfg.schedule.time.padStart(5, "0");
    $("#em-dday").value = cfg.dday;
    renderDdayQuick();
    document.querySelectorAll("#em-cats input").forEach((cb) => {
      cb.checked = cfg.categories.includes(cb.value);
    });
    $("#em-send-empty").checked = cfg.send_if_empty !== false;
    $("#em-smtp-host").value = cfg.smtp_host || "";
    $("#em-smtp-port").value = cfg.smtp_port || 587;
    $("#em-smtp-user").value = cfg.smtp_user || "";
    $("#em-sender").value = cfg.sender || "";
    $("#em-sender-name").value = cfg.sender_name || "";
    $("#em-page-url").value = cfg.page_url || "";
  }
  function renderPreview() {
    const { slot, date } = previewBase();
    const head = $("#em-next");
    if (cfg.enabled === false) {
      head.textContent = "⏸️ 자동 발송이 꺼져 있습니다";
    } else if (!cfg.schedule.days.length) {
      head.textContent = "⚠️ 발송 요일을 하나 이상 선택하세요";
    } else {
      const days = DAYS.filter((d) => cfg.schedule.days.includes(d)).map((d) => DAY_KO[d]).join("·");
      head.textContent = `📬 다음 발송 예정: ${fmtDay(slot)} ${cfg.schedule.time} KST  (매주 ${days})`;
    }
    const list = pick(date, cfg.dday);
    const active = cfg.receivers.filter((r) => r.enabled !== false).length;
    $("#em-preview-sub").innerHTML = (slot ? `${esc(fmtDay(slot))} 발송 시점` : "오늘") +
      ` 기준 <b>D-${cfg.dday}</b> 이내 마감 <b>${list.length}건</b> · 수신자 ${active}명` +
      (!list.length && !cfg.send_if_empty ? " — 마감이 없으면 발송하지 않습니다" : "");
    const ol = $("#em-preview-list");
    ol.innerHTML = "";
    list.forEach((it) => {
      const li = document.createElement("li");
      const cls = it.left <= 3 ? "dd soon" : it.left <= 7 ? "dd near" : "dd";
      const d = new Date(Date.parse(it.date + "T00:00:00Z"));
      li.innerHTML = `<span class="${cls}">${it.left === 0 ? "D-Day" : "D-" + it.left}</span>` +
        `<span class="when">${esc(fmtDay(d))}</span>` +
        `<span class="what"><b>${esc(it.abbr)} ${esc(it.edition)}</b> ${esc(it.kind)} 마감` +
        (it.grade ? ` · ${GRADE_KO[it.grade]}` : "") +
        (it.status === "confirmed" ? "" : ` <span class="muted">(예상)</span>`) + `</span>`;
      ol.appendChild(li);
    });
    if (!list.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = `D-${cfg.dday} 이내에 예정된 마감이 없습니다.`;
      ol.appendChild(li);
    }
  }

  /* ---------------- recipients card ---------------- */
  function initRecipients() {
    $("#em-add").addEventListener("submit", (e) => {
      e.preventDefault();
      const email = $("#em-add-email").value.trim();
      if (!EMAIL_RE.test(email)) { toast("올바른 이메일 주소를 입력하세요."); return; }
      if (cfg.receivers.some((r) => r.email.toLowerCase() === email.toLowerCase())) {
        toast("이미 등록된 수신자입니다."); return;
      }
      const dd = $("#em-add-dday").value;
      cfg.receivers.push({ email, name: $("#em-add-name").value.trim(),
        dday: dd === "" ? null : clampDday(dd, null), enabled: true });
      $("#em-add").reset();
      changed();
      toast(`수신자 추가: ${email} — 💾 GitHub에 커밋해야 반영됩니다.`);
    });
  }
  function renderRecipients() {
    const tbody = $("#em-rcpt-body");
    // don't rebuild while the user is typing inside the table (keeps focus/caret)
    if (tbody.contains(document.activeElement) && tbody.dataset.n === String(cfg.receivers.length)) {
      tbody.querySelectorAll("tr").forEach((tr, i) => {
        const r = cfg.receivers[i];
        tr.classList.toggle("off", r.enabled === false);
        tr.querySelector(".em-count").textContent = countLabel(r);
      });
      return;
    }
    tbody.innerHTML = "";
    tbody.dataset.n = String(cfg.receivers.length);
    cfg.receivers.forEach((r, i) => {
      const tr = document.createElement("tr");
      tr.classList.toggle("off", r.enabled === false);
      tr.innerHTML =
        `<td>${i + 1}</td>` +
        `<td class="em-email"><input type="email" value="${esc(r.email)}" aria-label="이메일"></td>` +
        `<td><input value="${esc(r.name)}" placeholder="(선택)" aria-label="이름"></td>` +
        `<td><span class="em-inline"><span class="em-dprefix">D-</span><input type="number" min="0" max="365" ` +
          `value="${r.dday == null ? "" : r.dday}" placeholder="${cfg.dday}" aria-label="D-day (비우면 기본값)"></span></td>` +
        `<td class="em-count"></td>` +
        `<td><input type="checkbox" ${r.enabled === false ? "" : "checked"} aria-label="수신"></td>` +
        `<td><button type="button" class="btn ghost icon" title="삭제" aria-label="삭제">🗑️</button></td>`;
      const [emailIn, nameIn, ddIn, onIn] = tr.querySelectorAll("input");
      emailIn.onchange = () => {
        const v = emailIn.value.trim();
        if (!EMAIL_RE.test(v)) { toast("올바른 이메일 주소를 입력하세요."); emailIn.value = r.email; return; }
        r.email = v; changed();
      };
      nameIn.oninput = () => { r.name = nameIn.value.trim(); changed(); };
      ddIn.oninput = () => { r.dday = ddIn.value === "" ? null : clampDday(ddIn.value, null); changed(); };
      onIn.onchange = () => { r.enabled = onIn.checked; changed(); };
      tr.querySelector("button").onclick = () => {
        if (!confirm(`${r.email} 수신자를 삭제할까요?`)) return;
        cfg.receivers.splice(i, 1);
        tbody.dataset.n = "";
        changed();
      };
      tr.querySelector(".em-count").textContent = countLabel(r);
      tbody.appendChild(tr);
    });
    $("#em-rcpt-empty").hidden = cfg.receivers.length > 0;
  }
  function countLabel(r) {
    const dday = r.dday == null ? cfg.dday : r.dday;
    return `D-${dday} · ${pick(previewBase().date, dday).length}건`;
  }

  /* ---------------- JSON preview / manual fallback ---------------- */
  function renderJson() { $("#em-json-pre").textContent = serialize(cfg); }
  function initJson() {
    $("#em-copy").onclick = async () => {
      try { await navigator.clipboard.writeText(serialize(cfg)); toast("클립보드에 복사했습니다."); }
      catch (_) { toast("복사 실패 — 다운로드를 사용하세요."); }
    };
    $("#em-download").onclick = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([serialize(cfg)], { type: "application/json" }));
      a.download = "email.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
  }

  /* ---------------- commit / test send ---------------- */
  function needToken(g) {
    if (g.owner && g.repo && g.token) return false;
    toast("⚙️ GitHub Token 관리에서 Owner·Repo·Token을 입력하세요.");
    document.getElementById("email-github-card").scrollIntoView({ behavior: "smooth", block: "start" });
    $("#em-gh").open = true;
    setTimeout(() => $(g.token ? "#gh-owner" : "#gh-token").focus(), 400);
    return true;
  }
  function validate() {
    if (!cfg.schedule.days.length) return "발송 요일을 하나 이상 선택하세요.";
    if (!cfg.categories.length) return "학회 분류를 하나 이상 선택하세요.";
    const bad = cfg.receivers.find((r) => !EMAIL_RE.test(r.email));
    if (bad) return `잘못된 이메일 주소: ${bad.email}`;
    return "";
  }
  async function commit() {
    const g = gh();
    if (needToken(g)) return;
    const problem = validate();
    if (problem) { toast(problem); return; }
    saveGh();
    const text = serialize(cfg);
    const btns = [$("#em-save"), $("#gh-commit")];
    btns.forEach((b) => { b.disabled = true; b.dataset.label = b.textContent; b.textContent = "커밋 중…"; });
    try {
      let sha;
      const cur = await fetch(`${apiUrl(g)}?ref=${encodeURIComponent(g.branch)}`,
        { headers: headers(g), cache: "no-store" });
      if (cur.ok) {
        const j = await cur.json();
        sha = j.sha;
        const remote = canonical(b64decode(j.content || ""));
        if (remote === text) { baseline = text; changed(); toast("변경사항이 없습니다 — 이미 저장소와 같습니다."); return; }
        if (baseline != null && remote !== baseline &&
            !confirm("불러온 이후 저장소의 email.json이 다른 곳에서 변경되었습니다.\n덮어쓸까요?")) return;
      } else if (cur.status !== 404) {
        const err = await cur.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${cur.status}`);
      }
      const res = await fetch(apiUrl(g), {
        method: "PUT", headers: headers(g),
        body: JSON.stringify(Object.assign({
          message: "chore(email): update upcoming-deadline email settings via dashboard",
          content: b64encode(text), branch: g.branch,
        }, sha ? { sha } : {})),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      baseline = text;
      source = `${g.owner}/${g.repo}@${g.branch}:${g.path} (GitHub API)`;
      loadError = "";
      changed();
      toast("✓ GitHub 커밋 완료 — 다음 발송부터 반영됩니다.", 5000);
    } catch (err) {
      toast("커밋 실패: " + err.message +
        (/Bad credentials|Resource not accessible|403|401/.test(err.message)
          ? " (토큰 권한 Contents: Read and write 확인)" : ""), 7000);
    } finally {
      btns.forEach((b) => { b.disabled = false; b.textContent = b.dataset.label; });
    }
  }
  async function testSend() {
    const g = gh();
    if (needToken(g)) return;
    if (isDirty() && !confirm("커밋되지 않은 변경사항은 테스트 발송에 반영되지 않습니다 (저장소의 email.json 기준으로 발송).\n계속할까요?")) return;
    if (!confirm(`${g.owner}/${g.repo} 의 "${WORKFLOW}" 워크플로를 실행해 지금 바로 모든 수신자에게 메일을 발송합니다.\n계속할까요?`)) return;
    saveGh();
    const b = $("#gh-test");
    b.disabled = true;
    try {
      const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(g.owner)}/` +
        `${encodeURIComponent(g.repo)}/actions/workflows/${WORKFLOW}/dispatches`, {
        method: "POST", headers: headers(g), body: JSON.stringify({ ref: g.branch }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err.message || `HTTP ${res.status}`) +
          (res.status === 403 || res.status === 404 ? " (토큰 권한 Actions: Read and write 확인)" : ""));
      }
      toast("🧪 발송 워크플로를 실행했습니다 — 1~2분 후 메일함을 확인하세요.", 6000);
    } catch (err) {
      toast("실행 실패: " + err.message, 7000);
    } finally {
      b.disabled = false;
    }
  }

  /* ---------------- boot ---------------- */
  function renderAll() {
    renderSchedule();
    $("#em-rcpt-body").dataset.n = "";
    changed();
  }
  function activate() {
    if (started || !$("#view-email")) return;
    started = true;
    initGhForm();
    initSchedule();
    initRecipients();
    initJson();
    $("#em-save").onclick = commit;
    $("#gh-commit").onclick = commit;
    $("#gh-test").onclick = testSend;
    $("#em-reload").onclick = () => {
      if (isDirty() && !confirm("커밋되지 않은 변경사항을 버리고 저장소에서 다시 불러올까요?")) return;
      load(true);
    };
    cfg = normalize({});
    load();
  }

  window.KIISE_EMAIL_ADMIN = { activate };
})();
