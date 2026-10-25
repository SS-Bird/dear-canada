// Flags and corrections for place mentions.
// The published table is place_corrections.csv (project "places", role "corrections"),
// kept in data/Gazetteers/curated/ and read by the matching notebook. Flags made on the
// site are kept in this browser until they are downloaded into that file and synced;
// after a sync, local copies identical to the published rows are dropped.
import { fold, parseCSV } from "./util.js";
import { fetchDataset } from "./data.js";

export const COLUMNS = ["id", "status", "kind", "scope", "book", "mention_id", "place", "current_match",
  "correct_name", "latitude", "longitude", "place_type", "note", "resolution", "created", "resolved", "updated"];

export const KINDS = {
  wrong_location: "Wrong location",
  no_location: "No location found",
  not_a_place: "Not a place",
  wrong_type: "Wrong place type",
  other: "Other issue",
};
export const STATUSES = { open: "Open", resolved: "Resolved", dismissed: "Dismissed" };
export const PLACE_TYPES = ["settlement", "region", "country", "water", "landform", "facility", "vessel"];
// The map's location_precision for a corrected place type
export const TYPE_PRECISION = { settlement: "settlement", region: "region", country: "country", water: "feature",
  landform: "feature", facility: "site", vessel: "site" };

const KEY = "dc.flags.v1";
let state = null; // { published: Map, local: Map }
const listeners = new Set();

function readLocal() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
function writeLocal() {
  try { localStorage.setItem(KEY, JSON.stringify([...state.local.values()])); }
  catch (e) { console.warn("Could not save flags in this browser", e); }
}
const same = (a, b) => COLUMNS.every(c => String(a[c] ?? "") === String(b[c] ?? ""));

export async function loadFlags(manifest) {
  if (state) return state;
  const ds = manifest?.datasets.find(d => d.project === "places" && d.role === "corrections");
  let rows = [];
  if (ds) try { rows = await fetchDataset(ds); } catch (e) { console.warn(e); }
  const published = new Map(rows.filter(r => r.id).map(r => [r.id, r]));
  const local = new Map();
  for (const f of readLocal()) if (!published.has(f.id) || !same(published.get(f.id), f)) local.set(f.id, f);
  state = { published, local, hasFile: !!ds };
  writeLocal();
  return state;
}

/** Every flag, local edits replacing their published version, newest first. */
export function allFlags() {
  if (!state) return [];
  const m = new Map(state.published);
  for (const [id, f] of state.local) m.set(id, f);
  return [...m.values()].sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
}
export const isLocal = id => !!state?.local.has(id);
export const isPublished = id => !!state?.published.has(id);
export const localCount = () => state?.local.size ?? 0;

export function onFlagsChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const changed = () => listeners.forEach(fn => fn());

export function saveFlag(f) {
  const now = new Date().toISOString().slice(0, 19) + "Z";
  const prev = allFlags().find(x => x.id === f.id);
  const out = Object.fromEntries(COLUMNS.map(c => [c, f[c] ?? ""]));
  out.id ||= "F" + now.replace(/\D/g, "").slice(2, 14) + Math.random().toString(36).slice(2, 5);
  out.created = prev?.created || now;
  out.resolved = out.status === "open" ? "" : (prev?.status === out.status && prev.resolved) || now;
  out.updated = now;
  state.local.set(out.id, out);
  writeLocal(); changed();
  return out;
}

/** Remove a flag made in this browser (or undo local edits to a published one). */
export function discardLocal(id) {
  state.local.delete(id); writeLocal(); changed();
}

/** Merge rows from a CSV file (e.g. downloaded on another computer); newer `updated` wins. */
export function importCSV(text) {
  let n = 0;
  for (const r of parseCSV(text)) {
    if (!r.id) continue;
    const cur = allFlags().find(x => x.id === r.id);
    if (cur && String(cur.updated) >= String(r.updated)) continue;
    state.local.set(r.id, Object.fromEntries(COLUMNS.map(c => [c, r[c] ?? ""]))); n++;
  }
  writeLocal(); changed();
  return n;
}

export function toCSV(flags) {
  const q = v => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const sorted = [...flags].sort((a, b) => String(a.created).localeCompare(String(b.created)) || a.id.localeCompare(b.id));
  return [COLUMNS.join(","), ...sorted.map(f => COLUMNS.map(c => q(f[c])).join(","))].join("\n") + "\n";
}

export function downloadCSV(flags = allFlags()) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([toCSV(flags)], { type: "text/csv" }));
  a.download = "place_corrections.csv";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Does a flag apply to this mention row? (mention > book > everywhere) */
export function flagApplies(f, r) {
  if (f.scope === "mention") return f.mention_id === r.mention_id;
  if (fold(f.place) !== fold(r.place)) return false;
  return f.scope === "all" || f.book === r.book;
}
const RANK = { mention: 3, book: 2, all: 1 };

/** Attach flags to rows and apply resolved corrections. Same rules as the matching notebook. */
export function applyFlags(rows, flags = allFlags()) {
  const byName = d3.group(flags.filter(f => f.scope !== "mention"), f => fold(f.place));
  const byMention = d3.group(flags.filter(f => f.scope === "mention"), f => f.mention_id);
  for (const r of rows) {
    const fs = [...(byMention.get(r.mention_id) || []), ...(byName.get(fold(r.place)) || [])].filter(f => flagApplies(f, r));
    r.flags = fs;
    r.flagOpen = fs.some(f => f.status === "open");
    // Broadest first, so a book or mention correction overrides an "every book" one
    const fixes = fs.filter(f => f.status === "resolved" && f.kind !== "other")
      .sort((a, b) => RANK[a.scope] - RANK[b.scope] || String(a.updated).localeCompare(String(b.updated)));
    for (const fix of fixes) {
      r.correction = fix;
      if (fix.kind === "not_a_place") { r.excluded = true; continue; }
      if (fix.place_type) { r.place_type = fix.place_type; r.location_precision = TYPE_PRECISION[fix.place_type] || r.location_precision; }
      const lat = parseFloat(fix.latitude), lon = parseFloat(fix.longitude);
      if (isFinite(lat) && isFinite(lon)) {
        r.excluded = false; r.lat = lat; r.lon = lon; r.historicity = true;
        r.matched_name = fix.correct_name || r.place;
        r.region_historical = ""; r.region_modern = ""; r.country = "";
        r.resolution_status = "corrected";
      } else if (fix.correct_name) {
        r.excluded = false; r.matched_name = fix.correct_name; // a region name with no point still fills its polygon
        r.resolution_status = "corrected";
      }
    }
  }
  return rows;
}
