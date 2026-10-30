// The flag / correction form shown in the right-hand panel of the places map.
import { esc, fold, html } from "./util.js";
import { KINDS, PLACE_TYPES, NO_CSD, saveFlag, discardLocal, isLocal, isPublished } from "./flags.js";
import { csdAt, csdText } from "./census.js";
import { bookTitle } from "./books.js";

const FIELDS_FOR = {
  wrong_location: ["name", "coords", "type", "csd"],
  no_location: ["name", "coords", "type", "csd"],
  not_a_place: [],
  wrong_type: ["type"],
  wrong_csd: ["csd"],
  other: [],
};

/**
 * rows: the mentions of the selected map group; mention: one row when flagging a single mention;
 * existing: a flag to edit; suggestions: Map(folded name → {name, lat, lon, type});
 * pick(cb): start picking a point on the map, cb({lat, lng}); onClose(saved).
 * census: { years, year (the default census), load(year) → Promise of a layer (js/census.js), show(geometry | null) }
 * to choose a census subdivision; without it the subdivision fields are hidden.
 */
export function flagForm({ rows, mention, existing, suggestions, pick, census, onClose }) {
  const f = existing || {};
  const books = [...new Set(rows.map(r => r.book))];
  const places = d3.rollups(rows, v => v.length, r => r.place).sort((a, b) => b[1] - a[1]).map(d => d[0]);
  const place = f.place || mention?.place || places[0];
  const book = f.book || mention?.book || books[0];
  const r0 = mention || rows[0];
  const current = f.current_match || (r0.located || r0.reg
    ? [r0.matched_name || r0.place, isFinite(r0.lat) ? `${r0.lat.toFixed(3)}, ${r0.lon.toFixed(3)}` : r0.reg ? "region" : ""].filter(Boolean).join(" · ")
    : "unmatched");
  const scope = f.scope || (mention ? "mention" : books.length > 1 ? "all" : "book");
  const kind = f.kind || (r0.located || r0.reg ? "wrong_location" : "no_location");
  const csdYear = +(f.csd_year || census?.year || 0);
  const mentionId = f.mention_id || mention?.mention_id || "";

  const el = html(`<form class="flagForm" autocomplete="off">
    <h3>${existing ? "Edit flag" : "Flag or correct"} “${esc(place)}”</h3>
    <div class="muted">Currently: ${esc(current)}</div>
    <label>What's wrong
      <select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}"${k === kind ? " selected" : ""}>${v}</option>`).join("")}</select>
    </label>
    <fieldset><legend>Applies to</legend>
      ${mentionId ? `<label class="chip"><input type="radio" name="scope" value="mention"${scope === "mention" ? " checked" : ""}><span class="label">This mention only (entry ${esc(mention?.entry_id || mentionId)})</span></label>` : ""}
      <label class="chip"><input type="radio" name="scope" value="book"${scope === "book" ? " checked" : ""}><span class="label">“${esc(place)}” in</span></label>
      <select name="book" class="indent">${books.concat(books.includes(book) ? [] : [book]).map(b => `<option value="${esc(b)}"${b === book ? " selected" : ""}>${esc(bookTitle(b))}</option>`).join("")}</select>
      <label class="chip"><input type="radio" name="scope" value="all"${scope === "all" ? " checked" : ""}><span class="label">“${esc(place)}” in every book</span></label>
    </fieldset>
    <div data-f="name"><label>Correct place
      <input type="text" name="correct_name" list="flagSuggest" value="${esc(f.correct_name || "")}" placeholder="e.g. Scottish Highlands">
      <datalist id="flagSuggest">${[...suggestions.values()].map(s => `<option value="${esc(s.name)}">`).join("")}</datalist>
    </label><div class="muted">Pick a known place to fill in its coordinates. A province or colony name (Upper Canada…) fills its region.</div></div>
    <div data-f="coords"><div class="coordRow">
      <label>Latitude <input type="text" name="latitude" inputmode="decimal" value="${esc(f.latitude || "")}"></label>
      <label>Longitude <input type="text" name="longitude" inputmode="decimal" value="${esc(f.longitude || "")}"></label>
      <button type="button" data-a="pick" title="Click the map to set the coordinates">Pick on map</button>
    </div></div>
    <div data-f="csd"><label>Census subdivision
      <div class="coordRow">
        <select name="csd_year" aria-label="Census">${(census?.years || []).map(y => `<option${y === csdYear ? " selected" : ""}>${y}</option>`).join("")}</select>
        <input type="text" name="csd_name" list="csdSuggest" placeholder="Type a name…" style="flex:1 1 auto;min-width:0">
        <button type="button" data-a="pickCsd" title="Click the map to choose the subdivision there">Pick on map</button>
      </div>
      <datalist id="csdSuggest"></datalist>
    </label>
    <label class="chip"><input type="checkbox" name="csd_none"${f.csd_id === NO_CSD ? " checked" : ""}><span class="label">No subdivision (draw it as a dot)</span></label>
    <div class="muted" data-a="csdInfo">Optional for a new location. A subdivision chosen here is always filled, whatever its size.</div></div>
    <div data-f="type"><label>Place type
      <select name="place_type"><option value="">(unchanged)</option>${PLACE_TYPES.map(t => `<option${t === f.place_type ? " selected" : ""}>${t}</option>`).join("")}</select>
    </label></div>
    <label>Note <textarea name="note" rows="3" placeholder="Why, sources, what still needs checking…">${esc(f.note || "")}</textarea></label>
    <div class="formMsg" data-a="msg"></div>
    <div class="btnRow">
      <button type="submit" class="primary" data-status="resolved">Save as resolved</button>
      <button type="submit" data-status="open">Save as open flag</button>
    </div>
    <div class="btnRow">
      ${existing && f.status !== "dismissed" ? `<button type="button" data-a="dismiss">Dismiss</button>` : ""}
      ${existing && isLocal(f.id) ? `<button type="button" data-a="discard">${isPublished(f.id) ? "Undo local edits" : "Delete"}</button>` : ""}
      <button type="button" data-a="cancel">Cancel</button>
    </div>
  </form>`);

  const $ = n => el.elements[n];
  const msg = el.querySelector("[data-a=msg]");
  const fieldsFor = k => FIELDS_FOR[k].filter(x => x !== "csd" || census?.years.length);
  const showFields = () => {
    const show = new Set(fieldsFor($("kind").value));
    el.querySelectorAll("[data-f]").forEach(d => d.hidden = !show.has(d.dataset.f));
  };
  showFields();
  $("kind").onchange = showFields;
  $("book").onchange = () => { el.querySelector("input[name=scope][value=book]").checked = true; };
  let autoFilled = false;
  $("correct_name").oninput = () => {
    const s = suggestions.get(fold($("correct_name").value));
    if (!s) return;
    if (isFinite(s.lat) && (autoFilled || !$("latitude").value)) { $("latitude").value = s.lat; $("longitude").value = s.lon; autoFilled = true; }
    if (s.type && !$("place_type").value) $("place_type").value = s.type;
  };
  el.querySelector("[data-a=pick]").onclick = () => {
    msg.textContent = "Click the map to place the point…";
    pick(ll => {
      $("latitude").value = ll.lat.toFixed(4); $("longitude").value = ll.lng.toFixed(4);
      autoFilled = false; msg.textContent = "";
    });
  };

  // ── census subdivision: a name from the chosen census, or the one under a point picked on the map
  let csd = f.csd_id && f.csd_id !== NO_CSD ? { year: csdYear, id: f.csd_id } : null, layer = null, labels = new Map();
  const csdInfo = el.querySelector("[data-a=csdInfo]");
  const showCsd = () => {
    const ft = csd && layer && layer.year === csd.year ? layer.features[layer.byId.get(csd.id)] : null;
    if (ft) csdInfo.textContent = `${csdText(ft)} · census of ${csd.year} · ${Math.round(ft.km2).toLocaleString()} km² · TCP ${ft.id}`;
    census?.show(ft && !$("csd_none").checked ? layer.geometries[layer.byId.get(csd.id)] : null);
  };
  async function loadYear(keep) {
    const y = +$("csd_year").value;
    if (!census || !y) return;
    try { layer = await census.load(y); } catch (e) { csdInfo.textContent = e.message; return; }
    if (+$("csd_year").value !== y) return;
    // Datalist labels are unique: "Name (division, province)", with the TCP id when that repeats
    labels = new Map(); const seen = d3.rollup(layer.features, v => v.length, ft => csdText(ft));
    layer.features.forEach((ft, i) => { if (ft.name !== "NO DATA") labels.set(seen.get(csdText(ft)) > 1 ? `${csdText(ft)} [${ft.id}]` : csdText(ft), i); });
    el.querySelector("#csdSuggest").innerHTML = [...labels.keys()].sort().map(l => `<option value="${esc(l)}">`).join("");
    if (!keep) csd = null;
    const i = csd ? layer.byId.get(csd.id) : undefined;
    $("csd_name").value = i == null ? "" : [...labels].find(([, j]) => j === i)?.[0] || csdText(layer.features[i]);
    showCsd();
  }
  if (census?.years.length) loadYear(true);
  $("csd_year").onchange = () => loadYear(false);
  $("csd_name").oninput = () => {
    const i = labels.get($("csd_name").value);
    if (i == null) return;
    csd = { year: layer.year, id: layer.features[i].id }; $("csd_none").checked = false; showCsd();
  };
  $("csd_none").onchange = showCsd;
  el.querySelector("[data-a=pickCsd]").onclick = () => {
    msg.textContent = "Click the map inside the subdivision…";
    pick(ll => {
      msg.textContent = "";
      const i = layer ? csdAt(layer, ll.lat, ll.lng) : -1;
      if (i < 0 || layer.features[i].name === "NO DATA") { msg.textContent = `No enumerated subdivision there in the census of ${layer?.year}.`; return; }
      csd = { year: layer.year, id: layer.features[i].id }; $("csd_none").checked = false;
      $("csd_name").value = [...labels].find(([, j]) => j === i)?.[0] || csdText(layer.features[i]);
      showCsd();
    });
  };

  el.querySelector("[data-a=cancel]").onclick = () => onClose(false);
  el.querySelector("[data-a=dismiss]")?.addEventListener("click", () => { saveFlag({ ...f, ...values(), status: "dismissed" }); onClose(true); });
  el.querySelector("[data-a=discard]")?.addEventListener("click", () => { discardLocal(f.id); onClose(true); });

  function values() {
    const v = Object.fromEntries(["kind", "correct_name", "latitude", "longitude", "place_type", "note"].map(n => [n, $(n).value.trim()]));
    const show = new Set(fieldsFor(v.kind));
    if (!show.has("name")) v.correct_name = "";
    if (!show.has("coords")) v.latitude = v.longitude = "";
    if (!show.has("type")) v.place_type = "";
    const none = show.has("csd") && $("csd_none").checked;
    v.csd_year = none || !show.has("csd") || !csd ? "" : String(csd.year);
    v.csd_id = none ? NO_CSD : show.has("csd") && csd ? csd.id : "";
    v.scope = el.querySelector("input[name=scope]:checked")?.value || "all";
    return {
      ...v, id: f.id, place, current_match: current,
      book: v.scope === "all" ? "" : v.scope === "mention" ? (mention?.book || f.book) : $("book").value,
      mention_id: v.scope === "mention" ? mentionId : "",
    };
  }

  function csdResolution(v) {
    if (v.csd_id === NO_CSD) return "no census subdivision";
    if (!v.csd_id) return "";
    const ft = layer?.year === +v.csd_year ? layer.features[layer.byId.get(v.csd_id)] : null;
    return `subdivision ${ft ? ft.name : v.csd_id} (${v.csd_year})`;
  }

  el.onsubmit = e => {
    e.preventDefault();
    const status = e.submitter?.dataset.status || "open";
    const v = values();
    const num = x => x === "" ? NaN : Number(x); // not parseFloat: "8°31′15″S" would read as 8
    const lat = num(v.latitude), lon = num(v.longitude);
    if ((v.latitude || v.longitude) && !(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) { msg.textContent = "Coordinates must be decimal degrees (latitude −90 to 90, longitude −180 to 180)."; return; }
    if (status === "resolved") {
      if (FIELDS_FOR[v.kind].includes("coords") && !v.latitude && !v.correct_name) { msg.textContent = "To resolve, give coordinates or a place name — or save it as an open flag."; return; }
      if (v.kind === "wrong_type" && !v.place_type) { msg.textContent = "Choose the correct place type."; return; }
      if (v.kind === "wrong_csd" && !v.csd_id) { msg.textContent = "Choose a subdivision, or tick “No subdivision”."; return; }
    }
    v.resolution = status !== "resolved" ? "" : v.kind === "not_a_place" ? "removed from the map"
      : v.kind === "wrong_type" ? `type → ${v.place_type}`
      : v.kind === "other" ? "" : `→ ${[v.correct_name, v.latitude && `${v.latitude}, ${v.longitude}`, csdResolution(v)].filter(Boolean).join(" · ")}`;
    saveFlag({ ...v, status });
    onClose(true);
  };
  return el;
}
