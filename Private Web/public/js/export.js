// Exports as Markdown: everything grouped by type, or the notebook read from each HC and LO
// outwards (for reading straight through, or for handing to an LLM to summarise).
import { esc, html, download, copy, fmtDay, squash } from "./util.js";
import * as store from "./store.js";
import { TYPES, TYPE_ORDER, nodeName, handbookLink } from "./types.js";
import { cite, noteState, withFootnotes, withInlineCites } from "./cite.js";

const byName = (a, b) => nodeName(a).localeCompare(nodeName(b), undefined, { numeric: true });
const quoteBlock = s => String(s || "").split("\n").map(l => "> " + l).join("\n");
const stamp = (n, opts) => opts.dates ? ` · created ${fmtDay(n.created)} · updated ${fmtDay(n.updated)}` : "";
const STATUS_NOTE = {
  edited: "The quoted words are no longer in this paragraph; it was probably reworded.",
  removed: "This paragraph has since been removed from the assignment; this is its last version.",
  unanchored: "Not attached to a passage of the assignment.",
};

function passage(r, cited) {
  const b = store.blockOf(r), st = store.refStatus(r);
  const out = [];
  if (r.quote) out.push(`Quoted words: “${squash(r.quote)}”`);
  const text = b ? b.text : r.snapshot;
  const at = b && store.whereIs(b.id);
  if (text) out.push(`${at ? `${store.sectionName(at.section)}, paragraph ${at.index}` : "Last version of the paragraph"}:\n\n${quoteBlock(withInlineCites(text, store.get, cited))}`);
  if (STATUS_NOTE[st]) out.push(`*${STATUS_NOTE[st]}*`);
  return out.join("\n\n");
}

/** The assignment with its sections as headings, citations as numbered footnotes, then a bibliography. */
export function assignmentMd({ level = 1, refNotes = false } = {}) {
  const a = store.assignment(), h = "#".repeat(level);
  const state = noteState();
  const refsBy = refNotes ? d3.group(store.nodes().filter(n => n.type === "locref" && store.blockOf(n)), r => r.blockId) : new Map();
  const out = [`${h} ${a.title || "Compiled assignment"}`];
  for (const sec of store.sections()) {
    out.push(`${h}# ${store.sectionName(sec)}`);
    sec.blocks.forEach((b, i) => {
      const refs = refsBy.get(b.id);
      out.push(withFootnotes(b.text, store.get, state) + (refs ? `\n\n*[¶${i + 1} · location references: ${refs.map(nodeName).join("; ")}]*` : ""));
    });
  }
  if (state.notes.length) out.push(state.notes.map(n => `[^${n.n}]: ${n.text}`).join("\n"));
  if (state.cited.size) out.push(`${h}# Bibliography`, [...state.cited.values()].map(r => cite(r).bib).sort().join("\n\n"));
  return out.join("\n\n");
}

function body(n) { return (n.body || "").trim(); }

// ───────────── everything, grouped by type
export function everything(opts) {
  const ns = store.nodes();
  const out = [`# Narrating Canada — HC & LO notebook`,
    `Exported ${fmtDay(new Date().toISOString())}. ${TYPE_ORDER.map(t => `${ns.filter(n => n.type === t).length} ${TYPES[t].plural.toLowerCase()}`).join(", ")}.`];
  if (opts.assignment && store.allBlocks().length) out.push(assignmentMd({ level: 2, refNotes: true }));
  for (const t of TYPE_ORDER) {
    if (!opts.types.has(t)) continue;
    const list = ns.filter(n => n.type === t).sort(byName);
    if (!list.length) continue;
    out.push(`## ${TYPES[t].plural}`);
    for (const n of list) {
      out.push(`### ${nodeName(n)}`, `*${TYPES[t].label}${stamp(n, opts)}*`);
      if (t === "reference") out.push(`**Citation:** ${cite(n).bib}`);
      if (handbookLink(n)) out.push(`**HC handbook:** ${handbookLink(n)}`);
      if (t === "locref") out.push(passage(n));
      if (body(n)) out.push(body(n));
      const nb = store.neighbours(n.id);
      if (nb.length) out.push(`**Connected to:** ${TYPE_ORDER.flatMap(tt => nb.filter(x => x.type === tt).sort(byName).map(x => `${TYPES[tt].label} “${nodeName(x)}”`)).join("; ")}`);
    }
  }
  return out.join("\n\n") + "\n";
}

// ───────────── from the HCs and LOs outwards
export function perspective(opts) {
  const cited = new Map();
  const out = [`# HC and LO applications`,
    `Exported ${fmtDay(new Date().toISOString())} from the Narrating Canada notebook. Each section is one HC or LO: where it sits (course and college), ` +
    `what it means, then the notes, passages of the compiled assignment and readings connected to it. A bibliography of every reading follows at the end.`];
  for (const t of ["hc", "lo"]) {
    const list = store.nodes().filter(n => n.type === t).sort(byName);
    if (!list.length) continue;
    out.push(`## ${TYPES[t].plural}`);
    for (const n of list) section(n, out, cited, opts);
  }
  if (cited.size) out.push(`## Bibliography`, [...cited.values()].map(r => cite(r).bib).sort().join("\n\n"));
  return out.join("\n\n") + "\n";
}

function section(n, out, cited, opts) {
  const nb = store.neighbours(n.id);
  const up = nb.filter(x => TYPES[x.type].rank < 2);
  const where = up.filter(x => x.type === "course").sort(byName).map(c => {
    const colleges = store.neighbours(c.id).filter(x => x.type === "college").map(nodeName);
    return `${nodeName(c)}${colleges.length ? ` (${colleges.join(", ")})` : ""}`;
  });
  const colleges = up.filter(x => x.type === "college").map(nodeName);
  out.push(`### ${nodeName(n)}`, `*${TYPES[n.type].label}${where.length ? ` · Course: ${where.join("; ")}` : ""}${colleges.length ? ` · College: ${colleges.join(", ")}` : ""}${stamp(n, opts)}*`);
  if (handbookLink(n)) out.push(`HC handbook: ${handbookLink(n)}`);
  if (body(n)) out.push(body(n));

  const seen = new Set([n.id]);
  const below = x => TYPES[x.type].rank > 2;
  const notes = nb.filter(x => x.type === "note").sort(byName);
  const passages = nb.filter(x => x.type === "locref").sort(byName);
  const readings = nb.filter(x => x.type === "reference").sort(byName);

  for (const note of notes) {
    seen.add(note.id);
    out.push(`#### Note: ${nodeName(note)}`);
    if (opts.dates) out.push(`*${stamp(note, opts).slice(3)}*`);
    if (body(note)) out.push(body(note));
    const around = store.neighbours(note.id).filter(x => below(x) && !seen.has(x.id));
    for (const r of around.filter(x => x.type === "locref")) {
      out.push(`**In the assignment — ${nodeName(r)}**`, passage(r, cited));
      if (body(r)) out.push(body(r));
    }
    const refs = around.filter(x => x.type === "reference");
    refs.forEach(r => cited.set(r.id, r));
    if (refs.length) out.push(`**Sources:** ${refs.map(r => cite(r).short).join(" ")}`);
    const more = around.filter(x => x.type === "note");
    if (more.length) out.push(`**See also:** ${more.map(x => `note “${nodeName(x)}”`).join("; ")}`);
  }
  for (const r of passages) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(`#### In the assignment: ${nodeName(r)}`, passage(r, cited));
    if (body(r)) out.push(body(r));
    for (const x of store.neighbours(r.id).filter(x => x.type === "note" && !seen.has(x.id))) {
      out.push(`**Note — ${nodeName(x)}**`);
      if (body(x)) out.push(body(x));
    }
  }
  if (readings.length) {
    out.push(`#### Readings`);
    for (const r of readings) {
      cited.set(r.id, r);
      out.push(`- ${cite(r).bib}${body(r) ? `\n\n  ${body(r).replace(/\n/g, "\n  ")}` : ""}`);
    }
  }
  const peers = nb.filter(x => x.type === "hc" || x.type === "lo").sort(byName);
  if (peers.length) out.push(`**Linked ${peers.map(p => `${TYPES[p.type].label} ${nodeName(p)}`).join("; ")}**`);
  if (!notes.length && !passages.length && !readings.length) out.push(`*No notes, passages or readings connected yet.*`);
}

// ───────────── page
export function mount({ page }) {
  const types = new Set(TYPE_ORDER);
  const rescue = store.rescued();
  const el = html(`<div>
    <h1>Export</h1>
    <div class="kicker">Read it straight through, or hand it to an LLM</div>
    ${rescue ? `<div class="notice">This browser holds a copy of edits that did not save.
      <button class="mini" data-k="restore">Restore unsaved edits</button> <button class="mini" data-k="dropRescue">Discard them</button></div>` : ""}
    <div class="filters" role="tablist">
      <button class="on" data-view="perspective">From the HCs &amp; LOs</button>
      <button data-view="everything">Everything</button>
      <button data-view="assignment">Compiled assignment</button>
    </div>
    <div class="opts">
      <label class="chip"><input type="checkbox" data-o="dates" checked><span class="label">Include created / updated dates</span></label>
      <span data-k="evOpts" hidden>
        <label class="chip"><input type="checkbox" data-o="assignment" checked><span class="label">Include the compiled assignment</span></label>
        <span class="typeOpts">${TYPE_ORDER.map(t => `<label class="chip"><input type="checkbox" data-t="${t}" checked>
          <span class="dot" style="background:${TYPES[t].color}"></span><span class="label">${esc(TYPES[t].plural)}</span></label>`).join("")}</span>
      </span>
    </div>
    <div class="btnRow"><button class="primary" data-k="dl">Download .md</button><button data-k="copy">Copy</button><span class="muted" data-k="size"></span></div>
    <textarea class="exportText" data-k="out" readonly aria-label="Export preview"></textarea>
    <h2>Backup</h2>
    <p class="muted">The whole notebook as JSON, as saved in <code>data/notebook.json</code>. Importing replaces everything in the notebook.</p>
    <div class="btnRow"><button data-k="json">Download notebook.json</button><button data-k="import">Import notebook.json…</button>
      <input type="file" accept=".json,application/json" data-k="file" hidden></div>
  </div>`);
  page.replaceChildren(el);
  const q = k => el.querySelector(`[data-k="${k}"]`);
  let view = "perspective";

  const text = () => {
    const opts = { dates: el.querySelector('[data-o="dates"]').checked, assignment: el.querySelector('[data-o="assignment"]').checked, types };
    if (view === "everything") return everything(opts);
    if (view === "assignment") return assignmentMd() + "\n";
    return perspective(opts);
  };
  const refresh = () => {
    const t = text();
    q("out").value = t;
    q("size").textContent = `${t.split(/\s+/).filter(Boolean).length.toLocaleString()} words`;
    q("evOpts").hidden = view !== "everything";
  };
  el.querySelectorAll("[data-view]").forEach(b => b.onclick = () => {
    view = b.dataset.view;
    el.querySelectorAll("[data-view]").forEach(x => x.classList.toggle("on", x === b));
    refresh();
  });
  el.addEventListener("change", e => {
    if (e.target.dataset.t) e.target.checked ? types.add(e.target.dataset.t) : types.delete(e.target.dataset.t);
    if (e.target.dataset.o || e.target.dataset.t) refresh();
  });
  const day = new Date().toISOString().slice(0, 10);
  q("dl").onclick = () => download(`notebook-${view}-${day}.md`, text());
  q("copy").onclick = async () => { await copy(text()); q("copy").textContent = "Copied"; setTimeout(() => (q("copy").textContent = "Copy"), 1200); };
  q("json").onclick = () => download(`notebook-${day}.json`, JSON.stringify(store.raw(), null, 1), "application/json");
  q("import").onclick = () => q("file").click();
  q("file").onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (!d.nodes || !d.links) throw new Error("That file isn't a notebook (no nodes or links).");
      if (!confirm(`Replace the whole notebook with ${file.name} (${Object.keys(d.nodes).length} nodes)?`)) return;
      store.replaceAll(d);
      refresh();
    } catch (err) { alert(err.message); }
    e.target.value = "";
  };
  if (rescue) {
    q("restore").onclick = () => {
      if (!confirm("Replace the notebook with the unsaved copy from this browser?")) return;
      store.replaceAll(rescue); store.clearRescue();
      q("restore").closest(".notice").remove();
    };
    q("dropRescue").onclick = () => { store.clearRescue(); q("dropRescue").closest(".notice").remove(); };
  }
  refresh();
  return store.onChange(refresh);
}
