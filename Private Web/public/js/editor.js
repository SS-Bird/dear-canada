// The right-hand column for one node: its title and fields, the writing area, citation tools
// for references, the assignment passage for location references, and its connections.
import { esc, html, md, mdInline, fmtDate, autogrow, copy, markText } from "./util.js";
import * as store from "./store.js";
import { TYPES, TYPE_ORDER, nodeName, typeDot, autoHandbook, handbookLink } from "./types.js";
import { KINDS, fieldLabel, cite, lookup, withInlineCites } from "./cite.js";

// What "+ Add" offers from each type: mostly the types below it, since links run upwards.
const CHILDREN = {
  college: ["course"], course: ["hc", "lo", "note"], hc: ["note", "reference", "locref"], lo: ["note", "reference", "locref"],
  note: ["note", "reference", "locref"], reference: ["note"], locref: ["note"],
};
const BODY_LABEL = { college: "Notes", course: "Notes", hc: "Definition and how you are applying it", lo: "Definition and how you are applying it",
  reference: "Annotation", note: "Note", locref: "Comment" };
const STATUS = {
  live: ["Attached", "s-live"], edited: ["Words changed", "s-edited"], removed: ["Passage removed", "s-removed"], unanchored: ["Not attached", "s-none"],
};

let datalistSeq = 0;

export function nodeEditor(id, { setHead, go, close, open }) {
  const n0 = store.get(id), T = TYPES[n0.type];
  const dl = `dl-${++datalistSeq}`;
  const el = html(`<div class="editor">
    <label class="fld"><span>${n0.type === "reference" ? "Title (with subtitle)" : "Title"}</span><input type="text" data-f="title"></label>
    ${T.code ? `<label class="fld"><span>${esc(T.code)}</span><input type="text" data-f="code"></label>` : ""}
    ${n0.type === "hc" ? `<label class="fld"><span>HC handbook link</span><span class="linkRow">
      <input type="text" inputmode="url" data-f="handbook"><a data-k="hbOpen" target="_blank" rel="noopener">Open ↗</a></span></label>` : ""}
    ${n0.type === "reference" ? `<div data-k="ref"></div>` : ""}
    ${n0.type === "locref" ? `<div data-k="loc"></div>` : ""}
    <div class="fldHead"><span>${esc(BODY_LABEL[n0.type])}</span>
      <span class="tabs"><button class="mini on" data-tab="write">Write</button><button class="mini" data-tab="preview">Preview</button></span></div>
    <textarea data-f="body" class="bodyText" placeholder="Markdown works: **bold**, *italic*, - lists, > quotes, [links](https://…)"></textarea>
    <div class="md preview" data-k="preview" hidden></div>
    <h3>Connections <span class="muted wideHint">· widen the column (⇤) to read notes and readings here</span></h3>
    <div data-k="conns"></div>
    <input type="text" list="${dl}" data-k="connect" class="connect" placeholder="Connect to an existing node…" aria-label="Connect to an existing node">
    <datalist id="${dl}"></datalist>
    <div class="btnRow" data-k="adds"></div>
    <div class="dates" data-k="dates"></div>
    <div class="btnRow"><button class="danger" data-k="delete">Delete this ${esc(T.label.toLowerCase())}</button></div>
  </div>`);
  const q = k => el.querySelector(`[data-k="${k}"]`);
  const f = k => el.querySelector(`[data-f="${k}"]`);
  const node = () => store.get(id);

  f("title").value = n0.title || "";
  if (T.code) f("code").value = n0.code || "";
  f("body").value = n0.body || "";
  const hbLink = () => {
    // Left empty, the field shows (and opens) the link built from the code; typing replaces it.
    const a = q("hbOpen"), url = handbookLink(node());
    f("handbook").placeholder = autoHandbook(node()) || "https://…";
    a.hidden = !/^https?:\/\//.test(url);
    a.href = url;
  };
  if (n0.type === "hc") { f("handbook").value = n0.handbook || ""; hbLink(); }
  autogrow(f("body"));

  el.addEventListener("input", e => {
    const k = e.target.dataset.f;
    if (!k || e.target.tagName === "SELECT") return;
    store.updateNode(id, { [k]: e.target.value });
    if (k === "title" || k === "code") setHead(node());
    if ((k === "handbook" || k === "code") && n0.type === "hc") hbLink();
    if (n0.type === "reference") renderCitation();
  });
  el.addEventListener("click", e => {
    const tab = e.target.dataset.tab;
    if (tab) {
      el.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("on", b === e.target));
      q("preview").hidden = tab !== "preview"; f("body").hidden = tab === "preview";
      if (tab === "preview") q("preview").innerHTML = md(node().body) || '<span class="muted">Nothing written yet.</span>';
    }
    const conn = e.target.closest("[data-open]");
    if (conn) store.select(conn.dataset.open);
    const un = e.target.closest("[data-unlink]");
    if (un) store.unlink(id, un.dataset.unlink);
    const add = e.target.closest("[data-add]");
    if (add) {
      if (add.dataset.add === "locref") { go("assignment"); return; } // pick the passage there; it links back to this node
      const c = store.createNode(add.dataset.add);
      store.link(id, c.id);
      open(c.id, { focusTitle: true });
    }
  });

  q("connect").addEventListener("change", e => {
    const opt = [...el.querySelectorAll(`#${dl} option`)].find(o => o.value === e.target.value);
    if (opt) { store.link(id, opt.dataset.id); e.target.value = ""; }
  });
  q("delete").onclick = () => {
    if (!confirm(`Delete “${nodeName(node())}”? Its links go too. This can't be undone (except from a backup).`)) return;
    store.deleteNode(id);
    close();
  };

  // ───────────── connections + dates (refreshed whenever the notebook changes)
  // In the widened column, notes, readings and passages are shown in full so they can be read here.
  const READABLE = new Set(["note", "reference", "locref"]);
  const isWide = () => !!document.getElementById("right")?.classList.contains("wide");
  function readable(x) {
    if (x.type === "reference")
      return `<div class="citeText">${mdInline(cite(x).bib)}</div>${x.body ? `<div class="md">${md(x.body)}</div>` : ""}`;
    if (x.type === "locref") {
      const b = store.blockOf(x), text = b ? b.text : x.snapshot;
      return (x.quote ? `<blockquote class="quote">${esc(x.quote)}</blockquote>` : "")
        + (text ? `<div class="passage md" data-quote="${esc(x.quote || "")}">${md(withInlineCites(text, store.get))}</div>` : "")
        + (store.refStatus(x) === "removed" ? '<div class="muted">This passage has been removed from the assignment.</div>' : "")
        + (x.body ? `<div class="md">${md(x.body)}</div>` : "");
    }
    const others = store.neighbours(x.id).filter(o => o.id !== id);
    return (x.body ? `<div class="md">${md(x.body)}</div>` : '<div class="muted">Nothing written yet.</div>')
      + (others.length ? `<div class="muted alsoLinked">Also linked: ${others.map(o =>
        `<span class="click" data-open="${o.id}">${esc(nodeName(o))}</span>`).join(", ")}</div>` : "");
  }
  function renderConns() {
    const nb = store.neighbours(id), wide = isWide();
    const groups = TYPE_ORDER.map(t => [t, nb.filter(x => x.type === t).sort((a, b) => nodeName(a).localeCompare(nodeName(b)))]).filter(([, xs]) => xs.length);
    const row = x => `<div class="row conn"><span class="click" data-open="${x.id}">${x.starred ? "★ " : ""}${esc(nodeName(x))}</span>
        <button class="mini ghostBtn" data-unlink="${x.id}" title="Remove this connection" aria-label="Disconnect">✕</button></div>`;
    q("conns").innerHTML = groups.map(([t, xs]) => `<div class="grp">${typeDot(t)} ${esc(TYPES[t].plural)}</div>` +
      xs.map(x => wide && READABLE.has(x.type) ? `<div class="connCard">${row(x)}<div class="connBody">${readable(x)}</div></div>` : row(x)).join("")).join("")
      || '<div class="muted">Not connected to anything yet.</div>';
    q("conns").querySelectorAll(".passage[data-quote]").forEach(p => markText(p, p.dataset.quote, "hl"));
    const near = new Set(nb.map(x => x.id));
    el.querySelector(`#${dl}`).innerHTML = store.nodes().filter(x => x.id !== id && !near.has(x.id))
      .sort((a, b) => TYPES[a.type].rank - TYPES[b.type].rank || nodeName(a).localeCompare(nodeName(b)))
      .map(x => `<option data-id="${x.id}" value="${esc(`${nodeName(x)} · ${TYPES[x.type].label}`)}"></option>`).join("");
    q("adds").innerHTML = CHILDREN[n0.type].map(t => `<button data-add="${t}">+ ${esc(TYPES[t].label)}</button>`).join("");
    const n = node();
    q("dates").innerHTML = `Created ${esc(fmtDate(n.created))}<br>Last updated ${esc(fmtDate(n.updated))}`;
  }

  // ───────────── location reference
  function renderLoc() {
    const r = node(), st = store.refStatus(r), b = store.blockOf(r);
    const at = b && store.whereIs(b.id);
    const where = at ? `${store.sectionName(at.section)}, paragraph ${at.index}` : "";
    const msg = {
      live: `In ${where} of the compiled assignment.`,
      edited: `${where}. The quoted words are no longer in it, so it was probably reworded.`,
      removed: `The paragraph was removed from the assignment on ${fmtDate(r.removedAt)}. Its last version is kept here.`,
      unanchored: "Not attached to the assignment yet. Choose a passage to point at.",
    }[st];
    const text = b ? b.text : r.snapshot;
    q("loc").innerHTML = `<div class="locStatus"><span class="badge ${STATUS[st][1]}">${STATUS[st][0]}</span> ${esc(msg)}</div>
      ${r.quote ? `<div class="fldHead"><span>Quoted words</span></div><blockquote class="quote">${esc(r.quote)}</blockquote>` : ""}
      ${text ? `<div class="fldHead"><span>${st === "removed" ? "Last version of the paragraph" : "The paragraph as it is now"}</span></div>
        <div class="passage md" data-k="passage">${md(withInlineCites(text, store.get))}</div>` : ""}
      <div class="btnRow"><button data-k="show"${b ? "" : " disabled"}>Show in assignment</button>
        <button data-k="anchor">${r.blockId ? "Point somewhere else…" : "Choose a passage…"}</button></div>`;
    if (text && r.quote) markText(q("passage"), r.quote, "hl");
    q("show").onclick = () => go(`assignment/${at.section.id}?ref=${id}`);
    q("anchor").onclick = () => { store.ui.anchoring = id; go("assignment"); };
  }

  // ───────────── reference
  function renderRef() {
    const r = node(), kind = r.kind || "book";
    q("ref").innerHTML = `
      <div class="lookup"><input type="text" data-k="lk" placeholder="DOI or ISBN" aria-label="DOI or ISBN">
        <button data-k="lkGo">Fill in</button></div>
      <div class="muted lkMsg" data-k="lkMsg">Paste a DOI or ISBN to fill in the fields below, then check them.</div>
      <label class="fld"><span>Kind</span><select data-f="kind">${Object.entries(KINDS).map(([k, v]) =>
        `<option value="${k}"${k === kind ? " selected" : ""}>${esc(v.label)}</option>`).join("")}</select></label>
      ${KINDS[kind].fields.filter(x => x !== "title").map(x => `<label class="fld"><span>${esc(fieldLabel(x, kind))}</span>${
        x === "authors" || x === "editors" ? `<textarea data-f="${x}" rows="2"></textarea>` : `<input type="text" data-f="${x}">`}</label>`).join("")}
      <div class="cite" data-k="cite"></div>
      <details class="override"${r.override ? " open" : ""}><summary>Write the bibliography entry yourself</summary>
        <textarea data-f="override" rows="3" placeholder="Replaces the generated entry. *Asterisks* for italics."></textarea></details>`;
    for (const x of [...KINDS[kind].fields, "override"]) { const input = f(x); if (input && x !== "title") input.value = r[x] || ""; }
    el.querySelectorAll('.fld textarea[data-f="authors"], .fld textarea[data-f="editors"]').forEach(autogrow);
    f("kind").onchange = e => { store.updateNode(id, { kind: e.target.value }); renderRef(); };
    q("lkGo").onclick = async () => {
      const msg = q("lkMsg");
      msg.textContent = "Looking it up… (ISBNs can take ten seconds or so)";
      try {
        const found = await lookup(q("lk").value);
        const { title, ...rest } = found;
        const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v));
        if (title) patch.title = title;
        store.updateNode(id, patch);
        f("title").value = node().title || "";
        setHead(node());
        renderRef();
        q("lkMsg").textContent = "Filled in. Check the fields, especially author names and capitalisation.";
      } catch (e) { msg.textContent = e.message; }
    };
    renderCitation();
  }

  function renderCitation() {
    const c = cite(node());
    const rows = [["Bibliography", c.bib], ["First note", c.note], ["Short note", c.short]];
    q("cite").innerHTML = `<div class="fldHead"><span>Chicago citation</span></div>` + rows.map(([label, text], i) =>
      `<div class="citeRow"><div class="muted">${label}</div><div class="citeText">${mdInline(text)}</div>
        <button class="mini" data-copy="${i}">Copy</button></div>`).join("");
    q("cite").querySelectorAll("[data-copy]").forEach(b => b.onclick = async () => {
      const text = rows[b.dataset.copy][1];
      await copy(text.replace(/\*/g, ""), mdInline(text));
      b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1200);
    });
  }

  if (n0.type === "reference") renderRef();
  if (n0.type === "locref") renderLoc();
  renderConns();

  const off = store.onChange(() => {
    if (!node()) { close(); return; }
    renderConns();
    if (n0.type === "locref") renderLoc();
  });
  return { el, destroy: off, focusTitle: () => f("title").focus(), refresh: renderConns };
}
