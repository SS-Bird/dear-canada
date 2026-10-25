import { $, esc, fmtBytes } from "./util.js";
import { loadManifest } from "./data.js";
import * as places from "./projects/places.js";
import * as network from "./projects/network.js";
import { renderFlags } from "./flagsPage.js";

// A project is a module exporting mount(ctx) → cleanup function.
// To add one: write js/projects/<name>.js, import it here, and add a link in index.html.
const PROJECTS = { places, network };
const CANADA = [[41.5, -141], [70, -52]];

// ───────────── basemap (always present behind everything)
const map = L.map("map", { zoomControl: false, preferCanvas: true, worldCopyJump: true, minZoom: 2 });
map.fitBounds(CANADA);
L.control.zoom({ position: "topright" }).addTo(map);
// Esri Light Gray Canvas: plain, light, no API key. Base and labels are separate tile layers.
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";
L.tileLayer(ESRI + "World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 16, attribution: "Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
}).addTo(map);
L.tileLayer(ESRI + "World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, pane: "shadowPane" }).addTo(map);
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
    if (kind === "flags") await showFlags(manifest);
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
