// Place mentions over time — the v1 place explorer, rebuilt on the Leaflet basemap.
// Reads the places datasets by role: "mentions" (place_mentions.csv), and optionally
// "boundaries" (HACOLP polygons), "world_boundaries" (Natural Earth), "region_aliases" and
// "region_polygons" (curated tables) and "corrections" (flags, see js/flags.js).
// Mentions of a Canadian province, colony or territory fill its polygon as it was at the
// mention's date; mentions of Canada darken its name; other countries and US states fill
// grey within modern borders; every other located mention is a dot.
import { esc, fold, parseDate, html, cssVar } from "../util.js";
import { fetchDataset } from "../data.js";
import { bookTitle } from "../books.js";
import { loadFlags, allFlags, applyFlags, onFlagsChange, KINDS, STATUSES, isLocal } from "../flags.js";
import { flagForm } from "../flagForm.js";

const BASE_DURATION = 40; // seconds for a full pass at 1×
const PAUSE_SECONDS = 1.2; // in "one after another" mode, the gap between books at 1×
const TOPN = 30;
const OUTLIER_YEARS = 25; // dates this far from a book's median date are left off the timeline (likely back matter)
const NOT_REGION = new Set(["settlement", "site", "feature"]); // e.g. Quebec the city, the Saskatchewan River
// Mentions of Canada as a whole are drawn as its name: it starts LABEL_START and moves towards
// the last mentioning book's colour with every mention (1 − LABEL_STEP^n of the way). The name
// is LABEL_PX at zoom LABEL_ZOOM and scales with the map.
const COUNTRY_LABELS = { canada: { text: "Canada", at: [62.5, -97] } };
const LABEL_START = "#d6d6d1", LABEL_STEP = 0.9, LABEL_PX = 14, LABEL_ZOOM = 4;
// Other countries and US states (modern borders): one grey fill shared by all books,
// reaching 1 − WORLD_STEP^n opacity after n mentions, up to WORLD_MAX.
const WORLD_FILL = "#4a4844", WORLD_STEP = 0.97, WORLD_MAX = 0.5;
const WORLD_TYPES = new Set(["country", "region"]);
const MODE_NOTES = {
  calendar: "Mentions accumulate from the earliest date among the selected books.",
  sequence: "Books play one after another in calendar order, with a short pause between them. Books whose dates overlap play together.",
};
const fmtDay = d3.utcFormat("%-d %b %Y");

export function mount({ map, stage, panel, manifest, params = {} }) {
  let alive = true;
  let raw = [], rows = [], bookCodes = [], bookColor = {}, bookRGB = {}, bookYear = {};
  let hidden = new Set(), mode = "calendar", hoverBook = null, query = "", showCountry = false;
  let locGroups = [], regGroups = [], ctyGroups = [], wldGroups = [], unlGroups = [], lo = 0, hi = 1, frac = 1, curT = 1;
  let seq = [], seqStarts = [];
  let selected = null, selSig = "", showingUnl = false, unlSig = "", detailKey = null;
  let editing = false, picking = null, pickPin = null, openMention = new Set(), suggestions = new Map();
  let playing = false, lastTs = 0;
  let bounds = null, world = null, outline = null, outlineYear = null;
  const shapeCache = new Map();
  const colors = { ring: cssVar("--panel") || "#fff", ink: cssVar("--ink") || "#1c1c1a", accent: cssVar("--accent") || "#3c5a6e" };

  const renderer = L.canvas({ padding: 0.3 });
  const layer = L.layerGroup().addTo(map);
  if (!map.getPane("plBoundaries")) {
    const p = map.createPane("plBoundaries");
    p.style.zIndex = 350; p.style.pointerEvents = "none";
  }
  const outlineRenderer = L.svg({ pane: "plBoundaries", padding: 0.3 });

  // ───────────── UI
  const ctl = html(`<div class="ctl panel">
    <div class="ctlHead"><h1>Place mentions</h1><button class="mini" data-k="collapse" aria-label="Collapse panel">–</button></div>
    <div class="ctlBody">
      <input type="text" data-k="search" placeholder="Find a place…" aria-label="Find a place">
      <div class="legendHead"><h2>Books</h2><span><button class="mini" data-k="all">All</button> <button class="mini" data-k="none">None</button></span></div>
      <div data-k="books"></div>
      <h2 style="margin-top:14px">Time axis</h2>
      <label class="chip"><input type="radio" name="plMode" value="calendar" checked><span class="label">Calendar date</span></label>
      <label class="chip"><input type="radio" name="plMode" value="sequence"><span class="label">Books one after another</span></label>
      <div class="note" data-k="modeNote">${MODE_NOTES.calendar}</div>
      <h2 style="margin-top:14px">Without a location</h2>
      <button data-k="unl" style="width:100%">Show unlocated places</button>
      <h2 style="margin-top:14px">Reading the map</h2>
      <div class="note" style="margin-top:0">Books are coloured red to violet by the year they are set. A mention of a province, colony or territory tints its area, as its borders stood on the date of the mention; colour deepens with each mention and overlapping books mix. Mentions of Canada darken its name towards the books' colours. Other countries and US states shade grey within modern borders, darker with each mention. Other places are dots whose area grows with mentions so far; a dashed ring marks an open flag. Faint lines show the borders in force at the current date.</div>
      <label class="chip" style="margin-top:6px"><input type="checkbox" data-k="country"><span class="label">Fill Canada instead of naming it</span></label>
      <div class="note">Click any place to flag or correct it. <a href="#/flags">Flags &amp; fixes</a></div>
    </div>
    <div class="status" data-k="status">Loading place_mentions…</div>
  </div>`);
  const tl = html(`<div class="timeline panel">
    <button data-k="play" aria-label="Play or pause">▶ Play</button>
    <select data-k="speed" aria-label="Playback speed">
      <option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option>
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
  if (params.q) { q("search").value = params.q; query = fold(params.q); }
  if (MODE_NOTES[params.mode]) {
    mode = params.mode; q("modeNote").textContent = MODE_NOTES[mode];
    ctl.querySelector(`input[name=plMode][value=${mode}]`).checked = true;
  }
  q("unl").onclick = () => { selected = null; editing = false; showingUnl = true; unlSig = ""; openUnl(); update(); };
  q("slider").oninput = e => { stopPlay(); setFrac(+e.target.value / 1000); };
  q("play").onclick = togglePlay;
  q("country").onchange = e => { showCountry = e.target.checked; rebuild(); };
  ctl.querySelectorAll("input[name=plMode]").forEach(el => el.onchange = () => {
    mode = el.value; frac = 1; rebuild();
    q("modeNote").textContent = MODE_NOTES[mode];
  });
  panel.onClose = () => { selected = null; showingUnl = false; selSig = ""; endEdit(); update(); };
  const onMapClick = e => { if (picking) { picking(e.latlng); } };
  map.on("click", onMapClick);
  const scaleLabels = z => map.getContainer().style.setProperty("--pl-label",
    Math.max(7, Math.min(140, LABEL_PX * 2 ** (z - LABEL_ZOOM))).toFixed(1) + "px");
  const onZoom = e => scaleLabels(e.zoom ?? map.getZoom());
  map.on("zoomanim zoomend", onZoom);
  scaleLabels(map.getZoom());
  const offFlags = onFlagsChange(() => alive && raw.length && load(raw));

  // ───────────── load
  const byRole = role => manifest.datasets.find(d => d.project === "places" && d.role === role);
  const ds = byRole("mentions");
  const optional = role => byRole(role) ? fetchDataset(byRole(role)) : Promise.resolve(null);
  if (!ds) q("status").textContent = "No places dataset with role “mentions” in data_sources.json.";
  else Promise.all([fetchDataset(ds), optional("boundaries"), optional("region_aliases"), optional("region_polygons"), optional("world_boundaries"), loadFlags(manifest)])
    .then(([records, b, aliases, rules, w]) => {
      if (!alive) return;
      if (b && aliases && rules) bounds = regionIndex(b, aliases, rules);
      if (w) world = worldIndex(w, aliases || []);
      raw = records.map(r => ({
        mention_id: r.mention_id, book: r.book, entry_id: r.entry_id, chapter_id: r.chapter_id, date: r.date,
        place: r.place, place_type: r.place_type, sentence: r.sentence, ner_label: r.ner_label, resolution_status: r.resolution_status,
        matched_name: r.matched_name, region_historical: r.region_historical, region_modern: r.region_modern,
        country: r.country, historicity: /^true$/i.test((r.historicity || "").trim()),
        location_precision: r.location_precision,
        lat: parseFloat(r.latitude), lon: parseFloat(r.longitude),
      }));
      load(raw);
    }).catch(e => { if (alive) q("status").textContent = e.message; });

  function load(source) {
    // Flags are applied to fresh copies, so editing a flag can be undone without reloading
    const all = applyFlags(source.map(r => ({ ...r })));
    all.forEach(r => { if (r.resolution_status === "not_a_place") r.excluded = true; });
    rows = all.filter(r => !r.excluded);
    rows.forEach(r => { r.ms = parseDate(r.date); r.located = r.historicity && isFinite(r.lat) && isFinite(r.lon); });
    const median = d3.rollup(rows.filter(r => r.ms != null), v => d3.median(v, r => r.ms), r => r.book);
    let outliers = 0;
    rows.forEach(r => { if (r.ms != null && Math.abs(r.ms - median.get(r.book)) > OUTLIER_YEARS * 365.25 * 864e5) { r.ms = null; r.outlier = true; outliers++; } });
    rows.forEach(r => { r.reg = bounds && assignRegion(r); r.world = !r.reg && world ? assignWorld(r) : null; });
    // Rainbow by setting year: the median date of each book's (non-outlying) mentions
    const setting = d3.rollup(rows.filter(r => r.ms != null), v => d3.median(v, r => r.ms), r => r.book);
    bookCodes = [...new Set(rows.map(r => r.book))].sort((a, b) =>
      (setting.get(a) ?? Infinity) - (setting.get(b) ?? Infinity) || bookTitle(a).localeCompare(bookTitle(b)));
    bookCodes.forEach((b, i) => {
      bookColor[b] = `hsl(${Math.round(i / Math.max(1, bookCodes.length - 1) * 285)}, 72%, 46%)`;
      bookRGB[b] = d3.rgb(bookColor[b]);
      bookYear[b] = setting.has(b) ? new Date(setting.get(b)).getUTCFullYear() : null;
    });
    suggestions = buildSuggestions();
    buildLegend();
    rebuild();
    const loc = rows.filter(r => r.located || r.reg || r.world).length, undated = rows.filter(r => r.ms == null).length;
    const reg = rows.filter(r => r.reg).length, wld = rows.filter(r => r.world).length, removed = all.length - rows.length;
    const corrected = rows.filter(r => r.correction).length, open = rows.filter(r => r.flagOpen).length;
    q("status").textContent = `${rows.length.toLocaleString()} mentions · ${loc.toLocaleString()} located (${reg.toLocaleString()} as Canadian regions, ${wld.toLocaleString()} as other countries and states) · ${(rows.length - loc).toLocaleString()} unlocated`
      + (undated > outliers ? ` · ${undated - outliers} undated` : "") + (outliers ? ` · ${outliers} with outlying dates (off the timeline)` : "")
      + (corrected || removed ? ` · ${corrected + removed} corrected${removed ? ` (${removed} removed as not places)` : ""}` : "")
      + (open ? ` · ${open} with open flags` : "")
      + (bounds ? "" : " · no boundary data, regions shown as dots");
  }

  // Names offered in the correction form: places already located, plus region aliases
  function buildSuggestions() {
    const m = new Map();
    for (const r of rows) {
      if (!r.located) continue;
      const name = String(r.matched_name || r.place).split(/, represented by| \(/)[0].trim();
      if (name && !m.has(fold(name))) m.set(fold(name), { name, lat: +r.lat.toFixed(4), lon: +r.lon.toFixed(4), type: r.place_type });
    }
    if (bounds) for (const [k, id] of bounds.alias) if (!m.has(k)) m.set(k, { name: bounds.aliasName.get(k), type: "region", region: id });
    return m;
  }

  // ───────────── region polygons
  function regionIndex(b, aliasRows, ruleRows) {
    const ok = aliasRows.filter(a => a.alias && a.region);
    const alias = new Map(ok.map(a => [fold(a.alias), a.region.trim()]));
    const aliasName = new Map(ok.map(a => [fold(a.alias), a.alias.trim()]));
    const rules = d3.group(ruleRows.filter(r => r.region && r.polygons).map(r => ({
      region: r.region.trim(), level: (r.level || "province").trim(),
      from: r.year_from ? +r.year_from : -Infinity, to: r.year_to ? +r.year_to : Infinity,
      polys: r.polygons.split(";").map(s => s.trim()).filter(Boolean),
    })), r => r.region);
    return { alias, aliasName, rules, years: b.years.map(Number).sort((x, y) => x - y), layers: b.layers, geoms: b.geometries };
  }
  // The snapshot in force in a given year (the earliest one for years before 1667)
  const layerFor = y => { const ys = bounds.years; return ys[Math.max(0, d3.bisectRight(ys, y) - 1)]; };

  function assignRegion(r) {
    if (r.ms == null || NOT_REGION.has(r.location_precision)) return null;
    const clean = String(r.matched_name || "").split(/,| \(|:/)[0];
    const byPlace = bounds.alias.get(fold(r.place)), byMatch = clean ? bounds.alias.get(fold(clean)) : undefined;
    const id = r.correction ? byMatch ?? byPlace : byPlace ?? byMatch; // a correction's name comes first
    if (!id || id.startsWith("world:")) return null;
    const year = new Date(r.ms).getUTCFullYear();
    const rule = bounds.rules.get(id)?.find(x => year >= x.from && year <= x.to);
    if (!rule) return null;
    const ly = layerFor(year);
    const feats = bounds.layers[ly].filter(f => rule.polys.includes(f.name) || rule.polys.includes("@" + f.country));
    return feats.length ? { id, level: rule.level, layer: ly, feats } : null;
  }

  // ───────────── modern countries and US states
  function worldIndex(w, aliasRows) {
    // region_aliases.csv rows whose region is "world:<Natural Earth name>"
    const alias = new Map(aliasRows.filter(a => a.alias && /^world:/.test(a.region || "")).map(a => [fold(a.alias), fold(a.region.slice(6))]));
    return { features: w.features, names: w.names, alias, shapes: new Map() };
  }
  function assignWorld(r) {
    const p = r.location_precision;
    if (r.ms == null || !(WORLD_TYPES.has(p) || (!p && WORLD_TYPES.has(r.place_type)))) return null;
    const clean = String(r.matched_name || "").split(/,| \(|:/)[0];
    for (const name of r.correction ? [clean, r.place] : [r.place, clean]) {
      if (!name) continue;
      const k = fold(name), idx = world.names[world.alias.get(k) ?? k];
      if (!idx) continue;
      const fs = idx.map(i => world.features[i]);
      return { key: idx.join(","), idx, name: fs.length === 1 ? fs[0].name : fs[0].admin, parts: fs.map(f => f.name) };
    }
    return null;
  }
  function worldShape(w) {
    if (!world.shapes.has(w.key)) {
      const coords = [];
      for (const i of w.idx) { const g = world.features[i].g; g.type === "Polygon" ? coords.push(g.coordinates) : coords.push(...g.coordinates); }
      world.shapes.set(w.key, L.GeoJSON.coordsToLatLngs(coords, 2));
    }
    return world.shapes.get(w.key);
  }

  function shapeOf(feats) {
    const k = feats.map(f => f.g).join(",");
    if (!shapeCache.has(k)) {
      const coords = [];
      for (const f of feats) { const g = bounds.geoms[f.g]; g.type === "Polygon" ? coords.push(g.coordinates) : coords.push(...g.coordinates); }
      shapeCache.set(k, L.GeoJSON.coordsToLatLngs(coords, 2));
    }
    return shapeCache.get(k);
  }
  const regionNames = feats => feats.length > 3 ? `${feats.length} provinces and territories` : feats.map(f => f.name).join(" + ");

  function showOutline(year) {
    if (year === outlineYear) return;
    outlineYear = year; outline?.remove(); outline = null;
    if (year == null || !bounds) return;
    outline = L.layerGroup(bounds.layers[year].map(f => L.polygon(shapeOf([f]), {
      renderer: outlineRenderer, pane: "plBoundaries", interactive: false,
      color: colors.ink, weight: 0.6, opacity: 0.12, fill: false,
    }))).addTo(map);
  }

  function buildLegend() {
    const counts = d3.rollup(rows, v => v.length, r => r.book);
    const list = d3.select(q("books")); list.selectAll("*").remove();
    bookCodes.forEach(b => {
      const row = list.append("label").attr("class", "chip").attr("title", `${bookTitle(b)} (${b})${bookYear[b] ? `, set in ${bookYear[b]}` : ""}`);
      row.append("input").attr("type", "checkbox").property("checked", !hidden.has(b))
        .on("change", function () { this.checked ? hidden.delete(b) : hidden.add(b); frac = 1; rebuild(); });
      row.append("span").attr("class", "dot").style("background", bookColor[b]);
      row.append("span").attr("class", "label").text(bookTitle(b));
      row.append("span").attr("class", "count").text(`${bookYear[b] ?? "—"} · ${counts.get(b)}`);
      row.on("mouseenter", () => { hoverBook = b; update(); }).on("mouseleave", () => { hoverBook = null; update(); });
    });
  }
  function setAllBooks(on) { hidden = on ? new Set() : new Set(bookCodes); buildLegend(); frac = 1; rebuild(); }

  // ───────────── time axis
  // "One after another": books whose dates overlap are merged into clusters that keep calendar
  // time inside them; the gaps between clusters become a short pause. A book's span is its 2nd–98th
  // percentile date (a stray epilogue date doesn't stretch it), and each cluster gets playing time
  // in proportion to √(its mentions), so short books aren't over in a blink.
  function buildSequence(dated) {
    const spans = d3.rollups(dated, v => {
      const ms = v.map(r => r.ms).sort(d3.ascending);
      return { s: d3.quantileSorted(ms, 0.02), e: d3.quantileSorted(ms, 0.98), n: v.length };
    }, r => r.book).map(d => d[1]).sort((a, b) => a.s - b.s);
    const cl = [];
    for (const sp of spans) {
      const c = cl.at(-1);
      if (c && sp.s <= c.e) { c.e = Math.max(c.e, sp.e); c.n += sp.n; } else cl.push({ ...sp });
    }
    cl.forEach(c => { c.dur = Math.sqrt(c.n); if (c.e <= c.s) c.e = c.s + 864e5; });
    const active = d3.sum(cl, c => c.dur), share = PAUSE_SECONDS / BASE_DURATION;
    const pause = cl.length > 1 ? share * active / Math.max(0.25, 1 - share * (cl.length - 1)) : 0;
    let off = 0;
    for (const c of cl) { c.off = off; off += c.dur + pause; }
    seq = cl; seqStarts = cl.map(c => c.s);
  }
  function seqT(ms) {
    const i = d3.bisectRight(seqStarts, ms) - 1, c = seq[Math.max(0, i)];
    if (i >= 0 && i + 1 < seq.length && ms > c.e && ms - c.e > seq[i + 1].s - ms) return seq[i + 1].off; // nearer the next book
    return c.off + c.dur * Math.min(1, Math.max(0, (ms - c.s) / (c.e - c.s)));
  }
  /** Calendar date at a timeline position, or null during a pause (with the next cluster's start). */
  function dateAt(t) {
    if (mode === "calendar") return { ms: t };
    const offs = seq.map(c => c.off), i = Math.max(0, d3.bisectRight(offs, t) - 1), c = seq[i];
    if (!c) return { ms: null };
    return t <= c.off + c.dur + 1e-9 ? { ms: c.s + (t - c.off) / c.dur * (c.e - c.s) } : { ms: null, next: seq[i + 1]?.s ?? c.e };
  }

  // ───────────── group mentions for the current selection
  function rebuild() {
    const dated = rows.filter(r => !hidden.has(r.book) && r.ms != null);
    if (mode === "sequence" && dated.length) buildSequence(dated);
    rows.forEach(r => { r.tv = r.ms == null || hidden.has(r.book) ? null : mode === "calendar" ? r.ms : seqT(r.ms); });
    const vis = rows.filter(r => r.tv != null).sort((a, b) => a.tv - b.tv);
    lo = d3.min(vis, r => r.tv) ?? 0; hi = d3.max(vis, r => r.tv) ?? 1; if (hi <= lo) hi = lo + 1;

    const lm = new Map(), rm = new Map(), cm = new Map(), wm = new Map(), um = new Map();
    const multi = (m, k, make, r) => {
      let g = m.get(k); if (!g) m.set(k, g = { ...make, rows: [], byBook: new Map() });
      g.rows.push(r);
      if (!g.byBook.has(r.book)) g.byBook.set(r.book, []);
      g.byBook.get(r.book).push(r.tv);
    };
    for (const r of vis) {
      if (r.world) {
        multi(wm, r.world.key, { key: "W" + r.world.key, kind: "W", world: r.world, text: r.world.name }, r);
      } else if (r.reg && r.reg.level === "country" && !showCountry) {
        multi(cm, r.reg.id, { key: "C" + r.reg.id, kind: "C", reg: r.reg }, r);
      } else if (r.reg) {
        const k = r.book + "|" + r.reg.layer + "|" + r.reg.id;
        let g = rm.get(k); if (!g) rm.set(k, g = { key: "R" + k, kind: "R", book: r.book, reg: r.reg, rows: [], times: [] });
        g.rows.push(r); g.times.push(r.tv);
      } else if (r.located) {
        const k = r.book + "|" + r.lat.toFixed(4) + "," + r.lon.toFixed(4);
        let g = lm.get(k); if (!g) lm.set(k, g = { key: "L" + k, kind: "L", book: r.book, lat: r.lat, lon: r.lon, rows: [], times: [] });
        g.rows.push(r); g.times.push(r.tv);
      } else multi(um, fold(r.place), { key: "U" + fold(r.place), kind: "U" }, r);
    }
    const topLabel = rs => d3.greatest(d3.rollups(rs, v => v.length, r => r.place), d => d[1])[0];
    locGroups = [...lm.values()]; regGroups = [...rm.values()]; ctyGroups = [...cm.values()]; unlGroups = [...um.values()];
    // Drawn bottom to top: whole countries made of several units (the UK), then single units, then US states
    const isState = g => world.features[g.world.idx[0]].kind === "state";
    wldGroups = [...wm.values()].sort((a, b) => isState(a) - isState(b) || b.world.idx.length - a.world.idx.length);
    for (const g of [...locGroups, ...regGroups, ...ctyGroups, ...wldGroups, ...unlGroups]) {
      g.label = topLabel(g.rows); g.total = g.rows.length; g.flagged = g.rows.some(r => r.flagOpen);
    }
    locGroups.sort((a, b) => b.total - a.total); // big dots drawn first, small ones on top
    regGroups.sort((a, b) => (b.reg.level === "country") - (a.reg.level === "country") || b.total - a.total); // countries underneath

    layer.clearLayers();
    const clickable = (m, g) => m.on("click", e => {
      L.DomEvent.stop(e);
      if (picking) picking(e.latlng); else select(g);
    });
    // Areas go in first so the shared canvas draws (and hit-tests) dots above them;
    // modern countries below Canada's historical regions
    for (const g of wldGroups) {
      g.marker = clickable(L.polygon(worldShape(g.world), { renderer, weight: 0.5, color: WORLD_FILL, opacity: 0,
        fillColor: WORLD_FILL, fillOpacity: 0 }).bindTooltip(() => tipHtml(g), { sticky: true }), g).addTo(layer);
      g.sig = "";
    }
    for (const g of regGroups) {
      g.marker = clickable(L.polygon(shapeOf(g.reg.feats), { renderer, weight: 0.5, color: bookColor[g.book], opacity: 0,
        fillColor: bookColor[g.book], fillOpacity: 0 }).bindTooltip(() => tipHtml(g), { sticky: true }), g).addTo(layer);
      g.sig = "";
    }
    for (const g of locGroups) {
      g.marker = clickable(L.circleMarker([g.lat, g.lon], { renderer, radius: 0, weight: 1, color: colors.ring, opacity: 0,
        fillColor: bookColor[g.book], fillOpacity: 0 })
        .bindTooltip(() => tipHtml(g), { direction: "top", offset: [0, -6], sticky: true }), g).addTo(layer);
      g.sig = "";
    }
    for (const g of ctyGroups) {
      const spec = COUNTRY_LABELS[g.reg.id] || { text: g.label, at: L.polygon(shapeOf(g.reg.feats)).getBounds().getCenter() };
      g.text = spec.text;
      g.marker = clickable(L.marker(spec.at, { icon: L.divIcon({ className: "plCountry", html: `<span>${esc(spec.text)}</span>`, iconSize: [0, 0] }), keyboard: false })
        .bindTooltip(() => tipHtml(g), { direction: "top", offset: [0, -14] }), g).addTo(layer);
      g.el = g.marker.getElement()?.firstElementChild;
      g.sig = "";
    }
    // Keep the selection; after a correction moves its mentions, follow them to their new group
    const groups = { L: locGroups, R: regGroups, C: ctyGroups, W: wldGroups, U: unlGroups };
    const firstId = selected?.rows[0]?.mention_id;
    const same = selected && (groups[selected.kind].find(g => g.key === selected.key) ||
      Object.values(groups).flat().find(g => g.rows.some(r => r.mention_id === firstId)));
    if (selected && !same) { selected = null; endEdit(); panel.close(); }
    else if (selected) selected = same;
    selSig = ""; unlSig = "";
    setFrac(frac);
  }

  // ───────────── per-frame update
  function setFrac(f) {
    frac = f; curT = lo + (hi - lo) * f;
    q("slider").value = Math.round(f * 1000);
    const d = rows.length ? dateAt(curT) : { ms: null };
    q("label").textContent = !rows.length ? "—" : d.ms != null ? fmtDay(new Date(d.ms)) : `… ${new Date(d.next).getUTCFullYear()}`;
    const ms = d.ms ?? d.next;
    showOutline(rows.length && bounds && ms != null ? layerFor(new Date(ms).getUTCFullYear()) : null);
    update();
  }
  const matches = g => !query || fold(g.label).includes(query) || (g.text && fold(g.text).includes(query)) ||
    (g.reg && g.reg.feats.some(f => fold(f.name).includes(query)));
  const dimLoc = g => (hoverBook && g.book !== hoverBook) || !matches(g);
  const countTo = (g, t) => g.times ? d3.bisectRight(g.times, t) : [...g.byBook.values()].reduce((s, a) => s + d3.bisectRight(a, t), 0);

  function update() {
    if (!rows.length || !alive) return;
    const win = (hi - lo) * 0.02, t = curT;
    for (const g of locGroups) {
      const n = d3.bisectRight(g.times, t); g.n = n;
      const r = n ? Math.min(26, 2.5 + 2.4 * Math.sqrt(n)) : 0;
      const recent = n && t - g.times[n - 1] <= win && t < hi;
      const dim = n && dimLoc(g), sel = selected === g;
      const sig = `${r}|${recent}|${dim}|${sel}|${g.flagged}`;
      if (sig === g.sig) continue;
      g.sig = sig;
      g.marker.setRadius(r);
      g.marker.setStyle(!n ? { opacity: 0, fillOpacity: 0 } : {
        opacity: dim ? 0.08 : 1, fillOpacity: dim ? 0.06 : recent ? 0.85 : 0.62,
        color: sel ? colors.accent : recent || g.flagged ? colors.ink : colors.ring, weight: sel ? 3 : recent ? 2 : g.flagged ? 1.5 : 1,
        dashArray: g.flagged && !sel ? "3 2" : null,
      });
      if (sel) g.marker.bringToFront();
    }
    for (const g of regGroups) {
      const n = d3.bisectRight(g.times, t); g.n = n;
      const recent = n && t - g.times[n - 1] <= win && t < hi;
      const dim = n && dimLoc(g), sel = selected === g;
      const fill = !n ? 0 : dim ? 0.02 : Math.min(0.45, 0.06 + 0.05 * Math.sqrt(n) + (recent ? 0.06 : 0));
      const sig = `${fill}|${dim}|${sel}`;
      if (sig === g.sig) continue;
      g.sig = sig;
      g.marker.setStyle({
        fillOpacity: fill, opacity: !n || dim ? 0 : sel ? 0.9 : 0.15,
        color: sel ? colors.accent : bookColor[g.book], weight: sel ? 2 : 0.5,
      });
    }
    for (const g of wldGroups) {
      let n = 0, last = -Infinity;
      for (const [b, a] of g.byBook) {
        if (hoverBook && b !== hoverBook) continue;
        const k = d3.bisectRight(a, t); n += k; if (k) last = Math.max(last, a[k - 1]);
      }
      g.n = countTo(g, t);
      const recent = n && t - last <= win && t < hi, dim = !matches(g), sel = selected === g;
      const fill = !n ? 0 : dim ? 0.03 : Math.min(WORLD_MAX, 1 - Math.pow(WORLD_STEP, n)) + (recent ? 0.05 : 0);
      const sig = `${fill}|${dim}|${sel}`;
      if (sig === g.sig) continue;
      g.sig = sig;
      g.marker.setStyle({ fillOpacity: fill, opacity: !n || dim ? 0 : sel ? 0.9 : 0.2,
        color: sel ? colors.accent : WORLD_FILL, weight: sel ? 2 : 0.5 });
    }
    for (const g of ctyGroups) {
      if (!g.el) continue;
      // Hue from the book that mentioned it last, darkness from every mention so far
      let n = 0, last = -Infinity, lastBook = null;
      for (const [b, a] of g.byBook) {
        if (hoverBook && b !== hoverBook) continue;
        const k = d3.bisectRight(a, t); if (!k) continue;
        n += k;
        if (a[k - 1] > last) { last = a[k - 1]; lastBook = b; }
      }
      g.n = countTo(g, t);
      const color = n ? d3.interpolateRgb(LABEL_START, bookRGB[lastBook])(1 - Math.pow(LABEL_STEP, n)) : LABEL_START;
      const recent = n && t - last <= win && t < hi, dim = !matches(g), sel = selected === g;
      const sig = `${color}|${recent}|${dim}|${sel}`;
      if (sig === g.sig) continue;
      g.sig = sig;
      g.el.style.color = color;
      g.el.classList.toggle("recent", !!recent); g.el.classList.toggle("sel", sel); g.el.classList.toggle("dim", dim);
    }
    if (selected) {
      const sig = selected.key + ":" + countTo(selected, t);
      if (sig !== selSig && !editing) { selSig = sig; renderDetail(); }
    } else if (showingUnl && !editing) renderUnl(t);
  }

  // ───────────── tooltip + right-hand detail
  function tipHtml(g) {
    const who = g.book ? `<span class="dot" style="background:${bookColor[g.book]};margin-right:5px"></span>${esc(bookTitle(g.book))}`
      : `${g.byBook.size} book${g.byBook.size === 1 ? "" : "s"}`;
    return `<b>${esc(g.text || g.label)}</b><div class="muted">${who}</div>` +
      `<div class="muted">${g.n} of ${g.total} mentions so far</div>` +
      (g.kind === "W" ? `<div class="muted">modern borders</div>` :
        g.kind === "R" ? `<div class="muted">${esc(regionNames(g.reg.feats))}, borders of ${g.reg.layer}</div>`
        : g.kind === "L" && g.rows[0].matched_name ? `<div class="muted">${esc(g.rows[0].matched_name)}</div>` : "") +
      (g.flagged ? `<div class="muted">⚑ open flag</div>` : "");
  }

  function select(g) { selected = g; showingUnl = false; selSig = ""; endEdit(); openMention = new Set(); update(); }

  function renderDetail() {
    const g = selected, t = curT, r0 = g.rows[0];
    const books = g.book ? [g.book] : [...g.byBook.keys()];
    const sub = ({ L: "located", R: "region", C: "country", W: "country or state", U: "no location" })[g.kind] + " · " +
      books.map(b => `<span class="dot" style="background:${bookColor[b]}"></span> ${esc(bookTitle(b))}`).join(" &nbsp;");
    const props = [];
    if (g.kind === "L") {
      if (r0.matched_name) props.push(["matched to", r0.matched_name]);
      const rh = [...new Set(g.rows.map(r => r.region_historical).filter(Boolean))].join("; ");
      if (rh) props.push(["historical region", rh]);
      if (r0.region_modern) props.push(["modern region", r0.region_modern]);
      if (r0.country) props.push(["country", r0.country]);
      props.push(["coordinates", g.lat.toFixed(3) + ", " + g.lon.toFixed(3)]);
    } else if (g.kind === "R") {
      props.push(["filled area", `${g.reg.feats.map(f => f.name).join(", ")} (HACOLP borders of ${g.reg.layer})`]);
      if (r0.matched_name) props.push(["matched to", r0.matched_name]);
    } else if (g.kind === "W") {
      const parts = g.world.parts.length > 1 ? ` (${g.world.parts.join(", ")})` : "";
      props.push(["filled area", `${g.world.name}${parts}, modern borders (Natural Earth)`]);
      if (r0.matched_name) props.push(["matched to", r0.matched_name]);
    } else if (g.kind === "C") {
      props.push(["shown as", `the name “${g.text}”, darkening with each mention (tick “Fill countries” to fill it instead)`]);
    } else {
      props.push(["status", [...new Set(g.rows.map(r => r.resolution_status).filter(Boolean))].join(", ") || "—"]);
    }
    props.push(["spelled", [...new Set(g.rows.map(r => r.place))].join(", ")]);
    props.push(["NER label", [...new Set(g.rows.map(r => r.ner_label).filter(Boolean))].join(", ")]);
    const flags = [...new Map(g.rows.flatMap(r => r.flags || []).map(f => [f.id, f])).values()];
    const upto = g.rows.filter(r => r.tv != null && r.tv <= t);
    const many = g.kind === "U" || g.kind === "C" || g.kind === "W";
    const body = (g.kind === "U" ? `<div class="row click" data-back style="border:none;margin-top:8px">← All unlocated places</div>` : "") +
      props.map(([k, v]) => `<div class="prop"><b>${esc(k)}:</b> ${esc(v)}</div>`).join("") +
      `<div class="btnRow"><button data-flag>⚑ Flag or correct…</button></div>` +
      (flags.length ? `<h3>Flags</h3>` + flags.map(f => `<div class="row flagRow">
          <span class="badge s-${esc(f.status)}">${esc(STATUSES[f.status] || f.status)}</span> ${esc(KINDS[f.kind] || f.kind)}
          · ${esc(scopeText(f))}${f.resolution ? ` <span class="muted">${esc(f.resolution)}</span>` : ""}
          ${f.note ? `<div class="muted">${esc(f.note)}</div>` : ""}
          <a href="#" data-edit="${esc(f.id)}">edit</a>${isLocal(f.id) ? ' <span class="muted">· not yet downloaded</span>' : ""}</div>`).join("") : "") +
      `<h3>Mentions to date (${upto.length} of ${g.total})</h3>` +
      upto.slice(0, 120).map(r => `<div class="row click" data-m="${esc(r.mention_id)}">${esc(r.date || "no date")} · ${many ? esc(bookTitle(r.book)) + " · " : ""}entry ${esc(r.entry_id)}` +
        `${r.place !== g.label ? " · “" + esc(r.place) + "”" : ""}${r.flagOpen ? " ⚑" : ""}${r.correction ? " ✓" : ""}</div>` +
        (openMention.has(r.mention_id) ? `<div class="sentence">${markPlace(r.sentence, r.place)}<div><a href="#" data-flagm="${esc(r.mention_id)}">Flag this mention</a></div></div>` : "")).join("") +
      (upto.length > 120 ? `<div class="muted" style="padding-top:4px">…and ${upto.length - 120} more</div>` : "");
    const el = html(`<div>${body}</div>`);
    el.querySelector("[data-back]")?.addEventListener("click", () => q("unl").click());
    el.querySelector("[data-flag]").onclick = () => startEdit({});
    el.querySelectorAll("[data-edit]").forEach(a => a.onclick = e => { e.preventDefault(); startEdit({ existing: allFlags().find(f => f.id === a.dataset.edit) }); });
    el.querySelectorAll("[data-m]").forEach(d => d.onclick = () => {
      const id = d.dataset.m; openMention.has(id) ? openMention.delete(id) : openMention.add(id); renderDetail();
    });
    el.querySelectorAll("[data-flagm]").forEach(a => a.onclick = e => { e.preventDefault(); startEdit({ mention: g.rows.find(r => r.mention_id === a.dataset.flagm) }); });
    if (panel.isOpen && detailKey === g.key) panel.update(el); else panel.open(g.text || g.label, sub, el);
    detailKey = g.key;
  }
  const scopeText = f => f.scope === "mention" ? "one mention" : f.scope === "book" ? `in ${bookTitle(f.book)}` : "every book";
  function markPlace(sentence, place) {
    const s = String(sentence || ""), i = s.toLowerCase().indexOf(String(place).toLowerCase());
    return i < 0 ? esc(s) : esc(s.slice(0, i)) + "<mark>" + esc(s.slice(i, i + place.length)) + "</mark>" + esc(s.slice(i + place.length));
  }

  // ───────────── flag form
  function startEdit({ mention, existing }) {
    stopPlay();
    editing = true;
    const g = selected;
    const form = flagForm({
      rows: g.rows, mention, existing, suggestions,
      pick: cb => {
        map.getContainer().style.cursor = "crosshair";
        picking = ll => {
          picking = null; map.getContainer().style.cursor = "";
          pickPin?.remove();
          pickPin = L.circleMarker(ll, { radius: 7, color: colors.accent, weight: 2, dashArray: "3 2", fillOpacity: 0.2, interactive: false }).addTo(map);
          cb(ll);
        };
      },
      onClose: () => { endEdit(); selSig = ""; update(); },
    });
    panel.update(form);
    form.querySelector("select, input")?.focus();
  }
  function endEdit() {
    editing = false; picking = null; map.getContainer().style.cursor = "";
    pickPin?.remove(); pickPin = null;
  }

  function openUnl() { detailKey = null; panel.open("Places without a location", "", "<div></div>"); renderUnl(curT); }

  function renderUnl(t) {
    const items = [];
    for (const g of unlGroups) {
      let tot = 0; const parts = [];
      for (const [b, a] of g.byBook) { const n = d3.bisectRight(a, t); if (n) { tot += n; parts.push([b, n]); } }
      if (tot && matches(g) && !(hoverBook && !g.byBook.has(hoverBook))) items.push({ g, tot, parts });
    }
    items.sort((a, b) => b.tot - a.tot || a.g.label.localeCompare(b.g.label));
    const sig = items.slice(0, TOPN).map(i => i.g.key + i.parts.join()).join("|") + items.length;
    if (sig === unlSig) return;
    unlSig = sig;
    const max = items[0]?.tot || 1, total = items.reduce((s, i) => s + i.tot, 0);
    const el = html(`<div>
      <div class="muted" style="margin:10px 0 8px">Mentions to date where no real-world location was matched (<code>historicity</code> false). ${items.length} places · ${total} mentions. Bar colours are books. Click a place to give it a location or flag it.</div>
      ${items.slice(0, TOPN).map((it, i) => `<div class="brow" data-i="${i}" title="${esc(it.g.label)}">
        <div class="blabel">${it.g.flagged ? "⚑ " : ""}${esc(it.g.label)}</div>
        <div class="btrack"><div class="bfill" style="width:${it.tot / max * 100}%">${it.parts.map(([b, n]) =>
          `<span style="width:${n / it.tot * 100}%;background:${bookColor[b]}" title="${esc(bookTitle(b))}: ${n}"></span>`).join("")}</div></div>
        <div class="bcount">${it.tot}</div></div>`).join("") || '<div class="muted">None yet at this point in the timeline.</div>'}
      ${items.length > TOPN ? `<div class="muted" style="margin-top:6px">${items.length - TOPN} more places not shown; use the search box to find one</div>` : ""}
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

  return () => {
    alive = false; playing = false; endEdit(); offFlags(); map.off("click", onMapClick); map.off("zoomanim zoomend", onZoom);
    layer.remove(); outline?.remove();
  };
}
