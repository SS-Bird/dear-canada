// The flag / correction form shown in the right-hand panel of the places map.
import { esc, fold, html } from "./util.js";
import { KINDS, PLACE_TYPES, saveFlag, discardLocal, isLocal, isPublished } from "./flags.js";
import { bookTitle } from "./books.js";

const FIELDS_FOR = {
  wrong_location: ["name", "coords", "type"],
  no_location: ["name", "coords", "type"],
  not_a_place: [],
  wrong_type: ["type"],
  other: [],
};

/**
 * rows: the mentions of the selected map group; mention: one row when flagging a single mention;
 * existing: a flag to edit; suggestions: Map(folded name → {name, lat, lon, type});
 * pick(cb): start picking a point on the map, cb({lat, lng}); onClose(saved).
 */
export function flagForm({ rows, mention, existing, suggestions, pick, onClose }) {
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
  const showFields = () => {
    const show = new Set(FIELDS_FOR[$("kind").value]);
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
  el.querySelector("[data-a=cancel]").onclick = () => onClose(false);
  el.querySelector("[data-a=dismiss]")?.addEventListener("click", () => { saveFlag({ ...f, ...values(), status: "dismissed" }); onClose(true); });
  el.querySelector("[data-a=discard]")?.addEventListener("click", () => { discardLocal(f.id); onClose(true); });

  function values() {
    const v = Object.fromEntries(["kind", "correct_name", "latitude", "longitude", "place_type", "note"].map(n => [n, $(n).value.trim()]));
    const show = new Set(FIELDS_FOR[v.kind]);
    if (!show.has("name")) v.correct_name = "";
    if (!show.has("coords")) v.latitude = v.longitude = "";
    if (!show.has("type")) v.place_type = "";
    v.scope = el.querySelector("input[name=scope]:checked")?.value || "all";
    return {
      ...v, id: f.id, place, current_match: current,
      book: v.scope === "all" ? "" : v.scope === "mention" ? (mention?.book || f.book) : $("book").value,
      mention_id: v.scope === "mention" ? mentionId : "",
    };
  }

  el.onsubmit = e => {
    e.preventDefault();
    const status = e.submitter?.dataset.status || "open";
    const v = values();
    const lat = parseFloat(v.latitude), lon = parseFloat(v.longitude);
    if ((v.latitude || v.longitude) && !(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) { msg.textContent = "Coordinates must be decimal degrees (latitude −90 to 90, longitude −180 to 180)."; return; }
    if (status === "resolved") {
      if (FIELDS_FOR[v.kind].includes("coords") && !v.latitude && !v.correct_name) { msg.textContent = "To resolve, give coordinates or a place name — or save it as an open flag."; return; }
      if (v.kind === "wrong_type" && !v.place_type) { msg.textContent = "Choose the correct place type."; return; }
    }
    v.resolution = status !== "resolved" ? "" : v.kind === "not_a_place" ? "removed from the map"
      : v.kind === "wrong_type" ? `type → ${v.place_type}`
      : v.kind === "other" ? "" : `→ ${[v.correct_name, v.latitude && `${v.latitude}, ${v.longitude}`].filter(Boolean).join(" · ")}`;
    saveFlag({ ...v, status });
    onClose(true);
  };
  return el;
}
