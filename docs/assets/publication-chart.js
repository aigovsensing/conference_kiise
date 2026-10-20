/* Interactive publication heatmap and ranking chart. */
(function () {
  "use strict";

  const data = window.KIISE_PUBLICATIONS;
  const yearSelect = document.querySelector("#publication-year");
  const fieldSelect = document.querySelector("#publication-field");
  if (!data || !yearSelect || !fieldSelect) return;

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const format = new Intl.NumberFormat("ko-KR");
  const fieldNames = (window.KIISE_DATA && window.KIISE_DATA.subfieldNames) || {};
  const fieldLabel = (field) => fieldNames[field] ? `${field} · ${fieldNames[field]}` : field;
  const fields = [...new Set(data.records.map((record) => record.field))].sort();

  const source = document.querySelector("#publication-source");
  source.append("출처: ");
  const sourceLink = make("a", "", data.source || "DBLP Computer Science Bibliography");
  sourceLink.href = data.sourceUrl || "https://dblp.org/";
  sourceLink.target = "_blank";
  sourceLink.rel = "noopener";
  source.append(sourceLink, ` · DBLP 학회 스트림에 등재된 레코드 수 · 수집일 ${data.retrieved || "-"}`);

  [...data.years].reverse().forEach((year) => {
    const option = make("option", "", `${year}년`);
    option.value = year;
    yearSelect.appendChild(option);
  });
  ["전체", ...fields].forEach((field) => {
    const option = make("option", "", field === "전체" ? field : fieldLabel(field));
    option.value = field;
    fieldSelect.appendChild(option);
  });
  const requestedField = new URLSearchParams(window.location.search).get("publication-field");
  if (fields.includes(requestedField)) fieldSelect.value = requestedField;

  function selectedRecords() {
    return fieldSelect.value === "전체"
      ? data.records
      : data.records.filter((record) => record.field === fieldSelect.value);
  }

  function renderStats(records, yearIndex) {
    const current = records.reduce((sum, record) => sum + record.counts[yearIndex], 0);
    const previous = yearIndex > 0
      ? records.reduce((sum, record) => sum + record.counts[yearIndex - 1], 0)
      : null;
    const leader = [...records].sort((a, b) => b.counts[yearIndex] - a.counts[yearIndex])[0];
    const growth = previous ? ((current - previous) / previous) * 100 : null;
    const stats = document.querySelector("#publication-stats");
    stats.replaceChildren();
    [
      ["▤", "총 논문 수", format.format(current)],
      ["♛", "최다 학회", leader ? leader.abbr : "-"],
      ["↗", "전년 대비", growth === null ? "비교 불가" : `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%`]
    ].forEach(([icon, label, value], index) => {
      const card = make("div", "publication-stat");
      card.append(make("span", "publication-stat-icon", icon));
      const copy = make("div");
      copy.append(make("span", "publication-stat-label", label));
      copy.append(make("strong", index === 2 && growth >= 0 ? "positive" : "", value));
      card.append(copy);
      stats.append(card);
    });
  }

  function renderHeatmap(records, selectedField) {
    const host = document.querySelector("#publication-heatmap");
    host.replaceChildren();
    const values = records.flatMap((record) => record.counts);
    const max = Math.max(...values, 1);
    const grid = make("div", "heat-grid");
    grid.style.setProperty("--heat-years", data.years.length);
    grid.append(make("span", "heat-corner", "학회"));
    data.years.forEach((year) => grid.append(make("b", "heat-year", year)));
    records.forEach((record) => {
      const label = make("span", "heat-label", record.abbr);
      if (selectedField !== "전체" && record.field === selectedField) label.classList.add("selected");
      grid.append(label);
      record.counts.forEach((value, index) => {
        const cell = make("span", "heat-cell", value);
        const ratio = value / max;
        cell.style.setProperty("--heat-alpha", (0.12 + ratio * 0.88).toFixed(2));
        cell.classList.toggle("heat-cell-dark", ratio > 0.55);
        if (selectedField !== "전체" && record.field === selectedField) cell.classList.add("selected");
        cell.title = `${record.abbr} · ${data.years[index]}년: ${format.format(value)}편`;
        grid.append(cell);
      });
    });
    host.append(grid);
  }

  function renderBars(records, yearIndex, selectedField) {
    const year = data.years[yearIndex];
    const emphasis = selectedField === "전체" ? "" : ` · ${selectedField} 강조`;
    document.querySelector("#publication-rank-title").textContent = `${year}년 전체 분야 상위 10개 학회 (논문수 기준)${emphasis}`;
    const host = document.querySelector("#publication-bars");
    host.replaceChildren();
    const ranked = [...records]
      .sort((a, b) => b.counts[yearIndex] - a.counts[yearIndex])
      .slice(0, 10);
    const max = Math.max(...ranked.map((record) => record.counts[yearIndex]), 1);
    ranked.forEach((record, index) => {
      const value = record.counts[yearIndex];
      const row = make("div", "publication-bar-row");
      row.append(make("span", "publication-bar-label", record.abbr));
      const track = make("div", "publication-bar-track");
      const bar = make("span", `publication-bar-fill rank-${index + 1}`);
      if (selectedField !== "전체" && record.field === selectedField) bar.classList.add("selected");
      bar.style.width = `${(value / max) * 100}%`;
      bar.title = `${record.abbr}: ${format.format(value)}편`;
      track.append(bar);
      row.append(track, make("strong", "publication-bar-value", format.format(value)));
      host.append(row);
    });
  }

  function render() {
    const yearIndex = data.years.indexOf(Number(yearSelect.value));
    const records = selectedRecords();
    renderStats(records, yearIndex);
    document.querySelector("#publication-heat-title").textContent = fieldSelect.value === "전체"
      ? "학회별 연도 추이"
      : `학회별 연도 추이 · ${fieldLabel(fieldSelect.value)} 강조`;
    renderHeatmap(data.records, fieldSelect.value);
    renderBars(data.records, yearIndex, fieldSelect.value);
  }

  yearSelect.addEventListener("change", render);
  fieldSelect.addEventListener("change", render);
  render();
}());
