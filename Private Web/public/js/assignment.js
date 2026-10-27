// The compiled assignment, one section (#/assignment/<id>) or all of them (#/assignment).
// Paragraphs are edited in place. Selecting words makes a location reference that follows them
// through edits (see store.syncRefs). While editing, "Cite a reading" puts a {cite:…} marker in
// the text; on the page it shows as a note number, and exports turn it into a Chicago footnote.
import { esc, html, md, mdInline, fmtDate, autogrow, markText, squash, shorten } from "./util.js";
import * as store from "./store.js";
import { nodeName } from "./types.js";
import { cite, citeToken, noteState, withNoteNumbers } from "./cite.js";

export function mount({ page, params, openNode, go }) {
  const sid = params.path?.[0] || null; // one section, or null for the whole assignment
  if (sid && !store.section(sid)) {
    page.innerHTML = `<h1>Not found</h1><p>That section no longer exists. <a href="#/assignment">Whole assignment</a></p>`;
    return null;
  }
  let editing = null, picking = false, down = false, pending = false;

  // The heading sits outside the part that re-renders, so typing in it never loses focus.
  const head = html(`<div class="asgHead">
    <div class="kicker" data-k="kicker"></div>
    <input type="text" class="asgTitle" aria-label="${sid ? "Section title" : "Assignment title"}" placeholder="${sid ? "Untitled section" : "Untitled assignment"}">
    ${sid ? `<div class="btnRow secTools">
      <button data-k="up">↑ Move up</button><button data-k="down">↓ Move down</button>
      <button class="danger" data-k="delSec">Delete section</button></div>` : ""}
  </div>`);
  const title = head.querySelector(".asgTitle");
  title.value = sid ? store.section(sid).title : store.assignment().title || "";
  title.oninput = () => sid ? store.renameSection(sid, title.value) : store.setAssignmentTitle(title.value);
  const root = html(`<div class="asg"></div>`);
  page.replaceChildren(head, root);
  page.closest("#page")?.classList.add("paper");
  const bar = html(`<div class="selBar panel" hidden></div>`);
  document.body.append(bar);

  if (sid) {
    head.querySelector('[data-k="up"]').onclick = () => store.moveSection(sid, -1);
    head.querySelector('[data-k="down"]').onclick = () => store.moveSection(sid, 1);
    head.querySelector('[data-k="delSec"]').onclick = () => {
      const sec = store.section(sid);
      if (!confirm(`Delete “${store.sectionName(sec)}” and its ${sec.blocks.length} paragraphs? Location references into it keep their last version.`)) return;
      store.deleteSection(sid);
      go("assignment");
    };
  }

  // Re-rendering mid-click would swap the clicked element out, so wait until the click is done.
  const onDown = () => { down = true; };
  const onUp = () => setTimeout(() => { down = false; if (pending) render(); }, 0);
  root.addEventListener("pointerdown", onDown);
  window.addEventListener("pointerup", onUp);

  function render() {
    if (editing) return;
    if (down) { pending = true; return; }
    pending = false;
    paint();
  }

  function paint() {
    const secs = sid ? [store.section(sid)] : store.sections();
    const all = store.sections();
    head.querySelector('[data-k="kicker"]').textContent = sid
      ? `Compiled assignment · section ${all.indexOf(secs[0]) + 1} of ${all.length}` : "Compiled assignment · all sections";
    // A section title being typed in (whole view) gets its focus and caret back after the repaint.
    const act = document.activeElement?.dataset?.secTitle, caret = act && document.activeElement.selectionStart;

    const refs = store.nodes().filter(n => n.type === "locref");
    const byBlock = d3.group(refs.filter(r => store.blockOf(r)), r => r.blockId);
    const removed = refs.filter(r => store.refStatus(r) === "removed");
    const anchoring = store.ui.anchoring && store.get(store.ui.anchoring);
    const notes = noteState();
    const nParas = secs.reduce((k, s) => k + s.blocks.length, 0);
    root.innerHTML = `
      <div class="meta"><span><b>${nParas}</b> paragraph${nParas === 1 ? "" : "s"}</span>
        <span>updated ${esc(fmtDate(sid ? secs[0].updated : store.assignment().updated))}</span></div>
      ${anchoring ? `<div class="notice">Select the words “${esc(nodeName(anchoring))}” should point to, then choose <b>Point here</b>.
        <button class="mini" data-k="cancelAnchor">Cancel</button></div>` : ""}
      ${secs.map(sec => sectionHtml(sec, byBlock, notes)).join("")}
      ${sid ? "" : `<button data-k="addSec" class="addPara">+ Add section</button>`}
      ${notes.notes.length ? `<h2>Notes</h2><ol class="footnotes">${notes.notes.map(n =>
        `<li value="${n.n}"><span class="noteText" data-cite="${n.id}">${mdInline(n.text)}</span></li>`).join("")}</ol>` : ""}
      <p class="muted help">Click a paragraph to edit it (Esc or clicking away finishes). A blank line splits it in two; emptying it deletes it.
        While editing, <b>Cite a reading</b> adds a note; it shows here as a number and becomes a Chicago footnote in the export.
        Select some words to make a <b>location reference</b>. It follows those words as you edit, and keeps a copy of the paragraph if you delete it.</p>
      ${removed.length ? `<h2>Removed passages that are still referenced</h2>${removed.map(removedHtml).join("")}` : ""}`;
    for (const b of secs.flatMap(s => s.blocks)) {
      const box = root.querySelector(`[data-b="${b.id}"] .blkText`);
      for (const r of byBlock.get(b.id) || []) markText(box, r.quote, "ref" + (r.id === store.ui.selected ? " on" : ""), { "data-ref": r.id });
    }
    removed.forEach(r => { const box = root.querySelector(`[data-removed="${r.id}"] .passage`); box && markText(box, r.quote, "ref"); });
    root.querySelectorAll("[data-sec-title]").forEach(inp => {
      inp.value = store.section(inp.dataset.secTitle)?.title || "";
      inp.oninput = () => store.renameSection(inp.dataset.secTitle, inp.value);
    });
    if (act) {
      const inp = root.querySelector(`[data-sec-title="${act}"]`);
      if (inp) { inp.focus(); inp.setSelectionRange(caret, caret); }
    }
  }

  const sectionHtml = (sec, byBlock, notes) => `<section class="asgSec" data-sec="${sec.id}">
    ${sid ? "" : `<div class="secHead"><input type="text" class="secTitle" data-sec-title="${sec.id}" placeholder="${esc(store.sectionName(sec))}" aria-label="Section title">
      <a href="#/assignment/${sec.id}" class="secOpen">open</a></div>`}
    <div class="blocks">${sec.blocks.map((b, i) => blockHtml(b, i, byBlock.get(b.id) || [], notes)).join("")
      || '<p class="muted">No paragraphs yet. Add one and paste your text in; blank lines split it into paragraphs.</p>'}</div>
    <button data-addend="${sec.id}" class="addPara mini">+ Add paragraph</button>
  </section>`;

  const blockHtml = (b, i, refs, notes) => `<div class="blk" data-b="${b.id}">
    <div class="blkNum">${i + 1}</div>
    <div class="blkText md">${md(withNoteNumbers(b.text, store.get, notes)) || '<p class="muted">Empty paragraph</p>'}</div>
    <div class="blkRefs">${refs.map(r => `<button class="refChip${r.id === store.ui.selected ? " on" : ""}" data-ref="${r.id}"
      title="${esc(nodeName(r))}${store.refStatus(r) === "edited" ? " (quoted words changed)" : ""}">${store.refStatus(r) === "edited" ? "◌" : "●"}</button>`).join("")}</div>
    <button class="blkAdd mini" data-add="${b.id}" title="Add a paragraph below" aria-label="Add a paragraph below">+</button>
  </div>`;

  const removedHtml = r => `<div class="removed" data-removed="${r.id}">
    <div class="row"><span class="click" data-ref="${r.id}">${esc(nodeName(r))}</span> <span class="muted">· removed ${esc(fmtDate(r.removedAt))}</span></div>
    <div class="passage md">${md(r.snapshot)}</div></div>`;

  // ───────────── editing paragraphs
  function edit(id) {
    if (pending) { pending = false; paint(); }
    const box = root.querySelector(`[data-b="${id}"] .blkText`);
    const b = store.allBlocks().find(x => x.id === id);
    if (!box || !b) return;
    editing = id;
    bar.hidden = true;
    const wrap = html(`<div class="blkEditWrap"><textarea class="blkEdit" aria-label="Paragraph text"></textarea>
      <div class="editBar"><button class="mini" data-act="cite">Cite a reading…</button>
        <span class="muted">Esc to finish · citations show as {cite:…} while editing</span></div></div>`);
    const ta = wrap.querySelector("textarea");
    ta.value = b.text;
    box.replaceWith(wrap);
    const fit = autogrow(ta);
    ta.focus();
    const finish = () => { picking = false; editing = null; store.commitBlock(id); };
    ta.oninput = () => store.setBlockText(id, ta.value);
    ta.onkeydown = e => { if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) ta.blur(); };
    ta.onblur = () => { if (!picking) finish(); };
    const citeBtn = wrap.querySelector('[data-act="cite"]');
    citeBtn.onpointerdown = e => e.preventDefault(); // keep the caret where it is
    citeBtn.onclick = () => openPicker(wrap, ta, id, fit, finish);
  }

  function openPicker(wrap, ta, id, fit, finish) {
    if (picking) return;
    picking = true;
    const [s, e] = [ta.selectionStart, ta.selectionEnd];
    const readings = store.nodes().filter(n => n.type === "reference").sort((a, b) => nodeName(a).localeCompare(nodeName(b)));
    const pk = html(`<div class="picker panel">
      <div class="pickRow"><input type="text" data-k="q" placeholder="Find a reading, or type a new title…" aria-label="Find a reading">
        <input type="text" data-k="pg" placeholder="Page(s)" aria-label="Pages" class="pg"></div>
      <div class="pickList" data-k="list"></div>
      <div class="btnRow"><button class="mini" data-k="newRef">+ New reading with this title</button><button class="mini" data-k="cancel">Cancel</button></div>
    </div>`);
    wrap.append(pk);
    const q = pk.querySelector('[data-k="q"]'), pg = pk.querySelector('[data-k="pg"]'), list = pk.querySelector('[data-k="list"]');
    const show = () => {
      const f = q.value.trim().toLowerCase();
      const hits = readings.filter(r => !f || `${nodeName(r)} ${r.authors || ""}`.toLowerCase().includes(f));
      list.innerHTML = hits.map(r => `<button class="pickItem" data-id="${r.id}">${mdInline(cite(r).short)}<span class="muted"> ${esc(shorten(nodeName(r), 70))}</span></button>`).join("")
        || `<div class="muted">${readings.length ? "No reading matches." : "No readings in the notebook yet."}</div>`;
    };
    let closed = false;
    const close = () => { closed = true; pk.remove(); picking = false; };
    const choose = refId => {
      const tok = citeToken(refId, pg.value);
      ta.value = ta.value.slice(0, s) + tok + ta.value.slice(e);
      store.setBlockText(id, ta.value);
      close();
      ta.focus();
      ta.setSelectionRange(s + tok.length, s + tok.length);
      fit();
    };
    pk.onpointerdown = ev => { if (ev.target.closest("button")) ev.preventDefault(); }; // keep focus in the picker
    pk.onclick = ev => {
      const item = ev.target.closest("[data-id]");
      if (item) choose(item.dataset.id);
      if (ev.target.closest('[data-k="cancel"]')) { close(); ta.focus(); }
      if (ev.target.closest('[data-k="newRef"]')) {
        const r = store.createNode("reference", { title: q.value.trim() });
        choose(r.id);
        openNode(r.id); // fill in its details on the right
      }
    };
    pk.onkeydown = ev => {
      if (ev.key === "Escape") { ev.stopPropagation(); close(); ta.focus(); }
      if (ev.key === "Enter") { ev.preventDefault(); const first = list.querySelector("[data-id]"); if (first) choose(first.dataset.id); }
    };
    pk.addEventListener("focusout", ev => {
      if (closed || pk.contains(ev.relatedTarget) || ev.relatedTarget === ta) return;
      close();
      finish(); // clicked away from both the picker and the paragraph
    });
    q.oninput = show;
    show();
    q.focus();
  }

  root.addEventListener("click", e => {
    const t = e.target;
    if (!getSelection().isCollapsed) return; // finishing a text selection, not a click
    const ref = t.closest("[data-ref]");
    if (ref) { openNode(ref.dataset.ref); return; }
    const c = t.closest("[data-cite]");
    if (c) { if (store.get(c.dataset.cite)) openNode(c.dataset.cite); return; }
    const add = t.closest("[data-add]");
    if (add) { edit(store.insertBlock(store.whereIs(add.dataset.add).section.id, add.dataset.add).id); return; }
    const addEnd = t.closest("[data-addend]");
    if (addEnd) { const sec = store.section(addEnd.dataset.addend); edit(store.insertBlock(sec.id, sec.blocks.at(-1)?.id).id); return; }
    if (t.closest('[data-k="addSec"]')) { go(`assignment/${store.addSection().id}`); return; }
    if (t.closest('[data-k="cancelAnchor"]')) { store.ui.anchoring = null; render(); return; }
    const box = t.closest(".blkText");
    if (box && !t.closest("a")) edit(box.closest(".blk").dataset.b);
  });

  // ───────────── selecting words → location reference
  root.addEventListener("mouseup", () => setTimeout(showBar, 0));
  function showBar() {
    const s = getSelection();
    if (editing || !s.rangeCount || s.isCollapsed) { bar.hidden = true; return; }
    const r = s.getRangeAt(0);
    const boxOf = n => (n.nodeType === 1 ? n : n.parentElement)?.closest(".blkText");
    const box = boxOf(r.startContainer);
    if (!box || !root.contains(box) || box !== boxOf(r.endContainer)) { bar.hidden = true; return; }
    const frag = r.cloneContents();
    frag.querySelectorAll(".citeMark").forEach(x => x.remove()); // note numbers aren't part of the quote
    const quote = squash(frag.textContent);
    if (!quote) { bar.hidden = true; return; }
    const blockId = box.closest(".blk").dataset.b;

    const anchoring = store.ui.anchoring && store.get(store.ui.anchoring);
    const from = store.ui.selected && store.get(store.ui.selected);
    const linkTo = from && from.type !== "locref" ? from : null;
    bar.innerHTML = anchoring
      ? `<button class="primary" data-act="move">Point “${esc(shorten(nodeName(anchoring), 30))}” here</button>`
      : `<button class="primary" data-act="new">${linkTo ? `Reference this from “${esc(shorten(nodeName(linkTo), 28))}”` : "Make a location reference"}</button>`
        + (linkTo ? `<button data-act="newBare">Without linking</button>` : "");
    bar.onpointerdown = e => e.preventDefault(); // keep the selection
    bar.onclick = e => {
      const act = e.target.dataset.act;
      if (!act) return;
      bar.hidden = true;
      getSelection().removeAllRanges();
      if (act === "move") {
        store.updateNode(anchoring.id, { blockId, quote });
        store.ui.anchoring = null;
        openNode(anchoring.id);
      } else {
        const n = store.createNode("locref", { title: `“${shorten(quote, 60)}”`, blockId, quote });
        if (act === "new" && linkTo) store.link(linkTo.id, n.id); // stay on the note you were writing
        else openNode(n.id);
      }
      render();
    };
    const rect = r.getBoundingClientRect();
    bar.hidden = false;
    bar.style.top = Math.max(8, rect.top - bar.offsetHeight - 8) + "px";
    bar.style.left = Math.max(8, Math.min(innerWidth - bar.offsetWidth - 8, rect.left + rect.width / 2 - bar.offsetWidth / 2)) + "px";
  }
  const hideBar = () => { bar.hidden = true; };
  document.addEventListener("scroll", hideBar, true);

  // ───────────── keep in step with the rest of the site
  const offChange = store.onChange(kind => {
    if (sid && !store.section(sid)) return; // deleted; the router is moving on
    if (kind !== "assignment-text" && kind !== "section-title") render();
  });
  const offSelect = store.onSelect(id => {
    root.querySelectorAll("mark.ref, .refChip").forEach(m => m.classList.toggle("on", m.dataset.ref === id));
  });

  paint();
  if (params.ref) {
    const b = store.blockOf(store.get(params.ref));
    const el = b && root.querySelector(`[data-b="${b.id}"]`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1600);
    }
  }

  return () => {
    offChange(); offSelect();
    window.removeEventListener("pointerup", onUp);
    document.removeEventListener("scroll", hideBar, true);
    page.closest("#page")?.classList.remove("paper");
    bar.remove();
  };
}
