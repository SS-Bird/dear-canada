// Knowledge network — the v3 network explorer. Loads every nodes/edges file of one
// pipeline run (the manifest "group", e.g. SofS_entries_halved) and draws a force layout
// over the map. Clicking a node opens its properties and connections on the right.
import { esc, html, cssVar } from "../util.js";
import { fetchDataset } from "../data.js";
import { bookTitle } from "../books.js";

const TYPES = ["character", "location", "region", "organization", "identity_category", "entry", "date", "stay", "health_state", "incident"];
const LABELLED = new Set(["character", "location", "region", "organization"]); // labels shown before zooming in
const ID_FIELD_TO_TYPE = { character_id: "character", location_id: "location", region_id: "region", org_id: "organization",
  identity_category_id: "identity_category", entry_id: "entry", date_id: "date", stay_id: "stay",
  health_state_id: "health_state", incident_id: "incident" };
const color = d3.scaleOrdinal().domain(TYPES).range(d3.schemeTableau10);
const nice = t => String(t).replace(/_/g, " ");
const labelFor = o => o.canonical_label || o.condition_name || o.stay_type || o.incident_type || o.raw_text || o.normalized_date || o.entry_id || null;

export function mount({ stage, panel, manifest }) {
  let alive = true, sim = null, playTimer = null;
  let nodesById = {}, links = [], nodeSel, linkSel, zoomBeh, svg;
  let hiddenTypes = new Set(), showInterp = true, query = "";
  let allDates = [], nodeDates = {}, dateOn = false, selected = null;
  let protagonistId = null, protagStays = [], withinOf = {};

  const files = manifest.datasets.filter(d => d.project === "network" && (d.role === "nodes" || d.role === "edges"));
  const groups = [...new Set(files.map(d => d.group || "default"))];

  const view = html(`<div class="netView"><svg aria-label="Knowledge network"></svg></div>`);
  const zoomBtns = html(`<div class="zoomBtns">
    <button data-k="zin" aria-label="Zoom in">+</button><button data-k="zout" aria-label="Zoom out">−</button>
    <button data-k="zfit" aria-label="Fit graph" style="font-size:13px">⌂</button></div>`);
  const ctl = html(`<div class="ctl panel">
    <div class="ctlHead"><h1>Knowledge network</h1><button class="mini" data-k="collapse" aria-label="Collapse panel">–</button></div>
    <div class="ctlBody">
      <div data-k="groupWrap" ${groups.length > 1 ? "" : "hidden"}><h2>Pipeline run</h2>
        <select data-k="group" style="width:100%;margin-bottom:10px">${groups.map(g => `<option value="${esc(g)}">${esc(bookTitle(g))} · ${esc(g)}</option>`).join("")}</select></div>
      <input type="text" data-k="search" placeholder="Find a node…" aria-label="Find a node">
      <h2 style="margin-top:14px">Node types</h2>
      <div data-k="types"></div>
      <h2 style="margin-top:14px">Edges</h2>
      <label class="chip"><input type="checkbox" data-k="interp" checked><span class="label">Show interpretive (dashed)</span></label>
      <h2 style="margin-top:14px">Timeline</h2>
      <label class="chip"><input type="checkbox" data-k="dateOn"><span class="label">Filter by date</span></label>
      <div data-k="dateCtl" hidden style="margin-top:6px">
        <input type="range" data-k="slider" min="0" max="0" value="0" style="width:100%;accent-color:var(--accent)" aria-label="Date">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
          <button data-k="play" class="mini">▶ Play</button><span class="muted" data-k="dateLabel">—</span>
        </div>
      </div>
      <div class="note" style="margin-top:12px">Drag nodes to rearrange. Click a node for its properties and connections.</div>
    </div>
    <div class="status" data-k="status">Loading…</div>
  </div>`);
  stage.append(view, ctl, zoomBtns);
  const q = k => stage.querySelector(`[data-k="${k}"]`);

  q("collapse").onclick = () => { const c = ctl.classList.toggle("collapsed"); q("collapse").textContent = c ? "+" : "–"; };
  q("group").onchange = e => load(e.target.value);
  q("search").oninput = e => { query = e.target.value.trim().toLowerCase(); applyFilters(); };
  q("interp").onchange = e => { showInterp = e.target.checked; applyFilters(); };
  q("dateOn").onchange = e => { dateOn = e.target.checked; q("dateCtl").hidden = !dateOn; if (!dateOn) stopPlay(); applyFilters(); renderRight(); };
  q("slider").oninput = () => { updateDateLabel(); applyFilters(); renderRight(); };
  q("play").onclick = () => {
    if (playTimer) { stopPlay(); return; }
    q("play").textContent = "⏸ Pause";
    playTimer = setInterval(() => {
      const s = q("slider"); s.value = +s.value + 1 > +s.max ? 0 : +s.value + 1;
      updateDateLabel(); applyFilters(); renderRight();
    }, 700);
  };
  panel.onClose = () => {
    selected = null;
    if (dateOn) { q("dateOn").checked = false; dateOn = false; q("dateCtl").hidden = true; stopPlay(); }
    applyFilters();
  };
  function stopPlay() { clearInterval(playTimer); playTimer = null; q("play").textContent = "▶ Play"; }

  if (!files.length) q("status").textContent = "No network nodes/edges files in data_sources.json.";
  else load(groups[0]);

  // ───────────── load + build
  async function load(group) {
    q("status").textContent = "Loading…";
    stopPlay(); selected = null; panel.close();
    const mine = files.filter(d => (d.group || "default") === group);
    let tables;
    try { tables = await Promise.all(mine.map(d => fetchDataset(d).then(data => ({ d, data })))); }
    catch (e) { if (alive) q("status").textContent = e.message; return; }
    if (!alive) return;

    nodesById = {}; let edges = [];
    for (const { d, data } of tables) {
      if (!Array.isArray(data) || !data.length) continue;
      if (d.role === "edges" || "edge_type" in data[0]) { edges = edges.concat(data); continue; }
      const idField = Object.keys(data[0]).find(k => k in ID_FIELD_TO_TYPE);
      if (!idField) continue;
      const type = ID_FIELD_TO_TYPE[idField];
      for (const row of data) if (row[idField]) nodesById[row[idField]] = { id: row[idField], type, label: labelFor(row) || row[idField], props: row };
    }
    // placeholder nodes for edge endpoints with no node file, so edges alone still draw
    for (const e of edges) for (const [ik, tk] of [["from_id", "from_type"], ["to_id", "to_type"]]) {
      const id = e[ik];
      if (id && !nodesById[id]) nodesById[id] = { id, type: e[tk] || "entry", label: id, props: {} };
    }
    links = edges.filter(e => nodesById[e.from_id] && nodesById[e.to_id]).map(e => ({ ...e, source: e.from_id, target: e.to_id }));
    indexDates();
    render();
  }

  // Every edge carries the entry it came from, so a date resolves as edge → entry → entry_date,
  // unless the edge touches a date node directly (more precise, e.g. a narrated date).
  function indexDates() {
    const nodes = Object.values(nodesById);
    const entryDate = {};
    nodes.forEach(n => { if (n.type === "entry" && n.props.entry_date) entryDate[n.id] = n.props.entry_date; });
    nodeDates = {};
    nodes.forEach(n => { nodeDates[n.id] = new Set(n.type === "date" && n.props.normalized_date ? [n.props.normalized_date] : []); });
    links.forEach(e => {
      const a = nodesById[e.from_id], b = nodesById[e.to_id];
      const d = b.type === "date" ? b.props.normalized_date : a.type === "date" ? a.props.normalized_date : entryDate[e.entry_id] || null;
      e._date = d;
      if (d) { nodeDates[e.from_id].add(d); nodeDates[e.to_id].add(d); }
    });
    allDates = [...new Set(Object.values(nodeDates).flatMap(s => [...s]))].sort();
    q("slider").max = Math.max(0, allDates.length - 1); q("slider").value = 0;
    updateDateLabel();

    // protagonist = the character whose relation_to_narrator is "self"
    const protag = nodes.find(n => n.type === "character" && n.props.relation_to_narrator === "self");
    protagonistId = protag?.id ?? null;
    const stayLoc = {}; withinOf = {};
    links.forEach(e => { if (e.edge_type === "at") stayLoc[e.from_id] = e.to_id; if (e.edge_type === "within") withinOf[e.from_id] = e.to_id; });
    protagStays = links.filter(e => e.edge_type === "has_stay" && e.from_id === protagonistId)
      .map(e => nodesById[e.to_id])
      .map(s => ({ loc: nodesById[stayLoc[s.id]], arrival: s.props.arrival_date, departure: s.props.departure_date, type: s.props.stay_type, mode: s.props.mode }))
      .filter(s => s.loc).sort((a, b) => (a.arrival || "").localeCompare(b.arrival || ""));
  }

  function render() {
    const nodes = Object.values(nodesById);
    q("status").textContent = `${nodes.length} nodes · ${links.length} edges`;
    buildLegend(nodes);
    if (sim) sim.stop();
    svg = d3.select(view.querySelector("svg"));
    svg.selectAll("*").remove();
    const w = view.clientWidth, h = view.clientHeight;

    svg.append("defs").append("marker").attr("id", "arrow").attr("viewBox", "0 -4 8 8").attr("refX", 16).attr("refY", 0)
      .attr("markerWidth", 7).attr("markerHeight", 7).attr("orient", "auto")
      .append("path").attr("d", "M0,-4L8,0L0,4").attr("fill", cssVar("--ink-dim") || "#888");
    const g = svg.append("g");
    zoomBeh = d3.zoom().scaleExtent([0.1, 8]).on("zoom", ev => {
      g.attr("transform", ev.transform);
      nodeSel?.select("text").style("display", d => ev.transform.k > 1.4 || LABELLED.has(d.type) ? null : "none");
    });
    svg.call(zoomBeh).on("dblclick.zoom", null);
    svg.on("click", () => { if (selected) { selected = null; renderRight(); applyFilters(); } });
    q("zin").onclick = () => svg.transition().duration(200).call(zoomBeh.scaleBy, 1.6);
    q("zout").onclick = () => svg.transition().duration(200).call(zoomBeh.scaleBy, 1 / 1.6);
    q("zfit").onclick = () => fit(true);

    linkSel = g.append("g").selectAll("line").data(links).join("line")
      .attr("class", d => "link" + (d.interpretive ? " interpretive" : "")).attr("marker-end", "url(#arrow)");
    nodeSel = g.append("g").selectAll("g").data(nodes, d => d.id).join("g").attr("class", "node")
      .call(d3.drag()
        .on("start", (ev, d) => { if (!ev.active) sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag", (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
        .on("end", (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }))
      .on("click", (ev, d) => { ev.stopPropagation(); select(d); });
    nodeSel.append("circle").attr("r", d => d.type === "character" ? 9 : 6).attr("fill", d => color(d.type));
    nodeSel.append("text").attr("x", 10).attr("y", 4).text(d => d.label.length > 28 ? d.label.slice(0, 26) + "…" : d.label)
      .style("display", d => LABELLED.has(d.type) ? null : "none");
    nodeSel.append("title").text(d => `${d.label} (${nice(d.type)})`);

    sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id(d => d.id).distance(65).strength(0.5))
      .force("charge", d3.forceManyBody().strength(-130))
      .force("center", d3.forceCenter(w / 2, h / 2))
      .force("collide", d3.forceCollide(20))
      .force("x", d3.forceX(w / 2).strength(0.04)) // keeps disconnected nodes from drifting off
      .force("y", d3.forceY(h / 2).strength(0.04))
      .stop();
    sim.tick(160); // settle most of the way before first paint, so the fit is meaningful
    const draw = () => {
      linkSel.attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
      nodeSel.attr("transform", d => `translate(${d.x},${d.y})`);
    };
    draw(); fit(false);
    sim.on("tick", draw).alpha(0.08).restart();
    applyFilters();
  }

  function fit(animate) {
    const ns = Object.values(nodesById);
    if (!ns.length || !svg) return;
    const xs = ns.map(d => d.x).sort(d3.ascending), ys = ns.map(d => d.y).sort(d3.ascending);
    const [x0, x1, y0, y1] = [d3.quantileSorted(xs, .01), d3.quantileSorted(xs, .99), d3.quantileSorted(ys, .01), d3.quantileSorted(ys, .99)];
    const w = view.clientWidth, h = view.clientHeight, padL = ctl.offsetWidth + 24;
    const k = Math.min(2, 0.92 * Math.min((w - padL) / (x1 - x0 || 1), h / (y1 - y0 || 1)));
    const t = d3.zoomIdentity.translate(padL + (w - padL) / 2 - k * (x0 + x1) / 2, h / 2 - k * (y0 + y1) / 2).scale(k);
    (animate ? svg.transition().duration(400) : svg).call(zoomBeh.transform, t);
  }

  function buildLegend(nodes) {
    const counts = d3.rollup(nodes, v => v.length, n => n.type);
    const list = d3.select(q("types")); list.selectAll("*").remove();
    TYPES.filter(t => counts.get(t)).forEach(t => {
      const row = list.append("label").attr("class", "chip");
      row.append("input").attr("type", "checkbox").property("checked", !hiddenTypes.has(t))
        .on("change", function () { this.checked ? hiddenTypes.delete(t) : hiddenTypes.add(t); applyFilters(); });
      row.append("span").attr("class", "dot").style("background", color(t));
      row.append("span").attr("class", "label").text(nice(t));
      row.append("span").attr("class", "count").text(counts.get(t));
    });
  }

  // ───────────── filters + selection
  const curDate = () => dateOn ? allDates[+q("slider").value] : null;
  function updateDateLabel() { q("dateLabel").textContent = allDates[+q("slider").value] || "—"; }

  function applyFilters() {
    if (!nodeSel) return;
    const date = curDate();
    const nodeOK = d => !hiddenTypes.has(d.type) && (!date || nodeDates[d.id]?.has(date)) && (!query || d.label.toLowerCase().includes(query));
    const neigh = selected ? new Set(links.flatMap(e => e.source.id === selected.id ? [e.target.id] : e.target.id === selected.id ? [e.source.id] : [])) : null;
    nodeSel.classed("dim", d => !nodeOK(d) || (neigh && d !== selected && !neigh.has(d.id)))
      .classed("sel", d => d === selected);
    linkSel.classed("dim", d => hiddenTypes.has(d.source.type) || hiddenTypes.has(d.target.type) || (d.interpretive && !showInterp) ||
        (date && d._date !== date) || !!query || (neigh && d.source !== selected && d.target !== selected))
      .classed("hl", d => !!selected && (d.source === selected || d.target === selected));
  }

  function select(d) { selected = d; applyFilters(); renderRight(); }

  const lbl = id => nodesById[id]?.label ?? id;
  const link = id => `<span data-node="${esc(id)}">${esc(lbl(id))}</span>`;

  function renderRight() {
    if (!selected && !dateOn) { if (panel.isOpen) { const cb = panel.onClose; panel.onClose = null; panel.close(); panel.onClose = cb; } return; }
    let body = "";
    if (selected) body += nodeDetail(selected);
    if (dateOn) body += datePanel(curDate());
    const el = html(`<div>${body}</div>`);
    el.addEventListener("click", ev => {
      const t = ev.target.closest("[data-node]");
      if (t && nodesById[t.dataset.node]) select(nodesById[t.dataset.node]);
    });
    if (selected) panel.open(selected.label, `<span class="dot" style="background:${color(selected.type)}"></span> ${esc(nice(selected.type))}`, el);
    else panel.open(curDate() || "—", `date ${allDates.indexOf(curDate()) + 1} of ${allDates.length}`, el);
  }

  function nodeDetail(d) {
    let h = "<h3>Properties</h3>" + (Object.entries(d.props || {}).filter(([, v]) => !(v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)))
      .map(([k, v]) => `<div class="prop"><b>${esc(k)}:</b> ${esc(Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : v)}</div>`).join("")
      || '<div class="muted">No node file loaded for this id.</div>');
    const conn = links.filter(e => e.source === d || e.target === d);
    h += `<h3>Connections (${conn.length})</h3>`;
    const byType = d3.group(conn, e => e.edge_type);
    [...byType.keys()].sort().forEach(t => {
      h += `<div class="grp">${esc(t)} · ${byType.get(t).length}</div>`;
      byType.get(t).forEach(e => {
        const out = e.source === d, other = out ? e.target : e.source;
        const props = Object.entries(e.properties || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(", ");
        h += `<div class="row">${out ? "→" : "←"} ${link(other.id)} <span class="muted">${esc(nice(other.type))}${e.interpretive ? " · interpretive" : ""}${e._date ? " · " + esc(e._date) : ""}</span>` +
          (props ? `<div class="muted">${esc(props)}</div>` : "") + "</div>";
      });
    });
    return h;
  }

  function datePanel(date) {
    let h = selected ? `<h3 style="margin-top:26px;font-size:13px;color:var(--ink)">On ${esc(date || "—")}</h3>` : "";
    h += "<h3>Protagonist's location</h3>";
    const P = nodesById[protagonistId];
    if (!P) h += '<div class="muted">No character with relation_to_narrator = "self", so location is unavailable.</div>';
    else {
      const fmt = s => `<div class="row">${link(s.loc.id)} <span class="muted">${esc(s.type || "")}${s.mode ? " · " + esc(s.mode) : ""}${withinOf[s.loc.id] ? " · in " + esc(lbl(withinOf[s.loc.id])) : ""}</span></div>`;
      const here = protagStays.filter(s => s.arrival === date && s.type !== "intended");
      const intended = protagStays.filter(s => s.arrival === date && s.type === "intended");
      h += `<div class="muted">${link(P.id)}</div>`;
      if (here.length) h += here.map(fmt).join("") + '<div class="muted">stated on this date</div>';
      else {
        const last = protagStays.filter(s => s.arrival && s.arrival < date && s.type !== "intended").at(-1);
        h += last ? fmt(last) + `<div class="muted">carried forward from ${esc(last.arrival)}${last.departure && last.departure < date ? ` (a departure was recorded on ${esc(last.departure)})` : ""}</div>`
          : '<div class="muted">No stay recorded on or before this date.</div>';
      }
      if (intended.length) h += '<div class="muted" style="margin-top:6px">Heading toward:</div>' + intended.map(fmt).join("");
    }
    const entries = Object.values(nodesById).filter(n => n.type === "entry" && n.props.entry_date === date);
    h += "<h3>Entry</h3>" + (entries.map(n => `<div class="row">${link(n.id)} <span class="muted">${esc(n.props.chapter_id || "")}${n.props.entry_date_raw ? " · “" + esc(n.props.entry_date_raw) + "”" : ""}</span></div>`).join("")
      || '<div class="muted">No entry is dated this day — it is reached only through a narrated date inside another entry.</div>');
    const es = links.filter(e => e._date === date);
    h += `<h3>Edges on this date (${es.length})</h3><div class="scrollBox">`;
    const byType = d3.group(es, e => e.edge_type);
    [...byType.keys()].sort().forEach(t => {
      h += `<div class="grp">${esc(t)} · ${byType.get(t).length}</div>` +
        byType.get(t).map(e => `<div class="row">${link(e.source.id)} → ${link(e.target.id)}${e.interpretive ? " ◌" : ""}</div>`).join("");
    });
    return h + "</div>";
  }

  return () => { alive = false; sim?.stop(); stopPlay(); };
}
