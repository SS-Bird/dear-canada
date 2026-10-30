// Network view: every node and link in the notebook as a force layout. Colleges sit in the
// middle and each lower rank on a wider ring. Shift-drag from one node to another links them.
import { esc, html } from "./util.js";
import * as store from "./store.js";
import { TYPES, TYPE_ORDER, nodeName, nodeLabel } from "./types.js";

const HIDDEN_KEY = "privateWeb.hiddenTypes";
const RING = 130;
const R = { college: 14, course: 10, hc: 8, lo: 8, reference: 6, note: 6, locref: 5 };
const radius = d => (R[d.type] || 6) * (d.starred ? 1.8 : 1);
const trunc = s => s.length > 30 ? s.slice(0, 28) + "…" : s;

export function mount({ stage, openNode }) {
  let hidden = new Set();
  try { hidden = new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY)) || []); } catch { /* none hidden */ }
  let query = "", shape = "", first = true;
  let simNodes = new Map(), nodeSel = null, linkSel = null;

  const view = html(`<div class="netView"><svg aria-label="Notebook network"></svg></div>`);
  const zoomBtns = html(`<div class="zoomBtns">
    <button data-k="zin" aria-label="Zoom in">+</button><button data-k="zout" aria-label="Zoom out">−</button>
    <button data-k="zfit" aria-label="Fit graph" style="font-size:13px">⌂</button></div>`);
  const ctl = html(`<div class="ctl panel">
    <div class="ctlHead"><h1>HC &amp; LO network</h1><button class="mini" data-k="collapse" aria-label="Collapse panel">–</button></div>
    <div class="ctlBody">
      <h2>New node</h2>
      <div class="newRow">
        <select data-k="newType" aria-label="Type of new node">${TYPE_ORDER.map(t => `<option value="${t}"${t === "note" ? " selected" : ""}>${esc(TYPES[t].label)}</option>`).join("")}</select>
        <button class="primary" data-k="new">Add</button>
      </div>
      <input type="text" data-k="search" placeholder="Find a node…" aria-label="Find a node" style="margin-top:12px">
      <div class="legendHead"><h2>Show</h2><button class="mini" data-k="all">all</button></div>
      <div data-k="types"></div>
      <div class="note" style="margin-top:12px">Click a node to write in it. <b>Shift-drag</b> from one node onto another to connect them.</div>
    </div>
    <div class="status" data-k="status"></div>
  </div>`);
  stage.append(view, ctl, zoomBtns);
  const q = k => stage.querySelector(`[data-k="${k}"]`);

  q("collapse").onclick = () => { const c = ctl.classList.toggle("collapsed"); q("collapse").textContent = c ? "+" : "–"; };
  q("new").onclick = () => { const n = store.createNode(q("newType").value); openNode(n.id, { focusTitle: true }); };
  q("search").oninput = e => { query = e.target.value.trim().toLowerCase(); highlight(); };
  q("all").onclick = () => { hidden.clear(); saveHidden(); update(); };

  // ───────────── drawing
  const svg = d3.select(view.querySelector("svg"));
  const g = svg.append("g");
  const linkG = g.append("g"), ghost = g.append("line").attr("class", "ghost").style("display", "none"), nodeG = g.append("g");
  const zoomBeh = d3.zoom().scaleExtent([0.15, 6]).on("zoom", ev => g.attr("transform", ev.transform));
  svg.call(zoomBeh).on("dblclick.zoom", null);
  svg.on("click", () => store.select(null));
  q("zin").onclick = () => svg.transition().duration(200).call(zoomBeh.scaleBy, 1.6);
  q("zout").onclick = () => svg.transition().duration(200).call(zoomBeh.scaleBy, 1 / 1.6);
  q("zfit").onclick = () => fit(true);

  const sim = d3.forceSimulation()
    .force("link", d3.forceLink().id(d => d.id).distance(80).strength(0.3))
    .force("charge", d3.forceManyBody().strength(-260))
    .force("collide", d3.forceCollide(d => radius(d) + 16))
    .force("radial", d3.forceRadial(d => TYPES[d.type].rank * RING, 0, 0).strength(0.5))
    .on("tick", draw);

  let linking = false;
  const drag = d3.drag()
    .on("start", (ev, d) => {
      linking = ev.sourceEvent.shiftKey;
      if (linking) ghost.style("display", null).attr("x1", d.x).attr("y1", d.y).attr("x2", d.x).attr("y2", d.y);
      else { if (!ev.active) sim.alphaTarget(0.2).restart(); d.fx = d.x; d.fy = d.y; }
    })
    .on("drag", (ev, d) => {
      if (linking) ghost.attr("x2", ev.x).attr("y2", ev.y);
      else { d.fx = ev.x; d.fy = ev.y; }
    })
    .on("end", (ev, d) => {
      if (linking) {
        ghost.style("display", "none");
        const t = sim.find(ev.x, ev.y, 28);
        if (t && t !== d) store.link(d.id, t.id);
      } else { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }
    });

  function draw() {
    linkSel?.attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    nodeSel?.attr("transform", d => `translate(${d.x},${d.y})`);
  }

  function startPos(n) {
    const nb = store.neighbours(n.id).map(x => simNodes.get(x.id)).find(Boolean);
    if (nb) return { x: nb.x + (Math.random() - 0.5) * 40, y: nb.y + (Math.random() - 0.5) * 40 };
    const a = Math.random() * 2 * Math.PI, r = TYPES[n.type].rank * RING + 1;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }

  function update() {
    const shown = store.nodes().filter(n => !hidden.has(n.type));
    const ids = new Set(shown.map(n => n.id));
    const next = new Map();
    for (const n of shown) {
      const s = simNodes.get(n.id) || { id: n.id, ...startPos(n) };
      Object.assign(s, { type: n.type, label: nodeLabel(n), name: nodeName(n), starred: !!n.starred });
      next.set(n.id, s);
    }
    simNodes = next;
    const nodes = [...next.values()];
    const links = store.links().filter(l => ids.has(l.a) && ids.has(l.b)).map(l => ({ id: l.id, source: next.get(l.a), target: next.get(l.b) }));

    linkSel = linkG.selectAll("line").data(links, d => d.id).join("line").attr("class", "link");
    nodeSel = nodeG.selectAll("g.node").data(nodes, d => d.id).join(enter => {
      const e = enter.append("g").attr("class", "node").call(drag)
        .on("click", (ev, d) => { ev.stopPropagation(); openNode(d.id); });
      e.append("circle"); e.append("text").attr("y", 4); e.append("title");
      return e;
    });
    nodeSel.classed("star", d => d.starred);
    nodeSel.select("circle").attr("r", radius).attr("fill", d => TYPES[d.type].color);
    nodeSel.select("text").attr("x", d => radius(d) + 4).text(d => trunc(d.label));
    nodeSel.select("title").text(d => `${d.name} (${TYPES[d.type].label})`);

    // Only re-run the layout when nodes or links came or went, not on every keystroke.
    const newShape = nodes.map(n => n.id + (n.starred ? "*" : "")).join() + "|" + links.map(l => l.id).join(); // a star changes sizes too

    if (newShape !== shape) {
      shape = newShape;
      sim.nodes(nodes); // also re-reads the collision radii
      sim.force("link").links(links);
      if (first) { sim.alpha(1); for (let i = 0; i < 200; i++) sim.tick(); }
      sim.alpha(Math.max(sim.alpha(), first ? 0.05 : 0.35)).restart();
      if (!first) setTimeout(() => offScreen() && fit(true), 600);
    }
    draw();
    if (first) { first = false; fit(false); }
    legend();
    highlight();
    const all = store.nodes().length;
    q("status").textContent = `${nodes.length} of ${all} nodes · ${links.length} links` + (nodes.length < all ? " (some types hidden)" : "");
  }

  function fit(animate) {
    const ns = [...simNodes.values()];
    const w = view.clientWidth, h = view.clientHeight, padL = ctl.offsetWidth + 24;
    if (!ns.length) { svg.call(zoomBeh.transform, d3.zoomIdentity.translate(padL + (w - padL) / 2, h / 2)); return; }
    const ring = RING * 1.5; // never zoom in further than this, so a near-empty notebook isn't magnified
    const [x0, x1] = d3.extent([...ns.map(d => d.x), -ring, ring]), [y0, y1] = d3.extent([...ns.map(d => d.y), -ring, ring]);
    const k = Math.min(1.6, 0.85 * Math.min((w - padL) / (x1 - x0 + 120 || 1), h / (y1 - y0 + 80 || 1)));
    const t = d3.zoomIdentity.translate(padL + (w - padL) / 2 - k * (x0 + x1) / 2, h / 2 - k * (y0 + y1) / 2).scale(k);
    (animate ? svg.transition().duration(400) : svg).call(zoomBeh.transform, t);
  }

  function offScreen() {
    const t = d3.zoomTransform(svg.node()), w = view.clientWidth, h = view.clientHeight;
    return [...simNodes.values()].some(d => { const [x, y] = t.apply([d.x, d.y]); return x < 0 || y < 0 || x > w || y > h; });
  }

  function legend() {
    const counts = d3.rollup(store.nodes(), v => v.length, n => n.type);
    q("types").innerHTML = TYPE_ORDER.map(t => `<label class="chip">
      <input type="checkbox" data-type="${t}"${hidden.has(t) ? "" : " checked"}>
      <span class="dot" style="background:${TYPES[t].color}"></span><span class="label">${esc(TYPES[t].plural)}</span>
      <span class="count">${counts.get(t) || 0}</span></label>`).join("");
  }
  q("types").addEventListener("change", e => {
    const t = e.target.dataset.type;
    e.target.checked ? hidden.delete(t) : hidden.add(t);
    saveHidden(); update();
  });
  function saveHidden() { try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden])); } catch { /* fine */ } }

  function highlight() {
    if (!nodeSel) return;
    const sel = store.ui.selected;
    const near = sel ? new Set(store.neighbours(sel).map(n => n.id)) : null;
    nodeSel.classed("sel", d => d.id === sel)
      .classed("dim", d => (query && !d.name.toLowerCase().includes(query)) || (near && d.id !== sel && !near.has(d.id)));
    linkSel.classed("hl", d => d.source.id === sel || d.target.id === sel)
      .classed("dim", d => !!query || (near && d.source.id !== sel && d.target.id !== sel));
  }

  const offChange = store.onChange(() => update());
  const offSelect = store.onSelect(() => highlight());
  update();

  return () => { sim.stop(); offChange(); offSelect(); };
}
