// The notebook: nodes, the (undirected) links between them, and the compiled assignment.
// Saved to data/notebook.json through server.py, or to this browser's localStorage when the
// site is served without it.
import { plain, squash } from "./util.js";
import { SEED_COLLEGES } from "./types.js";

const API = "api/notebook";
const LS_KEY = "privateWeb.notebook";
const RESCUE_KEY = "privateWeb.notebook.unsaved";

export const now = () => new Date().toISOString();
export const uid = p => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

let data = null;
export let mode = "local"; // "server" | "local"
let timer = null, saving = false, again = false, blocked = false;
const listeners = new Set(), statusListeners = new Set(), selectListeners = new Set();

export const status = { state: "loading", at: null, msg: "" };
function setStatus(state, msg = "") {
  Object.assign(status, { state, msg, at: state === "saved" ? now() : status.at });
  statusListeners.forEach(f => f(status));
}
export const onStatus = f => (statusListeners.add(f), () => statusListeners.delete(f));
/** Called after every change, with what kind of change it was ("nodes", "links", "assignment", "all"). */
export const onChange = f => (listeners.add(f), () => listeners.delete(f));

function empty() {
  const t = now();
  const nodes = {};
  for (const title of SEED_COLLEGES) { const id = uid("college"); nodes[id] = { id, type: "college", title, body: "", created: t, updated: t }; }
  return { version: 2, rev: 0, nodes, links: [], assignment: { title: "", updated: t } };
}

function normalise(d) {
  d.nodes ||= {}; d.links ||= [];
  const a = d.assignment ||= { title: "" };
  if (!a.sections) { // version 1 had one list of paragraphs: it becomes the first section
    const t = now();
    a.sections = [{ id: uid("sec"), title: "", created: t, updated: t, blocks: a.blocks || [] }];
    delete a.blocks;
  }
  d.version = 2;
  return d;
}

export async function load() {
  try {
    const r = await fetch(API, { cache: "no-store" });
    if (r.status === 204) { data = empty(); mode = "server"; schedule(); } // server running, no file yet
    else if (r.ok && (r.headers.get("content-type") || "").includes("json")) { data = await r.json(); mode = "server"; }
    else throw new Error("no server");
  } catch {
    mode = "local";
    try { data = JSON.parse(localStorage.getItem(LS_KEY)); } catch { data = null; }
    data ||= empty();
  }
  normalise(data);
  setStatus("saved");
  return data;
}

/** Swap in a whole notebook (import). Keeps the server's revision so the save is accepted. */
export function replaceAll(d) {
  const rev = data.rev;
  data = normalise(d); data.rev = rev;
  changed("all");
}

export const raw = () => data;

// ───────────── saving
function changed(kind) {
  listeners.forEach(f => f(kind));
  schedule();
}
function schedule() {
  if (blocked) return;
  setStatus("pending");
  clearTimeout(timer);
  timer = setTimeout(save, 500);
}
export const hasPending = () => status.state === "pending" || status.state === "saving";

async function save() {
  timer = null;
  if (saving) { again = true; return; }
  saving = true; again = false;
  setStatus("saving");
  try {
    if (mode === "server") {
      const r = await fetch(API, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (r.status === 409) {
        blocked = true;
        localStorage.setItem(RESCUE_KEY, JSON.stringify(data));
        setStatus("error", "The notebook was saved from another tab. Reload to see it; edits from this tab were kept in this browser (Export → Restore unsaved edits).");
        return;
      }
      if (!r.ok) throw new Error(`The server answered ${r.status}.`);
      data.rev = (await r.json()).rev;
    } else localStorage.setItem(LS_KEY, JSON.stringify(data));
    setStatus("saved");
  } catch (e) {
    try { localStorage.setItem(RESCUE_KEY, JSON.stringify(data)); } catch { /* full */ }
    setStatus("error", `Not saved: ${e.message} A copy is kept in this browser; it will save again on your next edit.`);
  } finally {
    saving = false;
    if (again) save();
  }
}
export const rescued = () => { try { return JSON.parse(localStorage.getItem(RESCUE_KEY)); } catch { return null; } };
export const clearRescue = () => localStorage.removeItem(RESCUE_KEY);

// ───────────── nodes + links
export const get = id => data.nodes[id];
export const nodes = () => Object.values(data.nodes);
export const links = () => data.links;

export function createNode(type, fields = {}) {
  const t = now();
  const n = { id: uid(type), type, title: "", body: "", created: t, updated: t, ...fields };
  data.nodes[n.id] = n;
  if (type === "locref") syncRefs();
  changed("nodes");
  return n;
}

export function updateNode(id, patch) {
  const n = data.nodes[id];
  if (!n) return;
  Object.assign(n, patch, { updated: now() });
  if (n.type === "locref" && ("blockId" in patch || "quote" in patch)) syncRefs();
  changed("nodes");
}

/** Star or unstar a node. Not counted as an update to it. */
export function setStar(id, on) {
  const n = data.nodes[id];
  if (!n) return;
  if (on) n.starred = true; else delete n.starred;
  changed("nodes");
}

export function deleteNode(id) {
  delete data.nodes[id];
  data.links = data.links.filter(l => l.a !== id && l.b !== id);
  changed("all");
}

const linkBetween = (a, b) => data.links.find(l => (l.a === a && l.b === b) || (l.a === b && l.b === a));

export function link(a, b) {
  if (a === b || !data.nodes[a] || !data.nodes[b] || linkBetween(a, b)) return;
  const t = now();
  data.links.push({ id: uid("link"), a, b, created: t });
  data.nodes[a].updated = data.nodes[b].updated = t;
  changed("links");
}

export function unlink(a, b) {
  const l = linkBetween(a, b);
  if (!l) return;
  data.links = data.links.filter(x => x !== l);
  const t = now();
  data.nodes[a] && (data.nodes[a].updated = t);
  data.nodes[b] && (data.nodes[b].updated = t);
  changed("links");
}

export const neighbours = id => data.links
  .flatMap(l => l.a === id ? [l.b] : l.b === id ? [l.a] : [])
  .map(x => data.nodes[x]).filter(Boolean);

// ───────────── compiled assignment
// The assignment is a list of sections, each a list of paragraphs ("blocks") with ids that last
// through edits. A location reference points at a block id plus the words it quotes, and keeps
// a snapshot of the block so the passage survives if the block (or its section) is deleted.
export const assignment = () => data.assignment;
export const sections = () => data.assignment.sections;
export const section = id => data.assignment.sections.find(x => x.id === id);
export const allBlocks = () => data.assignment.sections.flatMap(x => x.blocks);
/** "Introduction", or "Section 2" while it has no title. */
export const sectionName = sec => sec.title || `Section ${sections().indexOf(sec) + 1}`;

function findBlock(id) {
  for (const sec of data.assignment.sections) {
    const i = sec.blocks.findIndex(b => b.id === id);
    if (i >= 0) return { sec, i, b: sec.blocks[i] };
  }
  return null;
}
export const blockOf = r => r?.blockId ? findBlock(r.blockId)?.b || null : null;
/** Where a block sits: { section, index } with index counted from 1 within its section. */
export function whereIs(blockId) {
  const f = findBlock(blockId);
  return f && { section: f.sec, index: f.i + 1 };
}
const touchAsg = (sec, t = now()) => { if (sec) sec.updated = t; data.assignment.updated = t; };

export function setAssignmentTitle(title) {
  data.assignment.title = title;
  touchAsg();
  changed("section-title");
}

export function addSection(title = "") {
  const t = now();
  const sec = { id: uid("sec"), title, created: t, updated: t, blocks: [] };
  sections().push(sec);
  touchAsg();
  changed("assignment");
  return sec;
}
/** Typing a title: views that would re-render on it listen for "section-title" separately. */
export function renameSection(id, title) {
  const sec = section(id);
  if (!sec || sec.title === title) return;
  sec.title = title;
  touchAsg(sec);
  changed("section-title");
}
export function moveSection(id, dir) {
  const ss = sections(), i = ss.findIndex(x => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= ss.length) return;
  [ss[i], ss[j]] = [ss[j], ss[i]];
  touchAsg();
  changed("assignment");
}
export function deleteSection(id) {
  data.assignment.sections = sections().filter(x => x.id !== id);
  touchAsg();
  syncRefs();
  changed("assignment");
}

export function insertBlock(sectionId, afterId, text = "") {
  const sec = section(sectionId);
  if (!sec) return null;
  const t = now();
  const b = { id: uid("p"), text, created: t, updated: t };
  const i = afterId ? sec.blocks.findIndex(x => x.id === afterId) : sec.blocks.length - 1;
  sec.blocks.splice(i + 1, 0, b);
  touchAsg(sec, t);
  changed("assignment");
  return b;
}

/** While typing: store the text without splitting or re-matching references. */
export function setBlockText(id, text) {
  const f = findBlock(id);
  if (!f || f.b.text === text) return;
  f.b.text = text;
  f.b.updated = now();
  touchAsg(f.sec, f.b.updated);
  changed("assignment-text");
}

/** When a block loses focus: a blank line splits it, an empty block is removed, references follow their words. */
export function commitBlock(id) {
  const f = findBlock(id);
  if (!f) return [];
  const bs = f.sec.blocks, i = f.i;
  const parts = bs[i].text.split(/\n[ \t]*\n/).map(x => x.trim()).filter(Boolean);
  const t = now();
  let made = [];
  if (!parts.length) bs.splice(i, 1);
  else {
    if (bs[i].text !== parts[0]) { bs[i].text = parts[0]; bs[i].updated = t; }
    made = parts.slice(1).map(text => ({ id: uid("p"), text, created: t, updated: t }));
    bs.splice(i + 1, 0, ...made);
  }
  touchAsg(f.sec, t);
  syncRefs();
  changed("assignment");
  return made;
}

export function deleteBlock(id) {
  const f = findBlock(id);
  if (!f) return;
  f.sec.blocks.splice(f.i, 1);
  touchAsg(f.sec);
  syncRefs();
  changed("assignment");
}

/** Bring every location reference up to date with the assignment. */
export function syncRefs() {
  const blocks = allBlocks();
  const byId = new Map(blocks.map(b => [b.id, b]));
  for (const r of Object.values(data.nodes)) {
    if (r.type !== "locref" || !r.blockId) continue;
    let b = byId.get(r.blockId);
    const q = squash(r.quote);
    // The block is gone or no longer has the quoted words: follow the words if exactly one block has them.
    if (q && (!b || !plain(b.text).includes(q))) {
      const hits = blocks.filter(x => plain(x.text).includes(q));
      if (hits.length === 1) { b = hits[0]; r.blockId = b.id; }
    }
    if (b) {
      if (r.snapshot !== b.text) { r.snapshot = b.text; r.snapshotAt = now(); }
      r.removedAt = null;
    } else if (!r.removedAt) r.removedAt = now();
  }
}

/** "unanchored" | "live" | "edited" (paragraph is there, quoted words are not) | "removed". */
export function refStatus(r) {
  if (!r.blockId) return "unanchored";
  const b = blockOf(r);
  if (!b) return "removed";
  return r.quote && !plain(b.text).includes(squash(r.quote)) ? "edited" : "live";
}

// ───────────── selection (shared by the views and the right-hand editor)
export const ui = { selected: null, anchoring: null };
export function select(id) {
  ui.selected = id;
  selectListeners.forEach(f => f(id));
}
export const onSelect = f => (selectListeners.add(f), () => selectListeners.delete(f));
