// "Flags & fixes" page (Context section): a dated log of every flag and how it was resolved,
// with the download that turns this browser's flags into place_corrections.csv.
import { esc, html } from "./util.js";
import { bookTitle } from "./books.js";
import { loadFlags, allFlags, isLocal, isPublished, localCount, onFlagsChange, saveFlag, discardLocal,
  downloadCSV, importCSV, KINDS } from "./flags.js";

const fmtDay = d3.timeFormat("%A %-d %B %Y"), fmtTime = d3.timeFormat("%H:%M");
let filter = "all", offPrev = null;

export async function renderFlags(root, manifest) {
  await loadFlags(manifest);
  offPrev?.();
  offPrev = onFlagsChange(() => { if (!root.closest("[hidden]")) draw(); });
  draw();

  function draw() {
    const flags = allFlags(), n = localCount();
    const counts = d3.rollup(flags, v => v.length, f => f.status);
    const shown = flags.filter(f => filter === "all" || (filter === "local" ? isLocal(f.id) : f.status === filter));
    root.replaceChildren(html(`<div>
      <h1>Flags &amp; fixes</h1>
      <div class="kicker">Context</div>
      <p class="lead">A record of place mentions that were flagged on the map as wrong or unmatched, and how each one was resolved.</p>
      ${n ? `<div class="notice">
        <b>${n} change${n === 1 ? " is" : "s are"} saved only in this browser.</b> To add ${n === 1 ? "it" : "them"} to the data:
        download <code>place_corrections.csv</code>, replace <code>data/Gazetteers/curated/place_corrections.csv</code> with it,
        run <code>python3 Web/scripts/sync_data.py</code> (or re-run the matching notebook, which also applies the corrections
        to <code>place_mentions.csv</code>), then commit and push.
      </div>` : ""}
      <div class="meta">
        <span><b>${counts.get("open") || 0}</b> open</span>
        <span><b>${counts.get("resolved") || 0}</b> resolved</span>
        <span><b>${counts.get("dismissed") || 0}</b> dismissed</span>
        <span><b>${n}</b> not yet downloaded</span>
      </div>
      <div class="btnRow">
        <button class="primary" data-a="download">Download place_corrections.csv</button>
        <button data-a="import">Import a CSV…</button>
        <input type="file" accept=".csv,text/csv" data-a="file" hidden>
        <a href="#/places" style="align-self:center;margin-left:6px">Open the map to flag a place</a>
      </div>
      <h2>History</h2>
      <div class="filters">${[["all", "All"], ["open", "Open"], ["resolved", "Resolved"], ["dismissed", "Dismissed"], ["local", "Not yet downloaded"]]
        .map(([k, v]) => `<button class="mini${filter === k ? " on" : ""}" data-filter="${k}">${v}</button>`).join("")}</div>
      <div class="flagLog">${log(shown) || `<p class="muted" style="margin-top:18px">${flags.length ? "Nothing matches this filter." : "No flags yet. Click any place on the map, then “Flag or correct…”."}</p>`}</div>
    </div>`));
    const $ = s => root.querySelector(s);
    $("[data-a=download]").onclick = () => downloadCSV();
    $("[data-a=import]").onclick = () => $("[data-a=file]").click();
    $("[data-a=file]").onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      const k = importCSV(await file.text());
      alert(`${k} flag${k === 1 ? "" : "s"} imported or updated.`);
    };
    root.querySelectorAll("[data-filter]").forEach(b => b.onclick = () => { filter = b.dataset.filter; draw(); });
    root.querySelectorAll("[data-act]").forEach(b => b.onclick = () => {
      const f = flags.find(x => x.id === b.dataset.id);
      if (b.dataset.act === "discard") { if (confirm(isPublished(f.id) ? "Undo the changes made in this browser?" : "Delete this flag?")) discardLocal(f.id); }
      else if (b.dataset.act === "dismiss") saveFlag({ ...f, status: "dismissed" });
    });
  }
}

// One event when a flag is raised, and one when it is resolved or dismissed (a single "Corrected"
// event when it was resolved straight away). Grouped by day, newest first.
function log(flags) {
  const evs = [];
  for (const f of flags) {
    const direct = f.resolved && f.resolved === f.created;
    evs.push({ f, at: f.created, type: direct ? (f.status === "dismissed" ? "Dismissed" : "Corrected") : "Flagged" });
    if (f.resolved && !direct) evs.push({ f, at: f.resolved, type: f.status === "dismissed" ? "Dismissed" : "Resolved" });
  }
  evs.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  let day = "";
  return evs.map(({ f, at, type }) => {
    const d = new Date(at), dayKey = isNaN(d) ? "Undated" : fmtDay(d);
    const head = dayKey !== day ? `<div class="day">${esc(dayKey)}</div>` : "";
    day = dayKey;
    const where = f.scope === "mention" ? `one mention in ${bookTitle(f.book)}${f.mention_id ? ` (${f.mention_id.split(":").slice(1).join(":")})` : ""}`
      : f.scope === "book" ? `all mentions in ${bookTitle(f.book)}` : "all mentions in every book";
    const isRes = type !== "Flagged";
    return head + `<div class="ev">
      <time>${isNaN(d) ? "" : fmtTime(d)}</time>
      <div>
        <div class="what"><span class="badge s-${isRes ? esc(f.status) : "open"}">${type}</span>
          <b>“${esc(f.place)}”</b> · ${esc(KINDS[f.kind] || f.kind)}
          ${isLocal(f.id) ? '<span class="badge local">not yet downloaded</span>' : ""}</div>
        <div class="det">${esc(where)} · was ${esc(f.current_match || "—")}${isRes && f.resolution ? ` · ${esc(f.resolution)}` : ""}</div>
        ${f.note ? `<div class="det">${esc(f.note)}</div>` : ""}
        <div class="acts">
          <a href="#/places?q=${encodeURIComponent(f.place)}">Find on map</a>
          ${type === "Flagged" && f.status === "open" ? `<button data-act="dismiss" data-id="${esc(f.id)}">Dismiss</button>` : ""}
          ${isLocal(f.id) ? `<button data-act="discard" data-id="${esc(f.id)}">${isPublished(f.id) ? "Undo local edits" : "Delete"}</button>` : ""}
        </div>
      </div></div>`;
  }).join("");
}

