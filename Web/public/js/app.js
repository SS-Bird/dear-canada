import { $, esc, fmtBytes } from "./util.js";
import { loadManifest, fetchDataset } from "./data.js";
import * as places from "./projects/places.js";
import * as network from "./projects/network.js";
import * as historical from "./projects/historical.js";
import { renderFlags } from "./flagsPage.js";
import { renderDataMap } from "./dataMap.js";

// A project is a module exporting mount(ctx) → cleanup function.
// To add one: write js/projects/<name>.js, import it here, and add a link in index.html.
const PROJECTS = { places, network, historical };
const CANADA = [[41.5, -141], [70, -52]];

// ───────────── basemap (always present behind everything)
// Two projections. Web Mercator is what most tiles come in, but it stretches the north (the Arctic
// islands look larger than the prairies). Canada Atlas Lambert (EPSG:3978, the projection NRCan and
// Statistics Canada use) keeps Canada's shapes and areas close to true; its tiles are NRCan's and stop
// a little beyond Canada. Every overlay is vector data, so it follows either projection.
const LAMBERT = new L.Proj.CRS("EPSG:3978",
  "+proj=lcc +lat_0=49 +lon_0=-95 +lat_1=49 +lat_2=77 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", {
    origin: [-34655800, 39310000], // NRCan's tile grid
    resolutions: [38364.660062653464, 22489.62831258996, 13229.193125052918, 7937.5158750317505, 4630.2175937685215,
      2645.8386250105837, 1587.5031750063501, 926.0435187537042, 529.1677250021168, 317.50063500127004,
      185.20870375074085, 111.12522225044451, 66.1459656252646, 38.36466006265346, 22.48962831258996,
      13.229193125052918, 7.9375158750317505, 4.6302175937685215],
  });
{ // The projection is undefined at the South Pole; nothing the books mention is that far south
  const p = LAMBERT.projection, project = p.project.bind(p);
  p.project = ll => project(L.latLng(Math.max(-60, ll.lat), ll.lng));
}
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
const NRCAN = "https://maps-cartes.services.geo.ca/server2_serveur2/rest/services/BaseMaps/";
const ESRI_ATTR = "Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors";
const NRCAN_ATTR = "Basemap &copy; Natural Resources Canada (Open Government Licence – Canada)";
const esri = (path, o = {}) => [ESRI + path + "/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, attribution: ESRI_ATTR, ...o }];
const nrcan = path => [NRCAN + path + "/MapServer/tile/{z}/{y}/{x}", { maxZoom: 17, attribution: NRCAN_ATTR }];
const BASEMAPS = {
  "gray-labels": { group: "mercator", label: "Light grey, with labels", tiles: [esri("Canvas/World_Light_Gray_Base"),
    esri("Canvas/World_Light_Gray_Reference", { pane: "shadowPane", attribution: "" })] },
  "gray": { group: "mercator", label: "Light grey", tiles: [esri("Canvas/World_Light_Gray_Base")] },
  "positron": { group: "mercator", label: "Positron (CARTO)", tiles: [["https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
    { maxZoom: 19, subdomains: "abcd", attribution: "&copy; OpenStreetMap contributors &copy; CARTO" }]] },
  "relief": { group: "mercator", label: "Shaded relief", tiles: [esri("World_Shaded_Relief", { maxZoom: 13 })] },
  "plain": { group: "mercator", label: "No base map", tiles: [] },
  "l-relief": { group: "lambert", label: "Relief (NRCan)", tiles: [nrcan("CBME_CBCE_HS_RO_3978")] },
  "l-simple": { group: "lambert", label: "Simple grey, modern borders (NRCan)", tiles: [nrcan("Simple")] },
  "l-topo": { group: "lambert", label: "Roads and rivers (NRCan)", tiles: [nrcan("CBMT_CBCT_GEOM_3978")] },
  "l-plain": { group: "lambert", label: "No base map", tiles: [] },
};
const BASE_GROUPS = { mercator: "Web Mercator (stretches the north)", lambert: "Canada Lambert (true shapes)" };
const BASE_KEY = "dc.basemap";
let baseId = (() => { try { return localStorage.getItem(BASE_KEY); } catch { return null; } })();
if (!BASEMAPS[baseId]) baseId = "gray-labels";
const crsOf = id => BASEMAPS[id].group === "lambert" ? LAMBERT : L.CRS.EPSG3857;

const map = L.map("map", { zoomControl: false, preferCanvas: true, minZoom: 2, maxZoom: 17, crs: crsOf(baseId) });
map.fitBounds(CANADA);
L.control.zoom({ position: "topright" }).addTo(map);
let baseTiles = [];
function setBasemap(id) {
  baseId = id;
  try { localStorage.setItem(BASE_KEY, id); } catch {}
  baseTiles.forEach(t => t.remove());
  const crs = crsOf(id);
  if (map.options.crs !== crs) {
    // Every layer re-projects on the reset; the zoom levels of the two grids are about the same scale
    const c = map.getCenter(), z = map.getZoom();
    map.options.crs = crs;
    map.setView(c, z, { reset: true });
  }
  baseTiles = BASEMAPS[id].tiles.map(([url, o]) => L.tileLayer(url, o).addTo(map));
  map.getContainer().classList.toggle("plainBase", !baseTiles.length);
  map.getContainer().classList.toggle("nrcanBase", !!baseTiles.length && BASEMAPS[id].group === "lambert"); // blank tiles are white
  if (!baseTiles.length) showLand(); else land?.remove();
}
// Without tiles: land drawn from the site's own boundaries (Natural Earth, and HACOLP's latest Canada)
let land = null, landPromise = null;
function showLand() {
  landPromise ??= loadManifest().then(async m => {
    const ds = role => m.datasets.find(d => d.project === "places" && d.role === role);
    const [w, b] = await Promise.all([ds("world_boundaries") && fetchDataset(ds("world_boundaries")), ds("boundaries") && fetchDataset(ds("boundaries"))]);
    // Antarctica is left out: in the Lambert projection it wraps around the whole map
    const minLat = c => typeof c[0] === "number" ? c[1] : c.reduce((m, x) => Math.min(m, minLat(x)), Infinity);
    const geoms = (w?.features || []).map(f => f.g).filter(g => minLat(g.coordinates) > -60);
    if (b) { const last = b.years.map(Number).sort((x, y) => x - y).at(-1); geoms.push(...b.layers[last].map(f => b.geometries[f.g])); }
    if (!map.getPane("land")) map.createPane("land").style.zIndex = 150;
    const renderer = L.canvas({ pane: "land", padding: 0.3 });
    return L.layerGroup(geoms.map(g => L.polygon(L.GeoJSON.coordsToLatLngs(g.type === "Polygon" ? [g.coordinates] : g.coordinates, 2),
      { renderer, pane: "land", interactive: false, fillColor: "#f7f6f2", fillOpacity: 1, color: "#c9c6bd", weight: 0.5 })));
  }).catch(e => { console.warn("No land layer", e); landPromise = null; return null; });
  landPromise.then(l => { land = l; if (l && !baseTiles.length && !map.hasLayer(l)) l.addTo(map); });
}
const baseControl = L.control({ position: "topright" });
baseControl.onAdd = () => {
  const el = L.DomUtil.create("div", "leaflet-bar baseCtl");
  el.innerHTML = `<select aria-label="Base map" title="Base map">${Object.entries(BASE_GROUPS).map(([g, label]) =>
    `<optgroup label="${label}">${Object.entries(BASEMAPS).filter(([, b]) => b.group === g).map(([id, b]) =>
      `<option value="${id}"${id === baseId ? " selected" : ""}>${b.label}</option>`).join("")}</optgroup>`).join("")}</select>`;
  L.DomEvent.disableClickPropagation(el);
  el.firstElementChild.onchange = e => setBasemap(e.target.value);
  return el;
};
baseControl.addTo(map);
setBasemap(baseId);
new ResizeObserver(() => map.invalidateSize()).observe($("#center"));

// ───────────── right-hand detail column
const panel = {
  onClose: null,
  open(title, sub, body) {
    $("#rightTitle").textContent = title;
    $("#rightSub").innerHTML = sub || "";
    const b = $("#rightBody");
    if (typeof body === "string") b.innerHTML = body; else b.replaceChildren(body);
    $("#right").hidden = false;
  },
  /** Re-render the body without moving the scroll position. */
  update(body) {
    if ($("#right").hidden) return;
    const b = $("#rightBody");
    if (typeof body === "string") b.innerHTML = body; else b.replaceChildren(body);
  },
  get isOpen() { return !$("#right").hidden; },
  close() {
    if ($("#right").hidden) return;
    $("#right").hidden = true;
    const cb = panel.onClose; cb && cb();
  },
};
$("#rightClose").onclick = () => panel.close();

// ───────────── navigation
$("#navToggle").onclick = () => {
  const open = $("#nav").classList.toggle("open");
  $("#navToggle").setAttribute("aria-expanded", open);
};

let current = null; // { name, cleanup }

function switchProject(name, manifest, params = {}) {
  if (current?.name === name) return;
  if (current) { current.cleanup(); current = null; }
  panel.onClose = null; panel.close();
  $("#stage").replaceChildren();
  if (name) current = { name, cleanup: PROJECTS[name].mount({ map, stage: $("#stage"), panel, manifest, params }) || (() => {}) };
}

async function showPage(name) {
  const inner = $("#pageInner");
  try {
    const r = await fetch(`pages/${encodeURIComponent(name)}.html`);
    if (!r.ok) throw new Error();
    inner.innerHTML = await r.text();
  } catch {
    inner.innerHTML = `<h1>Not found</h1><p>There is no page called “${esc(name)}”.</p>`;
  }
  $("#page").hidden = false;
  $("#page").scrollTop = 0;
}

function showDataMap() {
  $("#pageInner").classList.add("wide");
  renderDataMap($("#pageInner"));
  $("#page").hidden = false;
  $("#page").scrollTop = 0;
}

async function showFlags(manifest) {
  $("#page").hidden = false;
  $("#page").scrollTop = 0;
  await renderFlags($("#pageInner"), manifest);
}

// TEMPORARY: preview of a synced data file.
function showData(id, manifest) {
  const ds = manifest?.datasets.find(d => d.id === id);
  const inner = $("#pageInner");
  if (!ds) inner.innerHTML = `<h1>Not found</h1><p>No dataset “${esc(id)}” in the manifest.</p>`;
  else {
    const cols = ds.columns.length ? ds.columns : Object.keys(ds.head[0] || {});
    inner.innerHTML = `
      <h1 style="font-size:28px;word-break:break-all">${esc(ds.name)}</h1>
      <div class="kicker">Uploaded data · ${esc(ds.project)}</div>
      <div class="meta">
        <span><b>${ds.rows ?? "?"}</b> rows</span><span><b>${cols.length}</b> columns</span>
        <span>${esc(ds.format.toUpperCase())} · ${fmtBytes(ds.bytes)}</span>
        <span>role: ${esc(ds.role)}</span>
        <span>modified ${esc(new Date(ds.modified).toLocaleString())}</span>
        <a href="${esc(ds.path)}" download>download</a>
      </div>
      <h2>First ${ds.head.length} rows</h2>
      <div class="tableWrap"><table class="head">
        <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
        <tbody>${ds.head.map(r => `<tr>${cols.map(c => `<td title="${esc(r[c])}">${esc(r[c])}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>`;
  }
  $("#page").hidden = false;
  $("#page").scrollTop = 0;
}

function renderDataList(manifest) {
  const byProject = d3.group(manifest.datasets, d => d.project);
  $("#dataList").innerHTML = [...byProject].map(([proj, list]) =>
    `<div class="grpLabel">${esc(proj)}</div>` +
    list.map(d => `<a href="#/data/${esc(d.id)}" data-route="data/${esc(d.id)}" title="${esc(d.name)} · ${d.rows ?? "?"} rows">&lrm;${esc(d.name)}&lrm;</a>`).join("")
  ).join("") || '<span class="navNote">Nothing synced yet.</span>';
  $("#dataSynced").textContent = "Synced " + new Date(manifest.synced).toLocaleString();
  highlightNav();
}

// "#/places?q=Highlands" → path "places", params { q: "Highlands" }
const currentPath = () => decodeURIComponent(location.hash.replace(/^#\/?/, "").split("?")[0]);
const currentParams = () => Object.fromEntries(new URLSearchParams(location.hash.split("?")[1] || ""));
function highlightNav() {
  const path = currentPath();
  document.querySelectorAll("#nav [data-route]").forEach(a => a.classList.toggle("active", a.dataset.route === path));
}

async function route() {
  const path = currentPath();
  const [kind, ...rest] = path.split("/");
  highlightNav();
  $("#nav").classList.remove("open");

  let manifest = null;
  try { manifest = await loadManifest(); } catch (e) { console.warn(e); }

  if (PROJECTS[kind]) {
    $("#page").hidden = true;
    switchProject(kind, manifest || { datasets: [] }, currentParams());
  } else {
    switchProject(null);
    $("#pageInner").classList.remove("wide");
    if (kind === "flags") await showFlags(manifest);
    else if (kind === "datamap") showDataMap();
    else if (kind === "page" && rest[0]) await showPage(rest[0]);
    else if (kind === "data") showData(rest.join("/"), manifest);
    else await showPage("home");
  }
}

window.addEventListener("hashchange", route);
route();
loadManifest().then(renderDataList).catch(e => {
  $("#dataList").innerHTML = `<span class="navNote">${esc(e.message)}</span>`;
});
