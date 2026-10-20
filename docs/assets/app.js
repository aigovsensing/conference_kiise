/* KIISE 우수 SW 국제학술대회 대시보드 — app logic (vanilla JS, no dependencies) */
(function () {
  "use strict";

  const DATA = window.KIISE_DATA;
  if (!DATA) { console.error("KIISE_DATA not loaded"); return; }

  const allRecords = DATA.records;
  const deleted = DATA.deleted || [];
  const majorNames = DATA.majorNames || {};
  const years = DATA.years || [];
  // S = 최우수, A = 우수 (KIISE 지정), M = 기타 (KIISE 비지정 일반 해외 학회, 참고용)
  const GRADE_RANK = { S: 0, A: 1, M: 2 };
  const isMisc = (r) => r.grade === "M";

  /* ---------------- language (KO/EN) ---------------- */
  const LANG = localStorage.getItem("kiise-lang") === "en" ? "en" : "ko";
  const T = (window.KIISE_I18N && window.KIISE_I18N[LANG]) || window.KIISE_I18N.ko;

  const CSS = getComputedStyle(document.documentElement);
  const color = (name) => CSS.getPropertyValue(name).trim();
  const majorColor = (m) => (m === "AI" ? color("--ai") : color("--cs"));

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const count = (arr, fn) => arr.filter(fn).length;

  // conference identity for year-over-year diff: abbr sans parenthetical qualifier
  const confKey = (r) =>
    (r.abbr || r.name).replace(/\(.*?\)/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  // year -> Map(confKey -> record), for computing 신규/삭제 vs the previous year
  const yearKeys = {};
  years.forEach((y) => {
    const m = new Map();
    allRecords.forEach((r) => {
      if (r.year === y && !isMisc(r) && !m.has(confKey(r))) m.set(confKey(r), r);
    });
    yearKeys[y] = m;
  });

  /* ---------------- conference Google search side panel ---------------- */
  // build a Google search query string (HTML-attribute safe) for a record
  function confQuery(r) {
    const parts = [r.name, r.abbr, "conference"].filter(Boolean);
    return encodeURIComponent(parts.join(" "))
      .replace(/'/g, "%27").replace(/"/g, "%22");
  }
  // open web search results for a record in the slide-in side panel.
  // Bing serves without X-Frame-Options/frame-ancestors so it embeds in an
  // iframe without tripping bot detection (Google's igu=1 trick triggers
  // frequent reCAPTCHA challenges). The ↗ button still opens Google in a tab.
  function openConfSearch(query, title) {
    const panel = $("#search-panel"), backdrop = $("#search-backdrop");
    $("#search-panel-title").textContent = title;
    $("#search-panel-open").href = "https://www.google.com/search?q=" + query;
    $("#search-frame").src = "https://www.bing.com/search?q=" + query;
    backdrop.hidden = false; panel.hidden = false;
    requestAnimationFrame(() => { backdrop.classList.add("open"); panel.classList.add("open"); });
    document.body.classList.add("panel-open");
    $("#search-panel-close").focus();
  }
  function closeConfSearch() {
    const panel = $("#search-panel"), backdrop = $("#search-backdrop");
    panel.classList.remove("open"); backdrop.classList.remove("open");
    document.body.classList.remove("panel-open");
    const done = () => {
      panel.hidden = true; backdrop.hidden = true;
      $("#search-frame").src = "about:blank"; // stop the framed page
      panel.removeEventListener("transitionend", done);
    };
    panel.addEventListener("transitionend", done);
  }

  /* ---------------- tooltip ---------------- */
  const tip = $("#tooltip");
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.hidden = false;
    moveTip(x, y);
  }
  function moveTip(x, y) {
    const pad = 10;
    tip.style.left = Math.max(pad, Math.min(x, innerWidth - pad)) + "px";
    tip.style.top = Math.max(28, y - 12) + "px";
  }
  function hideTip() { tip.hidden = true; }
  function bindTip(node, htmlFn) {
    node.addEventListener("mousemove", (e) => showTip(htmlFn(), e.clientX, e.clientY));
    node.addEventListener("mouseleave", hideTip);
  }

  /* ---------------- summary tiles ---------------- */
  function renderTiles(records) {
    const majors = [...new Set(records.map((r) => r.major))];
    const subs = [...new Set(records.map((r) => r.sub))];
    const tiles = [
      { val: records.length, lbl: T.tileAll, dot: null },
      { val: count(records, (r) => r.grade === "S"), lbl: T.tileS, dot: color("--grade-s") },
      { val: count(records, (r) => r.grade === "A"), lbl: T.tileA, dot: color("--grade-a") },
      { val: count(records, isMisc), lbl: T.tileM, dot: color("--grade-m") },
      { val: majors.length, lbl: T.tileMajor, dot: null },
      { val: subs.length, lbl: T.tileSub, dot: null },
    ];
    const box = $("#tiles");
    box.innerHTML = "";
    tiles.forEach((t) => {
      const dot = t.dot ? `<span class="dot" style="background:${t.dot}"></span>` : "";
      box.appendChild(el("div", "tile",
        `<div class="val">${dot}${t.val}</div><div class="lbl">${t.lbl}</div>`));
    });
  }

  /* ---------------- major × grade stacked ---------------- */
  function renderMajor(records) {
    const host = $("#chart-major");
    host.innerHTML = "";
    const majors = ["CS", "AI"].filter((m) => records.some((r) => r.major === m));
    const max = Math.max(1, ...majors.map((m) => count(records, (r) => r.major === m)));
    majors.forEach((m) => {
      const s = count(records, (r) => r.major === m && r.grade === "S");
      const a = count(records, (r) => r.major === m && r.grade === "A");
      const o = count(records, (r) => r.major === m && isMisc(r));
      const total = s + a + o;
      const row = el("div", "mrow");
      row.appendChild(el("div", "mk",
        `<b>${m}</b> <small>${majorNames[m] || ""}</small>`));
      const stack = el("div", "stack");
      stack.style.width = (total / max * 100) + "%";
      const mkSeg = (val, bg, dark, gradeLabel) => {
        const seg = el("div", "seg", val > 0 ? String(val) : "");
        seg.style.background = bg;
        seg.style.flexBasis = (val / total * 100) + "%";
        if (dark) { seg.style.color = "#0b0b0b"; seg.style.textShadow = "none"; }
        bindTip(seg, () =>
          `<b>${m} · ${T.gradeFull(gradeLabel)}</b><br>${T.cnt(val)} ` +
          `<span class="tt-sub">${T.inMajorPct(m, (val / total * 100).toFixed(0))}</span>`);
        return seg;
      };
      stack.append(
        mkSeg(s, color("--grade-s"), false, "S"),
        mkSeg(a, color("--grade-a"), true, "A"),
        mkSeg(o, color("--grade-m"), true, "M"));
      row.appendChild(stack);
      host.appendChild(row);
    });
    $("#legend-grade").innerHTML =
      `<span><i style="background:${color("--grade-s")}"></i> ${T.gradeSFull}</span>` +
      `<span><i style="background:${color("--grade-a")}"></i> ${T.gradeAFull}</span>` +
      `<span><i style="background:${color("--grade-m")}"></i> ${T.gradeMFull}</span>`;
  }

  /* ---------------- grade donut (with tooltip) ---------------- */
  function renderGrade(records) {
    const host = $("#chart-grade");
    host.innerHTML = "";
    // S → A → 기타 순서로 시계 방향 세그먼트
    const segs = [
      { g: "S", n: count(records, (r) => r.grade === "S"), c: color("--grade-s") },
      { g: "A", n: count(records, (r) => r.grade === "A"), c: color("--grade-a") },
      { g: "M", n: count(records, isMisc), c: color("--grade-m") },
    ];
    const total = records.length || 1;
    let acc = 0;
    segs.forEach((sg) => { sg.from = acc; acc += sg.n / total * 100; sg.to = acc; });

    const donut = el("div", "donut");
    donut.style.background = "conic-gradient(" +
      segs.map((sg) => `${sg.c} ${sg.from}% ${sg.to}%`).join(", ") + ")";
    donut.appendChild(el("div", "donut-center", `<b>${records.length}</b><small>${T.donutUnit}</small>`));

    // segment detection by angle (clockwise from 12 o'clock)
    donut.addEventListener("mousemove", (e) => {
      const rect = donut.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx, dy = e.clientY - cy;
      const r = Math.hypot(dx, dy);
      if (r > rect.width / 2 || r < rect.width / 2 - 26) { hideTip(); return; }
      let ang = Math.atan2(dx, -dy) * 180 / Math.PI; // 0=top, cw+
      if (ang < 0) ang += 360;
      const pct = ang / 360 * 100;
      const sg = segs.find((x) => pct < x.to) || segs[segs.length - 1];
      showTip(
        `<b>${T.gradeFull(sg.g)}</b><br>${T.cnt(sg.n)} ` +
        `<span class="tt-sub">(${(sg.n / total * 100).toFixed(0)}%)</span>`,
        e.clientX, e.clientY);
    });
    donut.addEventListener("mouseleave", hideTip);

    const legend = el("div", "donut-legend", segs.map((sg) =>
      `<span><i style="background:${sg.c}"></i> ${T.gradeFull(sg.g)} &nbsp; ` +
      `<b>${sg.n}</b> (${(sg.n / total * 100).toFixed(0)}%)</span>`).join(""));
    host.append(donut, legend);
  }

  /* ---------------- sub-field bars (with tooltip) ---------------- */
  function renderSub(records) {
    const host = $("#chart-sub");
    host.innerHTML = "";
    const map = new Map();
    records.forEach((r) => {
      if (!map.has(r.sub)) map.set(r.sub, { sub: r.sub, subName: r.subName, major: r.major, n: 0, s: 0, a: 0, m: 0 });
      const o = map.get(r.sub);
      o.n++; o[r.grade === "S" ? "s" : r.grade === "A" ? "a" : "m"]++;
    });
    const rows = [...map.values()].sort((x, y) => y.n - x.n);
    const max = Math.max(1, ...rows.map((r) => r.n));
    rows.forEach((r) => {
      const row = el("div", "bar-row");
      row.appendChild(el("div", "k", `<b>${r.sub}</b> · ${r.subName}`));
      const track = el("div", "bar-track");
      const fill = el("div", "bar-fill");
      fill.style.width = (r.n / max * 100) + "%";
      fill.style.background = majorColor(r.major);
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el("div", "v", String(r.n)));
      bindTip(track, () =>
        `<b>${r.sub} · ${r.subName}</b><br>` +
        `${T.totalCnt(r.n)} <span class="tt-sub">(${r.major})</span><br>` +
        `<span class="tt-sub">S ${r.s} · A ${r.a}` + (r.m ? ` · ${T.mShort} ${r.m}` : "") + `</span>`);
      host.appendChild(row);
    });
    $("#legend-major").innerHTML =
      `<span><i style="background:${color("--cs")}"></i> CS (Computer Science)</span>` +
      `<span><i style="background:${color("--ai")}"></i> AI (Artificial Intelligence)</span>`;
  }

  /* ---------------- filters + table ---------------- */
  // Default: 가장 최근 연도, S 등급 우선 정렬, 페이지당 15개
  const state = { q: "", year: years.length ? years[years.length - 1] : "ALL",
                  major: "ALL", grade: "ALL", sub: "ALL",
                  sortKey: "grade", sortDir: 1, page: 1, pageSize: 15 };

  // reset to first page whenever the result set changes, then re-render
  function resetAndRender() { state.page = 1; renderTable(); }

  function scoped() {
    return state.year === "ALL" ? allRecords : allRecords.filter((r) => r.year === state.year);
  }

  function buildFilters() {
    // year select
    const ys = $("#filter-year");
    ys.appendChild(new Option(years.length > 1 ? T.allYears : T.yearOpt(years[0]), "ALL"));
    if (years.length > 1) years.forEach((y) => ys.appendChild(new Option(T.yearOpt(y), y)));
    ys.onchange = () => { state.year = ys.value; refresh(); };
    ys.value = state.year;               // reflect the default (latest year)
    if (years.length <= 1) ys.disabled = true;

    // major chips
    const mg = $("#filter-major");
    [["ALL", T.all], ["CS", "CS"], ["AI", "AI"]].forEach(([v, label]) => {
      const b = el("button", "chip", label);
      b.dataset.val = v;
      b.setAttribute("aria-pressed", v === "ALL");
      b.onclick = () => { state.major = v; setPressed(mg, v); resetAndRender(); };
      mg.appendChild(b);
    });
    // grade chips
    const gg = $("#filter-grade");
    [["ALL", T.all], ["S", T.sChip], ["A", T.aChip], ["M", T.mChip]].forEach(([v, label]) => {
      const b = el("button", "chip", label);
      b.dataset.val = v;
      b.setAttribute("aria-pressed", v === "ALL");
      b.onclick = () => { state.grade = v; setPressed(gg, v); resetAndRender(); };
      gg.appendChild(b);
    });
    // sub select
    const sel = $("#filter-sub");
    sel.appendChild(new Option(T.allSubs, "ALL"));
    [...new Set(allRecords.map((r) => r.sub))].sort().forEach((s) => {
      const rec = allRecords.find((r) => r.sub === s);
      sel.appendChild(new Option(`${s} · ${rec.subName}`, s));
    });
    sel.onchange = () => { state.sub = sel.value; resetAndRender(); };
    // page size
    const ps = $("#page-size");
    ps.onchange = () => { state.pageSize = parseInt(ps.value, 10) || 15; resetAndRender(); };
    // search
    $("#search").addEventListener("input", (e) => {
      state.q = e.target.value.trim().toLowerCase();
      resetAndRender();
    });
    // sortable headers
    document.querySelectorAll("thead th[data-sort]").forEach((th) => {
      th.onclick = () => {
        const k = th.dataset.sort;
        if (state.sortKey === k) state.sortDir *= -1;
        else { state.sortKey = k; state.sortDir = 1; }
        resetAndRender();
      };
    });
  }
  function setPressed(group, val) {
    group.querySelectorAll(".chip").forEach((c) =>
      c.setAttribute("aria-pressed", c.dataset.val === val));
  }

  function filtered() {
    return scoped().filter((r) => {
      if (state.major !== "ALL" && r.major !== state.major) return false;
      if (state.grade !== "ALL" && r.grade !== state.grade) return false;
      if (state.sub !== "ALL" && r.sub !== state.sub) return false;
      if (state.q) {
        const hay = (r.abbr + " " + r.name + " " + r.subName).toLowerCase();
        if (!hay.includes(state.q)) return false;
      }
      return true;
    });
  }

  function compare(a, b) {
    const k = state.sortKey;
    if (k === "grade") {
      const d = (GRADE_RANK[a.grade] - GRADE_RANK[b.grade]) * state.sortDir;
      return d || a.no.localeCompare(b.no, "en", { numeric: true });
    }
    const av = (a[k] || "").toString(), bv = (b[k] || "").toString();
    return av.localeCompare(bv, "en", { numeric: true }) * state.sortDir;
  }

  function renderTable() {
    const rows = filtered().sort(compare);
    const total = rows.length;
    const pageSize = state.pageSize;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    if (state.page > pages) state.page = pages;
    if (state.page < 1) state.page = 1;
    const start = (state.page - 1) * pageSize;
    const pageRows = rows.slice(start, start + pageSize);

    const tbody = $("#conf-tbody");
    tbody.innerHTML = "";
    pageRows.forEach((r) => {
      const tr = document.createElement("tr");
      const note = r.note ? `<span class="note-tag">${r.note}</span>` : "";
      const site = r.url
        ? ` <a class="conf-site" href="${r.url}" target="_blank" rel="noopener" title="${T.siteTitle}" aria-label="${T.siteTitle}">🔗</a>` : "";
      if (isMisc(r)) tr.className = "misc-row";
      tr.innerHTML =
        `<td class="no">${r.no}</td>` +
        `<td><span class="pill ${r.major.toLowerCase()}">${r.major}</span></td>` +
        `<td>${r.sub}</td>` +
        `<td class="abbr"><b>${r.abbr}</b></td>` +
        `<td class="name"><a href="#" class="conf-link" data-q="${confQuery(r)}" title="${T.confLinkTitle}">${r.name}</a>${site}</td>` +
        `<td><span class="pill grade-${r.grade.toLowerCase()}">${T.gradeShort(r.grade)}</span></td>` +
        `<td>${note}</td>`;
      tbody.appendChild(tr);
    });
    $("#empty-msg").hidden = total > 0;
    $("#table-count").textContent = total;
    renderPagination(total, pages, start, pageRows.length);
  }

  function renderPagination(total, pages, start, shown) {
    const nav = $("#pagination");
    nav.innerHTML = "";
    if (total === 0) return;

    const info = el("span", "page-info",
      T.pageInfo(start + 1, start + shown, total, state.page, pages));
    nav.appendChild(info);

    const go = (p) => { state.page = p; renderTable(); };
    const btn = (label, page, opts = {}) => {
      const b = el("button", "pg-btn", label);
      if (opts.current) b.setAttribute("aria-current", "true");
      if (opts.disabled) b.disabled = true;
      else b.onclick = () => go(page);
      return b;
    };

    nav.appendChild(btn("‹", state.page - 1, { disabled: state.page === 1 }));

    // windowed page numbers with first/last + ellipsis
    const win = 2;
    const nums = new Set([1, pages]);
    for (let p = state.page - win; p <= state.page + win; p++) {
      if (p >= 1 && p <= pages) nums.add(p);
    }
    const sorted = [...nums].sort((a, b) => a - b);
    let prev = 0;
    sorted.forEach((p) => {
      if (p - prev > 1) nav.appendChild(el("span", "pg-ellipsis", "…"));
      nav.appendChild(btn(String(p), p, { current: p === state.page }));
      prev = p;
    });

    nav.appendChild(btn("›", state.page + 1, { disabled: state.page === pages }));
  }

  function renderDeleted() {
    const tbody = $("#deleted-tbody");
    tbody.innerHTML = "";
    const rows = state.year === "ALL"
      ? deleted : deleted.filter((r) => r.year === state.year);
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td><span class="pill ${r.major.toLowerCase()}">${r.major}</span></td>` +
        `<td>${r.sub}</td>` +
        `<td class="abbr"><b>${r.abbr}</b></td>` +
        `<td class="name">${r.name}</td>` +
        `<td><span class="pill grade-${r.grade.toLowerCase()}">${r.grade}</span></td>`;
      tbody.appendChild(tr);
    });
    $("#deleted-count").textContent = rows.length;
    $("#deleted-year").textContent =
      state.year === "ALL" ? T.all : state.year;
  }

  /* ---------------- year-over-year 신규/삭제 ---------------- */
  function fillChangeList(ul, arr) {
    ul.innerHTML = "";
    if (!arr.length) { ul.appendChild(el("li", "chg-empty muted", T.none)); return; }
    arr.forEach((r) => {
      const li = el("li", "chg-item",
        `<span class="pill grade-${r.grade.toLowerCase()}">${r.grade}</span>` +
        `<span class="pill ${r.major.toLowerCase()}">${r.major}</span>` +
        `<b class="chg-abbr">${r.abbr}</b>` +
        `<span class="chg-name">${r.name}</span>`);
      li.title = `${r.abbr} — ${r.name}`;
      ul.appendChild(li);
    });
  }

  function renderChanges() {
    const card = $("#changes-card");
    const idx = years.indexOf(state.year);
    const prev = state.year !== "ALL" && idx > 0 ? years[idx - 1] : null;
    if (!prev) { card.hidden = true; return; }   // 첫 연도 또는 '전체 연도'
    card.hidden = false;
    const cur = yearKeys[state.year], old = yearKeys[prev];
    const bySA = (a, b) =>
      (GRADE_RANK[a.grade] - GRADE_RANK[b.grade]) || a.abbr.localeCompare(b.abbr);
    const news = [...cur.values()].filter((r) => !old.has(confKey(r))).sort(bySA);
    const dels = [...old.values()].filter((r) => !cur.has(confKey(r))).sort(bySA);
    $("#changes-sub").textContent = T.vsRange(prev, state.year);
    $("#new-count").textContent = news.length;
    $("#del-count").textContent = dels.length;
    fillChangeList($("#new-list"), news);
    fillChangeList($("#del-list"), dels);
  }

  /* re-render everything that depends on the current year scope */
  function refresh() {
    state.page = 1;
    const rec = scoped();
    renderTiles(rec);
    renderMajor(rec);
    renderGrade(rec);
    renderSub(rec);
    renderTable();
    renderDeleted();
    renderChanges();
    // year filter 옆 요약: 전체 · S(최우수) · A(우수) 학회 수
    const sN = count(rec, (r) => r.grade === "S");
    const aN = count(rec, (r) => r.grade === "A");
    const mN = count(rec, isMisc);
    $("#year-summary").innerHTML =
      T.summaryConf(rec.length) +
      `<i class="ys-dot" style="background:${color("--grade-s")}"></i>S <b>${sN}</b> ` +
      `<i class="ys-dot" style="background:${color("--grade-a")}"></i>A <b>${aN}</b> ` +
      `<i class="ys-dot" style="background:${color("--grade-m")}"></i>${T.mShort} <b>${mN}</b>`;
    // 헤더: KIISE 지정(S+A) 학회 수 + 기타(참고용) 학회 수
    $("#tag-count").textContent = sN + aN;
    $("#tag-misc").textContent = mN ? T.tagMisc(mN) : "";
    $("#tag-year").textContent =
      state.year === "ALL"
        ? (years.length > 1 ? T.yearRange(years[0], years[years.length - 1]) : T.yearOpt(years[0]))
        : T.yearOpt(state.year);
  }

  /* ---------------- theme toggle ---------------- */
  function initTheme() {
    const btn = $("#theme-toggle");
    const saved = localStorage.getItem("kiise-theme");
    if (saved) document.documentElement.setAttribute("data-theme", saved);
    btn.onclick = () => {
      const cur = document.documentElement.getAttribute("data-theme");
      const isDark = cur ? cur === "dark"
        : matchMedia("(prefers-color-scheme: dark)").matches;
      const next = isDark ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("kiise-theme", next);
      const rec = scoped();
      renderMajor(rec); renderGrade(rec); renderSub(rec); // color-dependent
    };
  }

  /* clicking a conference name opens the Google search side panel */
  function initConfSearch() {
    $("#conf-tbody").addEventListener("click", (e) => {
      const link = e.target.closest("a.conf-link");
      if (!link) return;
      e.preventDefault();
      openConfSearch(link.dataset.q, link.textContent);
    });
    $("#search-panel-close").onclick = closeConfSearch;
    $("#search-backdrop").onclick = closeConfSearch;
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("#search-panel").hidden) closeConfSearch();
    });
  }

  /* ---------------- paper submission deadline calendar ---------------- */
  function initCalendar() {
    const grid = $("#cal-grid");
    const dl = window.KIISE_DEADLINES;
    if (!grid || !dl || !dl.items) { $("#deadline-card").hidden = true; return; }
    let drawUpcoming = null; // set below once the upcoming list is wired up

    // abbr -> record (prefer the latest survey year) for full names in tooltips.
    // 기타(misc) 마감 항목은 기타 학회 레코드와 따로 매칭한다.
    const byAbbr = new Map(), miscByAbbr = new Map();
    for (let i = years.length - 1; i >= 0; i--) {
      allRecords.forEach((r) => {
        const m = isMisc(r) ? miscByAbbr : byAbbr;
        if (r.year === years[i] && !m.has(r.abbr)) m.set(r.abbr, r);
      });
    }
    const recOf = (it) => (it.cat === "misc" ? miscByAbbr : byAbbr).get(it.abbr);
    // 캘린더 분류 필터: 전체 / S / A / 기타
    const catOf = (it) => (it.cat === "misc" ? "M" : (recOf(it) || {}).grade || "");
    let calCat = "ALL";
    const visible = (it) => calCat === "ALL" || catOf(it) === calCat;

    // group deadline items by date string
    const byDate = new Map();
    dl.items.forEach((it) => {
      if (!byDate.has(it.date)) byDate.set(it.date, []);
      byDate.get(it.date).push(it);
    });

    const cf = $("#cal-filter");
    if (cf) {
      [["ALL", T.all], ["S", T.sChip], ["A", T.aChip], ["M", T.mChip]].forEach(([v, label]) => {
        const b = el("button", "chip", label);
        b.type = "button";
        b.dataset.val = v;
        b.setAttribute("aria-pressed", v === "ALL");
        b.onclick = () => {
          calCat = v; setPressed(cf, v);
          render();
          if (drawUpcoming) drawUpcoming();
        };
        cf.appendChild(b);
      });
    }

    // stable per-conference chip color
    const PALETTE = ["#1a73e8", "#0b8457", "#8e24aa", "#e53935", "#f4511e", "#00897b",
                     "#3949ab", "#d81b60", "#6d4c41", "#546e7a", "#689f38", "#5e35b1"];
    const chipColor = (abbr) => {
      let h = 0;
      for (const c of abbr) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      return PALETTE[h % PALETTE.length];
    };

    const pad = (n) => String(n).padStart(2, "0");
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    let cur = new Date(); cur.setDate(1);

    function render() {
      $("#cal-title").textContent = T.calTitle(cur.getFullYear(), cur.getMonth() + 1);
      grid.innerHTML = "";
      const firstDow = cur.getDay();
      const daysInMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
      const cells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
      const todayStr = fmt(new Date());
      for (let i = 0; i < cells; i++) {
        const d = new Date(cur.getFullYear(), cur.getMonth(), 1 - firstDow + i);
        const ds = fmt(d);
        const cell = el("div", "cal-cell"
          + (d.getMonth() !== cur.getMonth() ? " out" : "")
          + (ds === todayStr ? " today" : "")
          + (i % 7 === 0 ? " sun" : ""));
        cell.appendChild(el("span", "cal-day", String(d.getDate())));
        (byDate.get(ds) || []).filter(visible).forEach((it) => {
          const kindL = T.kind(it.kind);
          const misc = it.cat === "misc";
          const btn = el("button", "cal-chip" + (misc ? " misc" : ""), `${it.abbr} ${it.edition} ${kindL}`);
          if (!misc) btn.style.background = chipColor(it.abbr);
          const rec = recOf(it);
          btn.title = (misc ? T.miscPrefix : "") + T.chipTitle(it.abbr, it.edition, kindL, ds,
            it.note ? T.note(it.note) : "", rec ? rec.name : "");
          btn.onclick = () => {
            const q = encodeURIComponent(`${rec ? rec.name : it.abbr} ${it.edition} call for papers deadline`)
              .replace(/'/g, "%27").replace(/"/g, "%22");
            openConfSearch(q, T.panelTitle(it.abbr, it.edition, kindL));
          };
          cell.appendChild(btn);
        });
        grid.appendChild(cell);
      }
    }

    $("#cal-prev").onclick = () => { cur.setMonth(cur.getMonth() - 1); render(); };
    $("#cal-next").onclick = () => { cur.setMonth(cur.getMonth() + 1); render(); };
    $("#cal-today").onclick = () => { cur = new Date(); cur.setDate(1); render(); };
    render();

    /* -------- upcoming deadlines list below the calendar -------- */
    const upList = $("#upcoming-list");
    if (upList) {
      const LIMIT = 12;
      const todayStr = fmt(new Date());
      const allUpcoming = dl.items
        .filter((it) => it.date >= todayStr)
        .sort((a, b) => a.date.localeCompare(b.date) || a.abbr.localeCompare(b.abbr));
      const moreBtn = $("#upcoming-more");
      let expanded = false;

      function searchFor(it) {
        const rec = recOf(it);
        const q = encodeURIComponent(`${rec ? rec.name : it.abbr} ${it.edition} call for papers deadline`)
          .replace(/'/g, "%27").replace(/"/g, "%22");
        openConfSearch(q, T.panelTitle(it.abbr, it.edition, T.kind(it.kind)));
      }

      drawUpcoming = function () {
        upList.innerHTML = "";
        const upcoming = allUpcoming.filter(visible);
        const base = new Date(); base.setHours(0, 0, 0, 0);
        upcoming.slice(0, expanded ? upcoming.length : LIMIT).forEach((it) => {
          const d = new Date(it.date + "T00:00:00");
          const dday = Math.round((d - base) / 86400000);
          const rec = recOf(it);
          const misc = it.cat === "misc";
          const li = el("li", "up-item" + (misc ? " misc" : ""));
          if (!misc) li.style.borderLeftColor = chipColor(it.abbr);
          li.innerHTML =
            `<div class="up-dday${dday <= 7 ? " near" : ""}">` +
              `${dday === 0 ? "D-Day" : "D-" + dday}` +
              `<span class="up-date">${it.date.replace(/-/g, ".")} (${T.dow[d.getDay()]})</span>` +
            `</div>` +
            `<div class="up-body">` +
              `<div class="up-title"><b>${it.abbr} ${it.edition}</b>` +
                (rec ? `<span class="up-badge">${rec.subName}</span>` +
                       `<span class="pill grade-${rec.grade.toLowerCase()}">${T.upGrade(rec.grade)}</span>` +
                       `<span class="pill ${rec.major.toLowerCase()}">${rec.major}</span>` : "") +
                `<span class="up-badge est">${T.estBadge}</span>` +
              `</div>` +
              `<p class="up-kind">${T.kindLine(T.kind(it.kind), it.note ? T.note(it.note) : "")}</p>` +
              (rec ? `<p class="up-name">${rec.name}</p>` : "") +
            `</div>`;
          li.title = T.upClickTitle;
          li.onclick = () => searchFor(it);
          upList.appendChild(li);
        });
        if (!upcoming.length) upList.appendChild(el("li", "empty", T.none));
        moreBtn.hidden = upcoming.length <= LIMIT;
        moreBtn.textContent = expanded ? T.collapse : T.more(upcoming.length - LIMIT);
      };
      moreBtn.onclick = () => { expanded = !expanded; drawUpcoming(); };
      drawUpcoming();
    }
  }

  /* ---------------- 개최지별(한국/일본) 학회 현황 (view-korea) ---------------- */
  function initKorea() {
    const kr = window.KIISE_KOREA;
    const body = $("#korea-body");
    if (!body) return;
    if (!kr || !kr.items || !kr.items.length) {
      $("#korea-empty").hidden = false;
      return;
    }
    const special = new Set(kr.specialWatch || []);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayISO = today.getFullYear() + "-" +
      String(today.getMonth() + 1).padStart(2, "0") + "-" +
      String(today.getDate()).padStart(2, "0");
    const fmtDot = (iso) => iso.replace(/-/g, ".");
    const FLAG = { KR: "🇰🇷", JP: "🇯🇵" };
    const countryOf = (it) => it.country || "KR"; // 이전 데이터 호환

    // 특별 관리 대상(빨간색) 학회 안내 — 두 나라 공통
    $("#korea-special-note").innerHTML =
      `<span class="kr-note-label">${T.krSpecialLabel}</span>` +
      [...special].map((a) => {
        const hosted = kr.items.some((it) => it.abbr === a);
        return `<span class="kr-special-chip${hosted ? " hosted" : ""}">${a}</span>`;
      }).join("");

    function deadlineCell(it) {
      return (it.deadlines || []).map((d) => {
        const dd = new Date(d.date + "T00:00:00");
        const diff = Math.round((dd - today) / 86400000);
        const badge = diff < 0
          ? `<span class="kr-dday past">${T.krClosed}</span>`
          : `<span class="kr-dday${diff <= 30 ? " near" : ""}">${diff === 0 ? "D-Day" : "D-" + diff}</span>`;
        const note = d.note ? ` <span class="muted">(${T.note(d.note)})</span>` : "";
        return `<div class="kr-dl">${badge}<span class="kr-dl-date">${fmtDot(d.date)}</span> ` +
               `<span class="kr-dl-kind">${T.kind(d.kind)}</span>${note}</div>`;
      }).join("") || `<span class="muted">${T.krTBA}</span>`;
    }

    function renderRows(tbody, items, flag) {
      items.forEach((it) => {
        const rec = dlByAbbr.get(it.abbr);
        const isSp = special.has(it.abbr);
        const ended = it.end && it.end < todayISO;
        const tr = document.createElement("tr");
        tr.className = (isSp ? "kr-special" : "") + (ended ? " kr-ended" : "");
        const pills = rec
          ? ` <span class="pill grade-${rec.grade.toLowerCase()}">${rec.grade}</span>` +
            `<span class="pill ${rec.major.toLowerCase()}">${rec.major}</span>`
          : "";
        const star = isSp ? `<span class="kr-star" title="${T.krSpecialTitle}">★</span> ` : "";
        // 자동 감지·미확정 항목 표시 (주간 스캔이 채운 후보)
        const review = it.needsReview
          ? ` <span class="kr-review" title="${T.krReviewTitle}">${T.krReview}</span>` : "";
        const place = (LANG === "en" ? (it.cityEn || it.city) : it.city) +
          (it.venue ? ` · ${it.venue}` : "");
        const dateCell = (it.start && it.end)
          ? `${fmtDot(it.start)} ~ ${fmtDot(it.end)}` +
            (ended ? ` <span class="kr-dday past">${T.krEnded}</span>` : "")
          : `<span class="muted">${T.krTBA}</span>`;
        tr.innerHTML =
          `<td class="kr-name-cell">${star}<b class="kr-abbr">${it.abbr} ${it.edition}</b>${pills}${review}` +
          `<div class="kr-fullname">${it.name}</div></td>` +
          `<td class="kr-dl-cell">${deadlineCell(it)}</td>` +
          `<td class="kr-place">${flag} ${place}</td>` +
          `<td class="kr-dates">${dateCell}</td>` +
          `<td><a class="kr-site" href="${it.site}" target="_blank" rel="noopener">${T.krSiteLink}</a></td>`;
        tbody.appendChild(tr);
      });
    }

    // 나라별 섹션(한국 → 일본), 각 섹션은 연도별 표로 구성
    function renderCountry(country) {
      const cItems = kr.items.filter((it) => countryOf(it) === country);
      const sec = el("section", "kr-country");
      sec.appendChild(el("h3", "kr-country-heading",
        `${FLAG[country]} ${T.krCountry(country)} <span class="changes-badge">${cItems.length}</span>`));
      if (!cItems.length) {
        sec.appendChild(el("p", "kr-country-empty muted", T.krCountryEmpty(country)));
        body.appendChild(sec);
        return;
      }
      const years = [...new Set(cItems.map((it) => it.year))].sort();
      years.forEach((y) => {
        const items = cItems.filter((it) => it.year === y)
          .sort((a, b) => (a.start || "").localeCompare(b.start || "") || a.abbr.localeCompare(b.abbr));
        sec.appendChild(el("h4", "kr-year-heading",
          `${T.yearOpt(y)} <span class="changes-badge">${items.length}</span>`));
        const scroll = el("div", "table-scroll");
        const table = el("table", "kr-table",
          `<thead><tr>` +
          `<th>${T.krColName}</th><th>${T.krColDeadline}</th><th>${T.krColPlace}</th>` +
          `<th>${T.krColSchedule}</th><th>${T.krColSite}</th>` +
          `</tr></thead>`);
        const tbody = document.createElement("tbody");
        renderRows(tbody, items, FLAG[country]);
        table.appendChild(tbody);
        scroll.appendChild(table);
        sec.appendChild(scroll);
      });
      body.appendChild(sec);
    }

    body.innerHTML = "";
    renderCountry("KR");
    renderCountry("JP");

    body.appendChild(el("p", "kr-updated muted",
      T.krUpdated(fmtDot(kr.updated || ""))));
  }

  /* ---------------- view menu (대시보드 / 한국 개최 / 달력 / 목록) ---------------- */
  function initViews() {
    const tabs = document.querySelectorAll(".view-tabs button");
    const views = {
      dashboard: $("#view-dashboard"),
      korea: $("#view-korea"),
      calendar: $("#view-calendar"),
      list: $("#view-list"),
    };
    function show(name) {
      if (!views[name]) name = "dashboard";
      Object.entries(views).forEach(([k, v]) => { v.hidden = k !== name; });
      tabs.forEach((b) => b.classList.toggle("active", b.dataset.view === name));
      history.replaceState(null, "", "#" + name);
    }
    tabs.forEach((b) => { b.onclick = () => show(b.dataset.view); });
    window.addEventListener("hashchange", () => show(location.hash.slice(1)));
    show(location.hash.slice(1) || "dashboard");
  }

  /* ---------------- apply language to static markup ---------------- */
  function applyLang() {
    document.documentElement.lang = LANG;
    const btn = $("#lang-toggle");
    if (btn) {
      btn.textContent = LANG === "ko" ? "EN" : "한국어";
      btn.onclick = () => {
        localStorage.setItem("kiise-lang", LANG === "ko" ? "en" : "ko");
        location.reload();
      };
    }
    if (T.static) {
      document.title = T.docTitle;
      Object.entries(T.static).forEach(([sel, html]) => {
        document.querySelectorAll(sel).forEach((n) => { n.innerHTML = html; });
      });
    }
    $("#search").placeholder = T.searchPh;
  }

  /* ---------------- monthly deadline column chart (design ported from conference_field) ---------------- */
  const _today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  function monthKeys12() {
    const t = _today0(), out = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(t.getFullYear(), t.getMonth() + i, 1);
      out.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
                 year: d.getFullYear(), month: d.getMonth() + 1 });
    }
    return out;
  }
  function niceScale(max) {
    if (max <= 0) return { max: 1, step: 1 };
    const raw = max / 5, pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) * pow;
    return { max: Math.ceil(max / step) * step, step };
  }
  const fmtNum = (n) => Number(n).toLocaleString(LANG === "en" ? "en-US" : "ko-KR");
  const tipHTML = (lines) => lines.map((ln) => ln.value == null
    ? `<b>${ln.label}</b>`
    : `<div class="tt-line">${ln.swatch ? `<i class="tt-dot" style="background:${ln.swatch}"></i>` : ""}` +
      `<b>${ln.value}</b> <span class="tt-sub">${ln.label}</span></div>`).join("");
  const attachTip = (mark, linesFn) => bindTip(mark, () => tipHTML(linesFn()));

  function columnChart(container, items) {
    const scale = niceScale(Math.max(...items.map((i) => i.value), 1));
    container.innerHTML = "";
    const plot = el("div", "cc-plot");
    for (let v = 0; v <= scale.max; v += scale.step) {
      const line = el("div", "cc-gridline" + (v === 0 ? " baseline" : ""));
      line.style.bottom = (v / scale.max) * 100 + "%";
      plot.appendChild(line);
      const tick = el("span", "cc-tick", fmtNum(v));
      tick.style.bottom = (v / scale.max) * 100 + "%";
      plot.appendChild(tick);
    }
    const cols = el("div", "cc-cols");
    const maxVal = Math.max(...items.map((i) => i.value));
    items.forEach((item) => {
      const slot = el("div", "cc-slot");
      if (item.value === maxVal && item.value > 0)
        slot.appendChild(el("span", "cc-cap", fmtNum(item.value)));
      const col = el("button", "cc-col" + (item.value === 0 ? " zero" : "") + (item.selected ? " selected" : ""));
      col.type = "button";
      col.style.height = Math.max((item.value / scale.max) * 100, item.value > 0 ? 1 : 0) + "%";
      col.setAttribute("aria-label", item.aria);
      if (item.onClick) col.addEventListener("click", item.onClick);
      attachTip(col, item.tipLines);
      if (item.segments && item.value > 0) {
        col.classList.add("stacked");
        item.segments.forEach((seg) => {
          if (!seg.value) return;
          const s = el("div", "cc-seg " + (seg.cls || ""));
          s.style.flexGrow = seg.value;
          col.appendChild(s);
        });
      }
      slot.appendChild(col); cols.appendChild(slot);
    });
    plot.appendChild(cols); container.appendChild(plot);
    const xl = el("div", "cc-xlabels" + (items.length > 8 ? " dense" : ""));
    items.forEach((item) => {
      const lab = el("span", "cc-xlabel");
      lab.appendChild(el("span", null, item.label));
      if (item.sub) lab.appendChild(el("span", "cc-xsub", item.sub));
      xl.appendChild(lab);
    });
    container.appendChild(xl);
  }

  // abbr -> record (latest survey year) for full names in the month detail
  const dlByAbbr = new Map();
  for (let i = years.length - 1; i >= 0; i--)
    allRecords.forEach((r) => {
      if (r.year === years[i] && !isMisc(r) && !dlByAbbr.has(r.abbr)) dlByAbbr.set(r.abbr, r);
    });
  // 대시보드 월별 차트는 KIISE 지정(S/A) 학회 마감만 집계 — 기타(참고용)는 달력 화면에서만 표시
  const kiiseDeadlines = () =>
    ((window.KIISE_DEADLINES && window.KIISE_DEADLINES.items) || []).filter((it) => it.cat !== "misc");

  function monthStats() {
    const items = kiiseDeadlines();
    const by = {};
    items.forEach((it) => {
      const k = it.date.slice(0, 7);
      const m = by[k] || (by[k] = { n: 0, paper: 0, abstract: 0, other: 0, confs: new Set() });
      m.n++;
      m[it.kind === "논문" ? "paper" : it.kind === "초록" ? "abstract" : "other"]++;
      m.confs.add(it.abbr);
    });
    return monthKeys12().map((mk) => {
      const m = by[mk.key] || { n: 0, paper: 0, abstract: 0, other: 0, confs: new Set() };
      return { ...mk, count: m.n, paper: m.paper, abstract: m.abstract, other: m.other, confCount: m.confs.size };
    });
  }

  function renderMonthDetail(stats) {
    const sel = stats.find((s) => s.key === state.dashMonth) || stats[0];
    $("#month-detail-heading").textContent = T.mcDetail(sel.year, T.month[sel.month - 1], sel.count);
    const box = $("#month-detail"); box.innerHTML = "";
    const items = kiiseDeadlines()
      .filter((it) => it.date.slice(0, 7) === sel.key)
      .sort((a, b) => a.date.localeCompare(b.date) || a.abbr.localeCompare(b.abbr));
    if (!items.length) { box.appendChild(el("p", "empty", T.none)); return; }
    items.forEach((it) => {
      const rec = dlByAbbr.get(it.abbr), kindL = T.kind(it.kind);
      const item = el("button", "month-item");
      item.type = "button";
      item.innerHTML =
        `<span class="mi-date">${it.date.slice(5).replace("-", ".")}</span>` +
        `<span class="mi-abbr">${it.abbr}</span>` +
        `<span class="mi-name">${rec ? rec.name : it.abbr}</span>` +
        `<span class="mi-kind">${kindL} ${T.deadlineWord}</span>`;
      item.onclick = () => {
        const q = encodeURIComponent(`${rec ? rec.name : it.abbr} ${it.edition} call for papers deadline`)
          .replace(/'/g, "%27").replace(/"/g, "%22");
        openConfSearch(q, T.panelTitle(it.abbr, it.edition, kindL));
      };
      box.appendChild(item);
    });
  }

  function renderMonthChart() {
    const host = $("#month-chart");
    if (!host) return;
    if (!window.KIISE_DEADLINES) { const c = $("#month-card"); if (c) c.hidden = true; return; }
    const stats = monthStats();
    if (!state.dashMonth || !stats.some((s) => s.key === state.dashMonth)) state.dashMonth = stats[0].key;
    columnChart(host, stats.map((s, i) => {
      const ml = T.month[s.month - 1];
      return {
        label: ml,
        sub: (i === 0 || s.month === 1) ? String(s.year) : undefined,
        value: s.count,
        selected: s.key === state.dashMonth,
        aria: T.mcAria(s.year, ml, s.paper, s.abstract, s.confCount),
        onClick: () => { state.dashMonth = s.key; renderMonthChart(); },
        segments: [
          { value: s.paper, cls: "cc-seg-paper" },
          { value: s.abstract, cls: "cc-seg-abstract" },
          { value: s.other, cls: "cc-seg-other" },
        ],
        tipLines: () => [
          { label: T.calTitle(s.year, s.month) },
          { value: T.mcCase(s.paper), label: T.mcPaper, swatch: color("--cs") },
          { value: T.mcCase(s.abstract), label: T.mcAbstract, swatch: color("--chart-2") },
          { value: fmtNum(s.confCount), label: T.donutUnit },
        ],
      };
    }));
    $("#legend-month").innerHTML =
      `<span><i style="background:${color("--cs")}"></i> ${T.mcPaper}</span>` +
      `<span><i style="background:${color("--chart-2")}"></i> ${T.mcAbstract}</span>`;
    renderMonthDetail(stats);
  }

  /* ---------------- boot ---------------- */
  applyLang();
  buildFilters();
  initConfSearch();
  initCalendar();
  initKorea();
  initViews();
  refresh();
  renderMonthChart();
  initTheme();
})();
