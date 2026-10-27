// Reference bank (#/references): every reading in the notebook, including ones that have not
// found a place yet. Shows where each is used (cited in the assignment, linked in the network),
// and adds new ones by title, DOI or ISBN.
import { esc, html, mdInline, fmtDay, shorten, plain, download, copy, CITE_RE } from "./util.js";
import * as store from "./store.js";
import { TYPES, nodeName } from "./types.js";
import { cite, lookup } from "./cite.js";

const FILTERS = { all: "All", cited: "Cited in the assignment", linked: "Linked in the network", unplaced: "Not placed yet" };
const looksLikeId = s => /10\.\d{4,9}\/\S+/.test(s) || [10, 13].includes(s.replace(/[^0-9Xx]/g, "").length) && /^[\d\s-]+[Xx]?$/.test(s.trim());

export function mount({ page, openNode }) {
  let filter = "all", query = "", sort = "author";
  page.closest("#page")?.classList.add("paper");
  const el = html(`<div>
    <div class="kicker">Sources</div>
    <h1>Reference bank</h1>
    <p class="muted">Every reading in the notebook: the ones you cite, and the ones worth keeping until you find a place for them.
      Click one to edit its details on the right.</p>
    <div class="bankAdd">
      <input type="text" data-k="new" placeholder="Title, or a DOI / ISBN to look up" aria-label="New reading">
      <button class="primary" data-k="add">Add to bank</button>
    </div>
    <div class="muted lkMsg" data-k="msg"></div>
    <div class="bankTools">
      <input type="text" data-k="q" placeholder="Search titles, authors, annotations…" aria-label="Search the bank">
      <select data-k="sort" aria-label="Sort"><option value="author">A–Z (as in a bibliography)</option><option value="new">Newest first</option></select>
    </div>
    <div class="filters" data-k="filters"></div>
    <div data-k="list" class="bankList"></div>
    <div class="btnRow" style="margin-top:18px"><button data-k="dl">Download these as a bibliography (.md)</button><button data-k="copy">Copy bibliography</button></div>
  </div>`);
  page.replaceChildren(el);
  const q = k => el.querySelector(`[data-k="${k}"]`);

  // where each reading is used
  function usage() {
    const cited = new Map(); // reading id → Map(section → count)
    for (const sec of store.sections()) for (const b of sec.blocks) for (const m of b.text.matchAll(CITE_RE)) {
      const per = cited.get(m[1]) || new Map();
      per.set(sec, (per.get(sec) || 0) + 1);
      cited.set(m[1], per);
    }
    return cited;
  }
  const statusOf = (r, cited) => cited.has(r.id) ? "cited" : store.neighbours(r.id).length ? "linked" : "unplaced";

  function shown() {
    const cited = usage();
    const all = store.nodes().filter(n => n.type === "reference").map(r => ({ r, c: cite(r), st: statusOf(r, cited), per: cited.get(r.id) }));
    const counts = { all: all.length, cited: 0, linked: 0, unplaced: 0 };
    all.forEach(x => counts[x.st]++);
    const f = query.toLowerCase();
    const list = all.filter(x => (filter === "all" || x.st === filter)
      && (!f || `${x.c.bib} ${x.r.authors || ""} ${x.r.body || ""}`.toLowerCase().includes(f)))
      .sort(sort === "new" ? (a, b) => b.r.created.localeCompare(a.r.created)
        : (a, b) => plain(a.c.bib).localeCompare(plain(b.c.bib), undefined, { sensitivity: "base" }));
    return { list, counts };
  }

  function render() {
    const { list, counts } = shown();
    q("filters").innerHTML = Object.entries(FILTERS).map(([k, label]) =>
      `<button class="${k === filter ? "on" : ""}" data-filter="${k}">${label} <span class="count">${counts[k]}</span></button>`).join("");
    q("list").innerHTML = list.map(({ r, c, st, per }) => {
      const where = st === "cited" ? `Cited ${[...per.values()].reduce((a, b) => a + b, 0)}× · ${[...per.keys()].map(s => esc(store.sectionName(s))).join(", ")}`
        : st === "linked" ? "Linked, not cited yet" : "Not placed yet";
      const nb = store.neighbours(r.id);
      return `<div class="bankItem${r.id === store.ui.selected ? " on" : ""}" data-id="${r.id}">
        <div class="citeText">${r.starred ? "★ " : ""}${mdInline(c.bib)}</div>
        <div class="bankMeta"><span class="badge b-${st}">${where}</span>
          ${nb.length ? `<span class="muted">${nb.map(x => `<span class="dot" style="background:${TYPES[x.type].color}"></span> ${esc(nodeName(x))}`).join(" · ")}</span>` : ""}
          <span class="muted">added ${esc(fmtDay(r.created))}</span></div>
        ${r.body ? `<div class="bankNote">${esc(shorten(plain(r.body), 240))}</div>` : ""}
      </div>`;
    }).join("") || `<p class="muted">${counts.all ? "Nothing matches." : "No readings yet. Add one above."}</p>`;
  }

  async function add() {
    const s = q("new").value.trim();
    if (!s) return;
    let fields = { title: s };
    if (looksLikeId(s)) {
      q("msg").textContent = "Looking it up… (ISBNs can take ten seconds or so)";
      try { fields = Object.fromEntries(Object.entries(await lookup(s)).filter(([, v]) => v)); }
      catch (e) { q("msg").textContent = e.message; return; }
    }
    const r = store.createNode("reference", fields);
    q("new").value = "";
    q("msg").textContent = looksLikeId(s) ? "Added. Check the details on the right." : "Added. Fill in its details on the right.";
    openNode(r.id);
  }
  q("add").onclick = add;
  q("new").onkeydown = e => { if (e.key === "Enter") add(); };
  q("q").oninput = e => { query = e.target.value.trim(); render(); };
  q("sort").onchange = e => { sort = e.target.value; render(); };
  q("filters").onclick = e => { const b = e.target.closest("[data-filter]"); if (b) { filter = b.dataset.filter; render(); } };
  q("list").onclick = e => { const it = e.target.closest("[data-id]"); if (it) openNode(it.dataset.id); };

  const bibliography = () => shown().list.map(x => x.c.bib).sort((a, b) => plain(a).localeCompare(plain(b))).join("\n\n") + "\n";
  q("dl").onclick = () => download(`bibliography-${new Date().toISOString().slice(0, 10)}.md`, "# Bibliography\n\n" + bibliography());
  q("copy").onclick = async () => {
    const md = bibliography();
    await copy(md.replace(/\*/g, ""), md.split("\n\n").map(l => `<p>${mdInline(l)}</p>`).join(""));
    q("copy").textContent = "Copied"; setTimeout(() => (q("copy").textContent = "Copy bibliography"), 1200);
  };

  render();
  const offChange = store.onChange(kind => { if (kind !== "assignment-text") render(); });
  const offSelect = store.onSelect(id => el.querySelectorAll(".bankItem").forEach(x => x.classList.toggle("on", x.dataset.id === id)));
  return () => { offChange(); offSelect(); page.closest("#page")?.classList.remove("paper"); };
}
