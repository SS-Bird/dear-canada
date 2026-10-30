// Historical boundaries: a workshop map for the boundary data on its own, without the books.
// Reads the HACOLP provinces, colonies and territories (places role "boundaries") and the TCP census
// subdivisions (historical roles "csd_layer" and "csd_links", one file per layer: 1851 … 1921, plus the
// 1911 alternatives V1T1 and V2T2), built by Pipelines/Place Mentions/04_census_boundaries.py.
// The year slider picks the HACOLP snapshot in force; the census shown follows the slider (nearest
// census within ten years, as for place mentions) or is chosen by hand. Click a subdivision to see
// its attributes and the subdivisions it overlaps in every other census.
import { esc, html, cssVar } from "../util.js";
import { fetchDataset } from "../data.js";

const FOLLOW_GAP = 10; // the census shown while following the slider is at most this many years away
const NO_DATA = "NO DATA";
const VARIANTS = { "": "Main layer (hybrid)", V1T1: "Vol. 1, Table 1", V2T2: "Vol. 2, Table 2" };
const COUNTRY_COLORS = { Canada: "#c0392b", Britain: "#2e6da4", France: "#7b4fa0", USA: "#5f7f3a", Spain: "#c58b1b",
  "Hudson's Bay Company": "#8a5a2b", Disputed: "#8c8c8c" };
const keyYear = k => +k.slice(0, 4);
const keyLabel = k => k.length > 4 ? `${k.slice(0, 4)} ${VARIANTS[k.slice(5)]}` : k === "1911" ? "1911 (hybrid)" : k;

export function mount({ map, stage, panel, manifest, params = {} }) {
  let alive = true;
  let bounds = null, hacolpYear = null, hacolpLayer = null, csdLayer = null, shownKey = null, highlight = null;
  let year = +params.year || 1871, follow = true, chosenCensus = "1871", variant = "", showProv = true, showCsd = true;
  let selected = null, drawn = 0; // selected: { k, i }; drawn: counts drawCsd calls, so a slow load can't land late
  const layerData = new Map(), linkData = new Map(), shapes = new Map();
  const colors = { ink: cssVar("--ink") || "#1c1c1a", dim: cssVar("--ink-dim") || "#6b6a66", accent: cssVar("--accent") || "#3c5a6e" };

  const renderer = L.canvas({ padding: 0.3 });
  for (const [name, z] of [["hbProv", 420], ["hbSel", 430]]) {
    if (!map.getPane(name)) { const p = map.createPane(name); p.style.zIndex = z; p.style.pointerEvents = "none"; }
  }
  const provLines = L.svg({ pane: "hbProv", padding: 0.3 }), selRenderer = L.svg({ pane: "hbSel", padding: 0.3 });

  // ───────────── data
  const ds = (project, role) => manifest.datasets.filter(d => d.project === project && d.role === role);
  const byKey = role => new Map(ds("historical", role).map(d => [d.name.match(/_(\d{4}(?:_V[12]T[12])?)\.json$/)?.[1], d]).filter(([k]) => k));
  const layerFiles = byKey("csd_layer"), linkFiles = byKey("csd_links");
  const censusYears = [...new Set([...layerFiles.keys()].map(keyYear))].sort((a, b) => a - b);
  const getLayer = k => { if (!layerData.has(k)) layerData.set(k, fetchDataset(layerFiles.get(k))); return layerData.get(k); };
  const getLinks = k => { if (!linkData.has(k)) linkData.set(k, linkFiles.has(k) ? fetchDataset(linkFiles.get(k)) : Promise.resolve(null)); return linkData.get(k); };

  // ───────────── UI
  const ctl = html(`<div class="ctl panel">
    <div class="ctlHead"><h1>Historical boundaries</h1><button class="mini" data-k="collapse" aria-label="Collapse panel">–</button></div>
    <div class="ctlBody">
      <h2>Layers</h2>
      <label class="chip"><input type="checkbox" data-k="prov" checked><span class="label">Provinces, colonies, territories</span></label>
      <label class="chip"><input type="checkbox" data-k="csd" checked><span class="label">Census subdivisions</span></label>
      <h2>Census</h2>
      <label class="chip"><input type="radio" name="hbCensus" value="follow" checked><span class="label">Nearest to the slider</span></label>
      <div data-k="census" style="display:flex;flex-wrap:wrap;gap:0 12px"></div>
      <h2>1911 layer</h2>
      ${Object.entries(VARIANTS).map(([v, label]) => `<label class="chip"><input type="radio" name="hbVariant" value="${v}"${v ? "" : " checked"}><span class="label">${label}</span></label>`).join("")}
      <div class="note">TCP drew 1911 three ways. The main layer is Volume 1, Table 1 in NB, NS, PE, ON and QC and Volume 2, Table 2 in the west; it is the one place mentions use. The two tables' own layers are the ones their published figures join to.</div>
      <h2 style="margin-top:14px">Reading the map</h2>
      <div class="note" style="margin-top:0">Provinces, colonies and territories (HACOLP) are tinted by the power that held them and outlined in dark lines over the census subdivisions (TCP). Small hexagons are TCP's placeholders for settlements whose boundaries are unknown; grey areas were not enumerated (“NO DATA”). Click a subdivision to see what it overlaps in the other censuses.</div>
    </div>
    <div class="status" data-k="status">Loading…</div>
  </div>`);
  const tl = html(`<div class="timeline panel">
    <span class="tlLabel" data-k="hacolp" style="text-align:left;min-width:0">—</span>
    <input type="range" data-k="slider" step="1" aria-label="Year">
    <span class="tlLabel" data-k="label">—</span>
  </div>`);
  stage.append(ctl, tl);
  const q = k => stage.querySelector(`[data-k="${k}"]`);
  q("census").innerHTML = censusYears.map(y => `<label class="chip"><input type="radio" name="hbCensus" value="${y}"><span class="label">${y}</span></label>`).join("");

  q("collapse").onclick = () => { const c = ctl.classList.toggle("collapsed"); q("collapse").textContent = c ? "+" : "–"; };
  q("prov").onchange = e => { showProv = e.target.checked; drawHacolp(true); };
  q("csd").onchange = e => { showCsd = e.target.checked; drawHacolp(true); drawCsd(); };
  ctl.querySelectorAll("input[name=hbCensus]").forEach(el => el.onchange = () => {
    follow = el.value === "follow"; if (!follow) chosenCensus = el.value; drawCsd();
  });
  ctl.querySelectorAll("input[name=hbVariant]").forEach(el => el.onchange = () => { variant = el.value; drawCsd(); });
  q("slider").oninput = e => { year = +e.target.value; drawHacolp(); drawCsd(); };
  panel.onClose = () => { selected = null; drawSelection(); };

  if (!layerFiles.size) q("status").textContent = "No census subdivision layers in the manifest; run 04_census_boundaries.py and sync_data.py.";
  const hb = manifest.datasets.find(d => d.project === "places" && d.role === "boundaries");
  (hb ? fetchDataset(hb) : Promise.resolve(null)).then(b => {
    if (!alive) return;
    if (b) bounds = { years: b.years.map(Number).sort((x, y) => x - y), layers: b.layers, geoms: b.geometries };
    const lo = Math.min(bounds?.years[0] ?? 1851, censusYears[0] ?? 1851), hi = Math.max(bounds?.years.at(-1) ?? 1921, censusYears.at(-1) ?? 1921);
    Object.assign(q("slider"), { min: lo, max: hi, value: year = Math.min(hi, Math.max(lo, year)) });
    drawHacolp(); drawCsd();
  }).catch(e => { if (alive) q("status").textContent = e.message; });

  // ───────────── HACOLP provinces
  const hacolpFor = y => { const ys = bounds.years; return ys[Math.max(0, d3.bisectRight(ys, y) - 1)]; };
  const latlngs = g => L.GeoJSON.coordsToLatLngs(g.type === "Polygon" ? [g.coordinates] : g.coordinates, 2);

  function drawHacolp(force = false) {
    if (!bounds) return;
    const hy = hacolpFor(year);
    q("hacolp").textContent = `Borders of ${hy}`;
    q("label").textContent = String(year);
    if (hy === hacolpYear && !force) return;
    hacolpYear = hy; hacolpLayer?.remove(); hacolpLayer = null;
    if (!showProv) return;
    // Over subdivisions: dark outlines only, so clicks reach the subdivisions; alone: tinted and clickable
    const over = showCsd && shownKey;
    hacolpLayer = L.layerGroup(bounds.layers[hy].map(f => {
      const c = COUNTRY_COLORS[f.country] || colors.dim;
      const poly = L.polygon(latlngs(bounds.geoms[f.g]), over
        ? { renderer: provLines, pane: "hbProv", interactive: false, color: colors.ink, weight: 1.4, opacity: 0.55, fill: false }
        : { renderer, color: c, weight: 1, opacity: 0.7, fillColor: c, fillOpacity: 0.14 });
      if (!over) poly.bindTooltip(`<b>${esc(f.name)}</b><div class="muted">${esc(f.country || "—")} · borders of ${hy}</div>`, { sticky: true })
        .on("click", () => { selected = null; drawSelection(); panel.open(f.name, `province, colony or territory · borders of ${hy}`,
          `<div class="prop"><b>held by:</b> ${esc(f.country || "—")}</div><div class="prop"><b>snapshot:</b> HACOLP Territorial Evolution, ${hy}</div>`); });
      return poly;
    })).addTo(map);
  }

  // ───────────── TCP census subdivisions
  function censusKey() {
    let y;
    if (follow) {
      const near = censusYears.length ? censusYears.reduce((a, b) => Math.abs(b - year) < Math.abs(a - year) ? b : a) : null;
      y = near != null && Math.abs(near - year) <= FOLLOW_GAP ? near : null;
    } else y = +chosenCensus;
    if (y == null) return null;
    const k = y === 1911 && variant ? `1911_${variant}` : String(y);
    return layerFiles.has(k) ? k : null;
  }

  async function drawCsd() {
    const k = showCsd ? censusKey() : null;
    if (k === shownKey && (csdLayer || !k)) { status(k); return; }
    const call = ++drawn;
    shownKey = k; csdLayer?.remove(); csdLayer = null;
    drawHacolp(true);
    status(k);
    if (!k) return;
    q("status").textContent = `Loading census of ${keyLabel(k)}…`;
    const d = await getLayer(k).catch(e => { q("status").textContent = e.message; return null; });
    if (!alive || !d || call !== drawn) return;
    csdLayer = L.layerGroup(d.features.map((f, i) => {
      const nodata = f.name.toUpperCase() === NO_DATA;
      return L.polygon(shapeOf(k, d, i), {
        renderer, color: colors.dim, weight: 0.4, opacity: nodata ? 0.25 : 0.6,
        fillColor: f.hex ? colors.accent : colors.dim, fillOpacity: nodata ? 0.1 : f.hex ? 0.5 : 0.03,
      }).bindTooltip(() => `<b>${esc(f.name)}</b><div class="muted">${esc(f.cd)}, ${esc(f.pr)} · ${esc(keyLabel(k))}</div>`, { sticky: true })
        .on("click", e => { L.DomEvent.stop(e); select(k, i); });
    })).addTo(map);
    status(k, d);
  }

  function status(k, d) {
    q("status").textContent = !showCsd ? "Census subdivisions hidden."
      : !k ? (follow ? `No census within ${FOLLOW_GAP} years of ${year}.` : "No layer for this census.")
      : d ? `Census of ${keyLabel(k)} · ${d.features.length.toLocaleString()} subdivisions · ${d.table}` : `Census of ${keyLabel(k)}`;
  }

  function shapeOf(k, d, i) {
    const id = k + "#" + i;
    if (!shapes.has(id)) shapes.set(id, latlngs(d.geometries[i]));
    return shapes.get(id);
  }

  // ───────────── selection and the panel
  async function select(k, i, { fit = false } = {}) {
    selected = { k, i };
    const [d, links] = await Promise.all([getLayer(k), getLinks(k)]);
    if (!alive || selected?.k !== k || selected.i !== i) return;
    const f = d.features[i];
    drawSelection(d);
    if (fit) map.fitBounds(L.polygon(shapeOf(k, d, i)).getBounds(), { maxZoom: 10, padding: [40, 40] });
    const own = links?.links[i] || {};
    const order = [...layerFiles.keys()].filter(x => x !== k).sort();
    const others = await Promise.all(order.map(x => own[x] ? getLayer(x).then(od => [x, od, own[x]]) : [x, null, null]));
    if (!alive || selected?.k !== k || selected.i !== i) return;
    const body = html(`<div>
      <div class="prop"><b>census division:</b> ${esc(f.cd)}</div>
      <div class="prop"><b>province:</b> ${esc(f.pr)}</div>
      <div class="prop"><b>TCP id:</b> ${esc(f.id)}</div>
      <div class="prop"><b>area:</b> ${f.km2.toLocaleString()} km²</div>
      <div class="prop"><b>layer:</b> ${esc(d.layer)} (${esc(d.table)})</div>
      ${f.hex ? `<div class="prop"><b>shape:</b> a placeholder hexagon; TCP knows where the settlement was but not its boundaries</div>` : ""}
      ${f.name.toUpperCase() === NO_DATA ? `<div class="prop"><b>note:</b> not enumerated in this census</div>` : ""}
      <h3>In other censuses</h3>
      <div class="muted" style="margin-bottom:6px">Subdivisions overlapping this one. The first figure is the share of this subdivision they cover, the second the share of theirs inside it; 100% / 100% is the same area. Click one to go to it.</div>
      ${others.map(([x, od, list]) => `<div style="margin-top:8px"><b style="font-size:12px">${esc(keyLabel(x))}</b>${
        !list ? `<div class="row muted">${links ? "no overlap" : "links not published"}</div>` :
        list.slice(0, 12).map(([j, sa, sb]) => `<div class="row click" data-k="${esc(x)}" data-i="${j}">${esc(od.features[j].name)}
          <span class="muted">· ${esc(od.features[j].cd)} · ${pct(sa)} / ${pct(sb)}</span></div>`).join("") +
        (list.length > 12 ? `<div class="muted">…and ${list.length - 12} more</div>` : "")}</div>`).join("")}
    </div>`);
    body.querySelectorAll("[data-i]").forEach(el => el.onclick = () => goTo(el.dataset.k, +el.dataset.i));
    panel.open(f.name, `census subdivision · ${esc(keyLabel(k))}`, body);
  }
  const pct = x => x >= 0.995 ? "100%" : x < 0.01 ? "<1%" : Math.round(x * 100) + "%";

  // Show another layer's subdivision: switch the census by hand and move the slider to its year
  function goTo(k, i) {
    follow = false; chosenCensus = k.slice(0, 4);
    if (k.length > 4 || k === "1911") variant = k.length > 4 ? k.slice(5) : "";
    ctl.querySelector(`input[name=hbCensus][value="${chosenCensus}"]`).checked = true;
    ctl.querySelector(`input[name=hbVariant][value="${variant}"]`).checked = true;
    year = keyYear(k); q("slider").value = year;
    drawHacolp(); drawCsd();
    select(k, i, { fit: true });
  }

  function drawSelection(d) {
    highlight?.remove(); highlight = null;
    if (!selected || !d) return;
    highlight = L.polygon(shapeOf(selected.k, d, selected.i), { renderer: selRenderer, pane: "hbSel", interactive: false,
      color: colors.accent, weight: 3, fill: true, fillColor: colors.accent, fillOpacity: 0.12 }).addTo(map);
  }

  return () => {
    alive = false;
    hacolpLayer?.remove(); csdLayer?.remove(); highlight?.remove();
  };
}
