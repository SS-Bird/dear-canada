// Place mentions over time — the v1 place explorer, rebuilt on the Leaflet basemap.
// Reads the dataset with project "places" and role "mentions" (place_mentions.csv).
import { esc, fold, parseDate, html, cssVar } from "../util.js";
import { fetchDataset } from "../data.js";
import { bookTitle } from "../books.js";

const BASE_DURATION = 40; // seconds for a full pass at 1×
const TOPN = 30;
const OUTLIER_YEARS = 25; // dates this far from a book's median date are left off the timeline (likely back matter)
const fmtDay = d3.utcFormat("%-d %b %Y");

export function mount({ map, stage, panel, manifest }) {
  let alive = true;
  let rows = [], bookCodes = [], bookColor = {}, bookMin = {};
  let hidden = new Set(), mode = "calendar", hoverBook = null, query = "";
  let locGroups = [], unlGroups = [], lo = 0, hi = 1, frac = 1, curT = 1;
  let selected = null, selSig = "", showingUnl = false, unlSig = "", detailKey = null;
  let playing = false, lastTs = 0;
  const colors = { ring: cssVar("--panel") || "#fff", ink: cssVar("--ink") || "#1c1c1a", accent: cssVar("--accent") || "#3c5a6e" };

  const renderer = L.canvas({ padding: 0.3 });
  const layer = L.layerGroup().addTo(map);

  // ───────────── UI
  const ctl = html(`<div class="ctl panel">
    <div class="ctlHead"><h1>Place mentions</h1><button class="mini" data-k="collapse" aria-label="Collapse panel">–</button></div>
    <div class="ctlBody">
      <input type="text" data-k="search" placeholder="Find a place…" aria-label="Find a place">
      <div class="legendHead"><h2>Books</h2><span><button class="mini" data-k="all">All</button> <button class="mini" data-k="none">None</button></span></div>
      <div data-k="books"></div>
      <h2 style="margin-top:14px">Time axis</h2>
      <label class="chip"><input type="radio" name="plMode" value="calendar" checked><span class="label">Calendar date</span></label>
      <label class="chip"><input type="radio" name="plMode" value="aligned"><span class="label">Aligned at book start</span></label>
      <div class="note" data-k="modeNote">Mentions accumulate from the earliest date among the selected books.</div>
      <h2 style="margin-top:14px">Without a location</h2>
      <button data-k="unl" style="width:100%">Show unlocated places</button>
      <h2 style="margin-top:14px">Reading the map</h2>
      <div class="note" style="margin-top:0">One dot per book and place. Dot area grows with the number of mentions so far. A dark ring marks a place mentioned in the last stretch of the timeline.</div>
    </div>
    <div class="status" data-k="status">Loading place_mentions…</div>
  </div>`);
  const tl = html(`<div class="timeline panel">
    <button data-k="play" aria-label="Play or pause">▶ Play</button>
    <select data-k="speed" aria-label="Playback speed">
      <option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option>
    </select>
    <input type="range" data-k="slider" min="0" max="1000" value="1000" step="1" aria-label="Timeline position">
    <span class="tlLabel" data-k="label">—</span>
  </div>`);
  stage.append(ctl, tl);
  const q = k => stage.querySelector(`[data-k="${k}"]`);

  q("collapse").onclick = () => { const c = ctl.classList.toggle("collapsed"); q("collapse").textContent = c ? "+" : "–"; };
  q("all").onclick = () => rows.length && setAllBooks(true);
  q("none").onclick = () => rows.length && setAllBooks(false);
  q("search").oninput = e => { query = fold(e.target.value); update(); };
  q("unl").onclick = () => { selected = null; showingUnl = true; unlSig = ""; openUnl(); update(); };
  q("slider").oninput = e => { stopPlay(); setFrac(+e.target.value / 1000); };
  q("play").onclick = togglePlay;
  ctl.querySelectorAll("input[name=plMode]").forEach(el => el.onchange = () => {
    mode = el.value; frac = 1; rebuild();
    q("modeNote").textContent = mode === "calendar"
      ? "Mentions accumulate from the earliest date among the selected books."
      : "Each book starts at day 0, its first dated entry, so books play in parallel.";
  });
  panel.onClose = () => { selected = null; showingUnl = false; selSig = ""; update(); };

  // ───────────── load
  const ds = manifest.datasets.find(d => d.project === "places" && d.role === "mentions");
  if (!ds) q("status").textContent = "No places dataset with role “mentions” in data_sources.json.";
  else fetchDataset(ds).then(records => {
    if (!alive) return;
    load(records.map(r => ({
      book: r.book, entry_id: r.entry_id, chapter_id: r.chapter_id, date: r.date,
      place: r.place, ner_label: r.ner_label, resolution_status: r.resolution_status,
      matched_name: r.matched_name, region_historical: r.region_historical, region_modern: r.region_modern,
      country: r.country, historicity: /^true$/i.test((r.historicity || "").trim()),
      lat: parseFloat(r.latitude), lon: parseFloat(r.longitude),
    })));
  }).catch(e => { if (alive) q("status").textContent = e.message; });

  function load(data) {
    rows = data;
    rows.forEach(r => { r.ms = parseDate(r.date); r.located = r.historicity && isFinite(r.lat) && isFinite(r.lon); });
    const median = d3.rollup(rows.filter(r => r.ms != null), v => d3.median(v, r => r.ms), r => r.book);
    let outliers = 0;
    rows.forEach(r => { if (r.ms != null && Math.abs(r.ms - median.get(r.book)) > OUTLIER_YEARS * 365.25 * 864e5) { r.ms = null; r.outlier = true; outliers++; } });
    bookCodes = [...new Set(rows.map(r => r.book))].sort((a, b) => bookTitle(a).replace(/^(A|An|The) /, "").localeCompare(bookTitle(b).replace(/^(A|An|The) /, "")));
    bookCodes.forEach((b, i) => bookColor[b] = `hsl(${(i * 137.508 + 20) % 360}, 62%, 50%)`);
    rows.forEach(r => { if (r.ms != null && (bookMin[r.book] == null || r.ms < bookMin[r.book])) bookMin[r.book] = r.ms; });
    buildLegend();
    rebuild();
    const loc = rows.filter(r => r.located).length, undated = rows.filter(r => r.ms == null).length;
    q("status").textContent = `${rows.length.toLocaleString()} mentions · ${loc.toLocaleString()} located · ${(rows.length - loc).toLocaleString()} unlocated`
      + (undated > outliers ? ` · ${undated - outliers} undated` : "") + (outliers ? ` · ${outliers} with outlying dates (off the timeline)` : "");
  }

  function buildLegend() {
    const counts = d3.rollup(rows, v => v.length, r => r.book);
    const list = d3.select(q("books")); list.selectAll("*").remove();
    bookCodes.forEach(b => {
      const row = list.append("label").attr("class", "chip").attr("title", `${bookTitle(b)} (${b})`);
      row.append("input").attr("type", "checkbox").property("checked", !hidden.has(b))
        .on("change", function () { this.checked ? hidden.delete(b) : hidden.add(b); frac = 1; rebuild(); });
      row.append("span").attr("class", "dot").style("background", bookColor[b]);
      row.append("span").attr("class", "label").text(bookTitle(b));
      row.append("span").attr("class", "count").text(counts.get(b));
      row.on("mouseenter", () => { hoverBook = b; update(); }).on("mouseleave", () => { hoverBook = null; update(); });
    });
  }
  function setAllBooks(on) { hidden = on ? new Set() : new Set(bookCodes); buildLegend(); frac = 1; rebuild(); }

  // ───────────── group mentions for the current selection
  function rebuild() {
    rows.forEach(r => { r.tv = r.ms == null ? null : (mode === "calendar" ? r.ms : (r.ms - bookMin[r.book]) / 86400000); });
    const vis = rows.filter(r => !hidden.has(r.book) && r.tv != null).sort((a, b) => a.tv - b.tv);
    lo = d3.min(vis, r => r.tv) ?? 0; hi = d3.max(vis, r => r.tv) ?? 1; if (hi <= lo) hi = lo + 1;

    const lm = new Map(), um = new Map();
    for (const r of vis) {
      if (r.located) {
        const k = r.book + "|" + r.lat.toFixed(4) + "," + r.lon.toFixed(4);
        let g = lm.get(k); if (!g) lm.set(k, g = { key: "L" + k, kind: "L", book: r.book, lat: r.lat, lon: r.lon, rows: [], times: [] });
        g.rows.push(r); g.times.push(r.tv);
      } else {
        const k = fold(r.place);
        let g = um.get(k); if (!g) um.set(k, g = { key: "U" + k, kind: "U", rows: [], byBook: new Map() });
        g.rows.push(r);
        if (!g.byBook.has(r.book)) g.byBook.set(r.book, []);
        g.byBook.get(r.book).push(r.tv);
      }
    }
    const topLabel = rs => d3.greatest(d3.rollups(rs, v => v.length, r => r.place), d => d[1])[0];
    locGroups = [...lm.values()]; unlGroups = [...um.values()];
    locGroups.forEach(g => { g.label = topLabel(g.rows); g.total = g.rows.length; });
    unlGroups.forEach(g => { g.label = topLabel(g.rows); g.total = g.rows.length; });
    locGroups.sort((a, b) => b.total - a.total); // big dots drawn first, small ones on top

    layer.clearLayers();
    for (const g of locGroups) {
      g.marker = L.circleMarker([g.lat, g.lon], { renderer, radius: 0, weight: 1, color: colors.ring, opacity: 0,
        fillColor: bookColor[g.book], fillOpacity: 0 })
        .bindTooltip(() => tipHtml(g), { direction: "top", offset: [0, -6], sticky: true })
        .on("click", e => { L.DomEvent.stop(e); select(g); })
        .addTo(layer);
      g.sig = "";
    }
    if (selected && !(selected.kind === "L" ? locGroups : unlGroups).some(g => g.key === selected.key)) { selected = null; panel.close(); }
    else if (selected) selected = (selected.kind === "L" ? locGroups : unlGroups).find(g => g.key === selected.key);
    selSig = ""; unlSig = "";
    setFrac(frac);
  }

  // ───────────── per-frame update
  function setFrac(f) {
    frac = f; curT = lo + (hi - lo) * f;
    q("slider").value = Math.round(f * 1000);
    q("label").textContent = !rows.length ? "—" : mode === "calendar" ? fmtDay(new Date(curT)) : `Day ${Math.floor(curT)} of ${Math.floor(hi)}`;
    update();
  }
  const dimLoc = g => (hoverBook && g.book !== hoverBook) || (query && !fold(g.label).includes(query));
  const countTo = (g, t) => g.times ? d3.bisectRight(g.times, t) : [...g.byBook.values()].reduce((s, a) => s + d3.bisectRight(a, t), 0);

  function update() {
    if (!rows.length || !alive) return;
    const win = (hi - lo) * 0.02, t = curT;
    for (const g of locGroups) {
      const n = d3.bisectRight(g.times, t); g.n = n;
      const r = n ? Math.min(26, 2.5 + 2.4 * Math.sqrt(n)) : 0;
      const recent = n && t - g.times[n - 1] <= win && t < hi;
      const dim = n && dimLoc(g), sel = selected === g;
      const sig = `${r}|${recent}|${dim}|${sel}`;
      if (sig === g.sig) continue;
      g.sig = sig;
      g.marker.setRadius(r);
      g.marker.setStyle(!n ? { opacity: 0, fillOpacity: 0 } : {
        opacity: dim ? 0.08 : 1, fillOpacity: dim ? 0.06 : recent ? 0.85 : 0.62,
        color: sel ? colors.accent : recent ? colors.ink : colors.ring, weight: sel ? 3 : recent ? 2 : 1,
      });
      if (sel) g.marker.bringToFront();
    }
    if (selected) {
      const sig = selected.key + ":" + countTo(selected, t);
      if (sig !== selSig) { selSig = sig; renderDetail(); }
    } else if (showingUnl) renderUnl(t);
  }

  // ───────────── tooltip + right-hand detail
  function tipHtml(g) {
    return `<b>${esc(g.label)}</b><div class="muted"><span class="dot" style="background:${bookColor[g.book]};margin-right:5px"></span>${esc(bookTitle(g.book))}</div>` +
      `<div class="muted">${g.n} of ${g.total} mentions so far</div>` + (g.rows[0].matched_name ? `<div class="muted">${esc(g.rows[0].matched_name)}</div>` : "");
  }

  function select(g) { selected = g; showingUnl = false; selSig = ""; update(); }

  function renderDetail() {
    const g = selected, t = curT, r0 = g.rows[0];
    const books = g.book ? [g.book] : [...g.byBook.keys()];
    const sub = (g.kind === "L" ? "located" : "no location") + " · " +
      books.map(b => `<span class="dot" style="background:${bookColor[b]}"></span> ${esc(bookTitle(b))}`).join(" &nbsp;");
    const props = [];
    if (g.kind === "L") {
      if (r0.matched_name) props.push(["matched to", r0.matched_name]);
      const rh = [...new Set(g.rows.map(r => r.region_historical).filter(Boolean))].join("; ");
      if (rh) props.push(["historical region", rh]);
      if (r0.region_modern) props.push(["modern region", r0.region_modern]);
      if (r0.country) props.push(["country", r0.country]);
      props.push(["coordinates", g.lat.toFixed(3) + ", " + g.lon.toFixed(3)]);
    } else {
      props.push(["status", [...new Set(g.rows.map(r => r.resolution_status).filter(Boolean))].join(", ") || "—"]);
    }
    props.push(["spelled", [...new Set(g.rows.map(r => r.place))].join(", ")]);
    props.push(["NER label", [...new Set(g.rows.map(r => r.ner_label).filter(Boolean))].join(", ")]);
    const upto = g.rows.filter(r => r.tv != null && r.tv <= t);
    const body = (g.kind === "U" ? `<div class="row click" data-back style="border:none;margin-top:8px">← All unlocated places</div>` : "") +
      props.map(([k, v]) => `<div class="prop"><b>${esc(k)}:</b> ${esc(v)}</div>`).join("") +
      `<h3>Mentions to date (${upto.length} of ${g.total})</h3>` +
      upto.slice(0, 120).map(r => `<div class="row">${esc(r.date || "no date")} · ${g.kind === "U" ? esc(bookTitle(r.book)) + " · " : ""}entry ${esc(r.entry_id)}` +
        `${g.kind === "U" && r.place !== g.label ? " · “" + esc(r.place) + "”" : ""}</div>`).join("") +
      (upto.length > 120 ? `<div class="muted" style="padding-top:4px">…and ${upto.length - 120} more</div>` : "");
    const el = html(`<div>${body}</div>`);
    el.querySelector("[data-back]")?.addEventListener("click", () => q("unl").click());
    if (panel.isOpen && detailKey === g.key) panel.update(el); else panel.open(g.label, sub, el);
    detailKey = g.key;
  }

  function openUnl() { detailKey = null; panel.open("Places without a location", "", "<div></div>"); renderUnl(curT); }

  function renderUnl(t) {
    const items = [];
    for (const g of unlGroups) {
      let tot = 0; const parts = [];
      for (const [b, a] of g.byBook) { const n = d3.bisectRight(a, t); if (n) { tot += n; parts.push([b, n]); } }
      if (tot && !(query && !fold(g.label).includes(query)) && !(hoverBook && !g.byBook.has(hoverBook))) items.push({ g, tot, parts });
    }
    items.sort((a, b) => b.tot - a.tot || a.g.label.localeCompare(b.g.label));
    const sig = items.slice(0, TOPN).map(i => i.g.key + i.parts.join()).join("|") + items.length;
    if (sig === unlSig) return;
    unlSig = sig;
    const max = items[0]?.tot || 1, total = items.reduce((s, i) => s + i.tot, 0);
    const el = html(`<div>
      <div class="muted" style="margin:10px 0 8px">Mentions to date where no real-world location was matched (<code>historicity</code> false). ${items.length} places · ${total} mentions. Bar colours are books.</div>
      ${items.slice(0, TOPN).map((it, i) => `<div class="brow" data-i="${i}" title="${esc(it.g.label)}">
        <div class="blabel">${esc(it.g.label)}</div>
        <div class="btrack"><div class="bfill" style="width:${it.tot / max * 100}%">${it.parts.map(([b, n]) =>
          `<span style="width:${n / it.tot * 100}%;background:${bookColor[b]}" title="${esc(bookTitle(b))}: ${n}"></span>`).join("")}</div></div>
        <div class="bcount">${it.tot}</div></div>`).join("") || '<div class="muted">None yet at this point in the timeline.</div>'}
      ${items.length > TOPN ? `<div class="muted" style="margin-top:6px">${items.length - TOPN} more places not shown</div>` : ""}
    </div>`);
    el.querySelectorAll(".brow").forEach(b => b.onclick = () => select(items[+b.dataset.i].g));
    panel.update(el);
  }

  // ───────────── playback
  function stopPlay() { playing = false; q("play").textContent = "▶ Play"; }
  function togglePlay() {
    if (!rows.length) return;
    if (playing) { stopPlay(); return; }
    playing = true; q("play").textContent = "⏸ Pause";
    if (frac >= 1) setFrac(0);
    lastTs = performance.now();
    requestAnimationFrame(function tick(ts) {
      if (!playing || !alive) return;
      const dt = (ts - lastTs) / 1000; lastTs = ts;
      const f = Math.min(1, frac + dt * (+q("speed").value) / BASE_DURATION);
      setFrac(f);
      if (f >= 1) stopPlay(); else requestAnimationFrame(tick);
    });
  }

  return () => { alive = false; playing = false; layer.remove(); };
}
