// "Data map" page (Context section): the place and boundary data as a schema diagram, from the
// source files through the pipelines to their outputs and the website pages that read them.
// Solid arrows are data flow; dashed lines join key columns (≈ marks a join on folded names).
// Hover a box to trace its connections; click a table to show all its columns.
// The knowledge network has its own pipeline and is deliberately left out.
import { esc, html } from "./util.js";

const LANES = ["Sources", "Pipelines", "Outputs", "Website"];
const W = 220, GAP_X = 72, HEAD = 38, ROW = 17, GAP_Y = 16, TOP = 34, PAD = 6;

// key: "pk" primary key, "fk" foreign key, "name" joined on folded names
const c = (n, key = "", note = "") => ({ n, key, note });
const NODES = [
  // ── sources
  { id: "entries", lane: 0, kind: "CSV", title: "*_entries.csv", path: "data/Book Repository/Entries as Csv/", note: "One row per diary entry, one file per book",
    cols: [c("book", "pk", "book code, e.g. SofS"), c("entry_id", "pk"), c("chapter_id"), c("date", "", "ISO date of the entry"), c("entry_text")] },
  { id: "lexicon", lane: 0, kind: "CSV", title: "place_lexicon.csv", path: "Pipelines/Place Mentions/resources/", note: "Known names and their types",
    cols: [c("name", "pk"), c("place_type"), c("year_from"), c("year_to"), c("ambiguous"), c("note")] },
  { id: "notplaces", lane: 0, kind: "CSV", title: "not_places.csv", path: "Pipelines/Place Mentions/resources/", note: "Words that are never places",
    cols: [c("term", "pk"), c("reason")] },
  { id: "overrides", lane: 0, kind: "CSV", title: "place_overrides.csv", path: "data/Gazetteers/curated/", note: "Hand-curated historical and problem names",
    cols: [c("name", "name", "matched on folded name and aliases"), c("aliases"), c("place_type"), c("book"), c("year_from"), c("year_to"), c("latitude"), c("longitude"),
      c("matched_name"), c("province"), c("feature_class"), c("location_precision"), c("note")] },
  { id: "world", lane: 0, kind: "CSV", title: "world_places.csv", path: "data/Gazetteers/curated/", note: "Places outside Canada, exact names only",
    cols: [c("name", "name"), c("aliases"), c("place_type"), c("country"), c("region"), c("latitude"), c("longitude"), c("note")] },
  { id: "cgndb", lane: 0, kind: "CSV", title: "cgn_canada_csv_eng.csv", path: "data/Gazetteers/cgndb/", note: "Canadian Geographical Names Database (modern names)",
    cols: [c("CGNDB ID", "pk"), c("Geographical Name", "name"), c("Generic Term"), c("Generic Category"), c("Concise Code"), c("Toponymic Feature ID"), c("Latitude"),
      c("Longitude"), c("Location"), c("Province - Territory"), c("Relevance at Scale"), c("Language"), c("Decision Date"), c("Source")] },
  { id: "corrections", lane: 0, kind: "CSV", title: "place_corrections.csv", path: "data/Gazetteers/curated/", note: "Flags and fixes made on the website",
    cols: [c("id", "pk"), c("mention_id", "fk", "for a one-mention flag"), c("place", "name", "for a book or every-book flag"), c("book"), c("status"), c("kind"), c("scope"),
      c("current_match"), c("correct_name"), c("latitude"), c("longitude"), c("place_type"), c("csd_year"), c("csd_id", "fk", "a subdivision chosen by hand, or none"), c("note"), c("resolution"), c("created"), c("resolved"), c("updated")] },
  { id: "aliases", lane: 0, kind: "CSV", title: "region_aliases.csv", path: "data/Gazetteers/curated/", note: "Province, colony and territory names → region id",
    cols: [c("alias", "name", "compared with a mention's place and matched name"), c("region", "fk", "or world:<Natural Earth name>"), c("note")] },
  { id: "rules", lane: 0, kind: "CSV", title: "region_polygons.csv", path: "data/Gazetteers/curated/", note: "Region id → HACOLP polygons, by year",
    cols: [c("region", "pk"), c("year_from", "pk"), c("polygons", "name", "HACOLP names, ; separated"), c("level"), c("year_to"), c("note")] },
  { id: "tcp", lane: 0, kind: "GDB", title: "TCP_CANADA_CSD_202306.gdb", path: "data/Gazetteers/TCP_CANADA_CSD_202306/", note: "Census subdivisions 1851–1921: layers CANADA_YYYY_CSD, plus 1911 V1T1 and V2T2",
    cols: [c("layer (census year)", "pk"), c("TCPUID_CSD_YYYY", "pk", "repeats across years"), c("NAME_CSD_YYYY"), c("NAME_CD_YYYY"), c("PR_YYYY"), c("geometry")] },
  { id: "hacolp", lane: 0, kind: "ZIP", title: "boundaries_YYYY_poly.zip", path: "data/Gazetteers/doi-10.5683-sp2-iq7e0x/", note: "HACOLP territorial evolution, 47 snapshots 1667–2001",
    cols: [c("snapshot year", "pk"), c("PROV_NAME"), c("COUNTRY"), c("geometry")] },
  { id: "ne", lane: 0, kind: "ZIP", title: "ne_50m_admin_*.zip", path: "data/Gazetteers/naturalearth/", note: "Natural Earth modern countries and US states",
    cols: [c("NAME"), c("ADMIN"), c("geometry")] },

  // ── pipelines
  { id: "p01", lane: 1, proc: true, kind: "notebook", title: "01_place_extraction.ipynb", note: "spaCy NER, person filter, suggested place type" },
  { id: "p02", lane: 1, proc: true, kind: "notebook", title: "02_place_matching.ipynb", note: "Gazetteer matching, census subdivision, corrections; publishes to the site" },
  { id: "p03", lane: 1, proc: true, kind: "script", title: "03_region_boundaries.py", note: "Provinces by year and modern world borders, simplified (less where subdivisions are small)" },
  { id: "p04", lane: 1, proc: true, kind: "script", title: "04_census_boundaries.py", note: "Census layers for the web, overlaps, 1911 crosswalk" },

  // ── outputs
  { id: "extracted", lane: 2, kind: "CSV", title: "place_mentions_extracted.csv", path: "Pipelines/Place Mentions/intermediate/", note: "Every candidate mention, kept or filtered",
    cols: [c("mention_id", "pk"), c("book", "fk"), c("entry_id", "fk"), c("place_key", "", "folded name"), c("place"), c("place_raw"), c("chapter_id"), c("date"), c("date_precision"),
      c("year_inferred"), c("date_raw"), c("year"), c("char_start"), c("char_end"), c("sentence"), c("ner_label"), c("source"), c("votes"), c("keep"), c("filter_reason"),
      c("place_type"), c("type_confidence"), c("type_evidence"), c("model")] },
  { id: "matches", lane: 2, kind: "CSV", title: "place_matches.csv", path: "data/Pipe Outputs/places/", note: "One row per query: a name of one type in one book",
    cols: [c("query_id", "pk", "book:place_key:type"), c("feature_id", "fk", "id in the winning gazetteer (CGNDB ID, TCP id…)"), c("csd_layer_year", "fk"), c("csd_id", "fk"),
      c("book"), c("name"), c("aliases"), c("place_key"), c("place_type"), c("type_confidence"), c("year_min"), c("year_max"), c("year_source"), c("n_mentions"), c("status"),
      c("scope"), c("gazetteer"), c("time_basis"), c("feature_id_alt"), c("matched_name"), c("matched_via"), c("feature_type"), c("feature_class"), c("location_precision"),
      c("province"), c("country"), c("region"), c("latitude"), c("longitude"), c("geometry_type"), c("relevance"), c("name_score"), c("score"), c("book_context_share"),
      c("ambiguous"), c("runner_up_name"), c("runner_up_gazetteer"), c("runner_up_distance_km"), c("csd_status"), c("csd_method"), c("csd_gap_years"), c("csd_name"),
      c("csd_snap_m"), c("csd_same_name"), c("csd_namecd"), c("csd_pr"), c("needs_review"), c("review_reasons")] },
  { id: "mentions", lane: 2, kind: "CSV", title: "place_mentions.csv", path: "data/Pipe Outputs/places/", note: "Main result: one row per kept mention",
    cols: [c("mention_id", "pk"), c("query_id", "fk"), c("book", "fk"), c("entry_id", "fk"), c("place", "name"), c("matched_name", "name"), c("csd_layer_year", "fk"), c("csd_id", "fk"),
      c("chapter_id"), c("date"), c("date_precision"), c("year_inferred"), c("date_raw"), c("place_type"), c("type_confidence"), c("type_evidence"), c("ner_label"),
      c("char_start"), c("char_end"), c("sentence"), c("historicity", "", "true = located"), c("resolution_status"), c("gazetteer"), c("feature_type"), c("location_precision"),
      c("region_historical"), c("region_modern"), c("country"), c("latitude"), c("longitude"), c("csd_name"), c("csd_method"), c("csd_same_name"), c("needs_review"), c("review_reasons")] },
  { id: "candidates", lane: 2, kind: "CSV", title: "place_candidates.csv", path: "Pipelines/Place Mentions/intermediate/matching/", note: "Top candidates per query, for review",
    cols: [c("query_id", "fk"), c("gazetteer", "pk"), c("rank", "pk"), c("feature_id"), c("name"), c("feature_type"), c("feature_class"), c("province"), c("country"), c("relevance"),
      c("latitude"), c("longitude"), c("name_score"), c("score"), c("matched_via"), c("selected")] },
  { id: "context", lane: 2, kind: "CSV", title: "book_context.csv", path: "Pipelines/Place Mentions/intermediate/matching/", note: "Province shares per book",
    cols: [c("book", "pk"), c("province", "pk"), c("share"), c("anchor_mentions"), c("manual")] },
  { id: "csdpoly", lane: 2, kind: "GEOJSON", title: "csd_polygons.geojson", path: "data/Pipe Outputs/places/", note: "Census subdivisions linked at least once",
    cols: [c("layer_year", "pk"), c("csd_id", "pk"), c("csd_name"), c("csd_namecd"), c("csd_pr"), c("km2"), c("queries"), c("geometry")] },
  { id: "bhacolp", lane: 2, kind: "JSON", title: "boundaries_hacolp.json", path: "data/Pipe Outputs/places/", note: "Provinces, colonies and territories at each snapshot",
    cols: [c("layers[year]", "pk"), c("name", "pk"), c("country"), c("g", "", "index into geometries")] },
  { id: "bworld", lane: 2, kind: "JSON", title: "boundaries_world.json", path: "data/Pipe Outputs/places/", note: "Modern countries and US states",
    cols: [c("names", "name", "folded name → features"), c("name"), c("admin"), c("kind"), c("g")] },
  { id: "tcpweb", lane: 2, kind: "JSON", title: "tcp_csd_<layer>.json", path: "data/Pipe Outputs/historical/", note: "One simplified layer per census",
    cols: [c("key", "pk", "1851 … 1921, 1911_V1T1, 1911_V2T2"), c("id", "pk", "TCP id"), c("name"), c("cd"), c("pr"), c("km2"), c("hex", "", "placeholder hexagon")] },
  { id: "links", lane: 2, kind: "JSON", title: "tcp_links_<layer>.json", path: "data/Pipe Outputs/historical/", note: "Overlaps with every other census",
    cols: [c("feature index", "fk"), c("other layer → [index, share, share]", "fk")] },
  { id: "crosswalk", lane: 2, kind: "CSV", title: "tcp_1911_crosswalk.csv", path: "data/Pipe Outputs/historical/", note: "Hybrid 1911 ↔ the two published tables",
    cols: [c("hybrid_id", "fk"), c("table", "fk", "V1T1 or V2T2"), c("table_id", "fk"), c("hybrid_name"), c("cd"), c("pr"), c("table_name"), c("relation"), c("share_of_hybrid"), c("share_of_table")] },

  // ── website
  { id: "wplaces", lane: 3, site: true, kind: "page", title: "Place mentions over time", path: "#/places", note: "Reads the curated region tables and corrections directly, matching them in the browser" },
  { id: "wflags", lane: 3, site: true, kind: "page", title: "Flags & fixes", path: "#/flags", note: "Downloads place_corrections.csv; it replaces the curated file by hand" },
  { id: "whist", lane: 3, site: true, kind: "page", title: "Historical boundaries", path: "#/historical", note: "Census layers, loaded one at a time" },
];

// Data flow (box to box)
const FLOWS = [
  ["entries", "p01"], ["lexicon", "p01"], ["notplaces", "p01"], ["p01", "extracted"],
  ["extracted", "p02"], ["overrides", "p02"], ["world", "p02"], ["cgndb", "p02"], ["tcp", "p02"], ["corrections", "p02"],
  ["p02", "matches"], ["p02", "mentions"], ["p02", "candidates"], ["p02", "context"], ["p02", "csdpoly"],
  ["hacolp", "p03"], ["ne", "p03"], ["tcp", "p03"], ["p03", "bhacolp"], ["p03", "bworld"],
  ["tcp", "p04"], ["p04", "tcpweb"], ["p04", "links"], ["p04", "crosswalk"],
  ["mentions", "wplaces"], ["matches", "wplaces"], ["csdpoly", "wplaces"], ["bhacolp", "wplaces"], ["bworld", "wplaces"],
  ["aliases", "wplaces"], ["rules", "wplaces"], ["corrections", "wplaces"], ["corrections", "wflags"], ["wflags", "corrections", "download"],
  ["bhacolp", "whist"], ["tcpweb", "whist"], ["links", "whist"],
];
// Joins: [from node, from column, to node, to column, label]
const JOINS = [
  ["extracted", "mention_id", "mentions", "mention_id"],
  ["extracted", "book", "entries", "book"], ["extracted", "entry_id", "entries", "entry_id"],
  ["mentions", "query_id", "matches", "query_id"], ["candidates", "query_id", "matches", "query_id"],
  ["context", "book", "entries", "book"],
  ["matches", "feature_id", "cgndb", "CGNDB ID", "when gazetteer = cgndb"],
  ["mentions", "csd_layer_year", "csdpoly", "layer_year"], ["mentions", "csd_id", "csdpoly", "csd_id"],
  ["csdpoly", "csd_id", "tcp", "TCPUID_CSD_YYYY"], ["tcpweb", "id", "tcp", "TCPUID_CSD_YYYY"],
  ["crosswalk", "hybrid_id", "tcpweb", "id", "1911"], ["crosswalk", "table_id", "tcpweb", "id", "1911_V1T1 / V2T2"],
  ["links", "feature index", "tcpweb", "key"],
  ["corrections", "mention_id", "mentions", "mention_id"], ["corrections", "csd_id", "tcpweb", "id", "csd_year = key"], ["corrections", "place", "mentions", "place", "≈"],
  ["aliases", "alias", "mentions", "place", "≈"], ["aliases", "region", "rules", "region"], ["rules", "polygons", "bhacolp", "name", "≈"],
  ["aliases", "region", "bworld", "names", "world:"],
];

const expanded = new Set();
// Long folders lose their start so the type tag still fits on the same line
const fitPath = p => p.length > 34 ? "…" + p.slice(-33) : p;

export function renderDataMap(root) {
  root.replaceChildren(html(`<div>
    <h1>Data map</h1>
    <div class="kicker">Context</div>
    <p class="lead">How the place and boundary data fit together: the source files, the pipelines that read them, what they write, and the pages of this site that use it.</p>
    <div class="dmLegend">
      <span><svg width="34" height="10"><line x1="0" y1="5" x2="28" y2="5" class="dmFlow"/><path d="M28,1 L34,5 L28,9 Z" class="dmHead"/></svg> data flow</span>
      <span><svg width="34" height="10"><line x1="0" y1="5" x2="34" y2="5" class="dmJoin"/></svg> join on a key</span>
      <span><b class="dmKey pk">PK</b> key <b class="dmKey fk">FK</b> refers to another table <b class="dmKey name">≈</b> joined on folded names</span>
      <span class="muted">Hover a box to trace it; click a table for all its columns.</span>
    </div>
    <div class="dmWrap"></div>
  </div>`));
  draw(root.querySelector(".dmWrap"));
}

function layout() {
  const byId = new Map(NODES.map(n => [n.id, n]));
  const incoming = d3.group(FLOWS, f => f[1]);
  const laneY = LANES.map(() => TOP);
  for (const n of NODES) {
    n.x = n.lane * (W + GAP_X);
    n.shown = n.cols ? (expanded.has(n.id) ? n.cols : n.cols.filter(col => col.key)) : [];
    const more = n.cols && n.cols.length > n.shown.length;
    n.h = n.proc || n.site ? 52 : HEAD + n.shown.length * ROW + (more || expanded.has(n.id) ? ROW : 0) + PAD;
    // Pipelines and later lanes sit level with what feeds them, when there is room
    const srcs = (incoming.get(n.id) || []).map(f => byId.get(f[0])).filter(s => s.lane < n.lane && s.y != null);
    const want = n.lane && srcs.length ? d3.mean(srcs, s => s.y + s.h / 2) - n.h / 2 : TOP;
    n.y = Math.max(laneY[n.lane], want);
    laneY[n.lane] = n.y + n.h + GAP_Y;
  }
  return { byId, height: Math.max(...laneY) + 20, width: LANES.length * W + (LANES.length - 1) * GAP_X + 20 };
}

function draw(wrap) {
  const { byId, height, width } = layout();
  const colY = (n, name) => { const i = n.shown.findIndex(col => col.n === name); return i < 0 ? n.y + 18 : n.y + HEAD + i * ROW + ROW / 2; };
  // From one box side to another; boxes in the same lane loop out to the right
  const path = (a, ya, b, yb) => {
    if (a.lane === b.lane) { const x = a.x + W, bend = 26 + Math.min(60, Math.abs(yb - ya) / 6); return `M${x},${ya} C${x + bend},${ya} ${x + bend},${yb} ${x},${yb}`; }
    const right = b.lane > a.lane, x1 = right ? a.x + W : a.x, x2 = right ? b.x : b.x + W, k = Math.max(40, Math.abs(x2 - x1) / 2.5) * (right ? 1 : -1);
    return `M${x1},${ya} C${x1 + k},${ya} ${x2 - k},${yb} ${x2},${yb}`;
  };
  const edges = [
    ...FLOWS.map(([f, t, label]) => ({ f, t, cls: "dmFlow", label, title: `${f} → ${t}`, d: path(byId.get(f), byId.get(f).y + 18, byId.get(t), byId.get(t).y + 18) })),
    ...JOINS.map(([f, fc, t, tc, label]) => ({ f, t, cls: "dmJoin", label: label && label !== "≈" ? label : null, title: `${f}.${fc} → ${t}.${tc}`,
      d: path(byId.get(f), colY(byId.get(f), fc), byId.get(t), colY(byId.get(t), tc)) })),
  ];
  const kindOf = n => n.proc ? "dmProc" : n.site ? "dmSite" : "dmTable";
  const svg = `<svg class="dmSvg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Diagram of the place and boundary data">
    <defs><marker id="dmArrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 Z" class="dmHead"/></marker></defs>
    ${LANES.map((l, i) => `<text class="dmLane" x="${i * (W + GAP_X)}" y="16">${l}</text>`).join("")}
    <g class="dmEdges">${edges.map((e, i) => `<path class="${e.cls}" data-e="${i}" d="${e.d}"${e.cls === "dmFlow" ? ' marker-end="url(#dmArrow)"' : ""}>${e.title ? `<title>${esc(e.title)}${e.label ? " (" + esc(e.label) + ")" : ""}</title>` : ""}</path>`).join("")}</g>
    ${NODES.map(n => `<g class="dmNode ${kindOf(n)}" data-n="${n.id}" transform="translate(${n.x},${n.y})">
      <title>${esc(n.note || "")}</title>
      <rect class="dmBox" width="${W}" height="${n.h}" rx="${n.proc ? 22 : 6}"/>
      ${n.proc || n.site ? `
        <text class="dmTitle" x="${W / 2}" y="22" text-anchor="middle">${esc(n.title)}</text>
        <text class="dmSub" x="${W / 2}" y="39" text-anchor="middle">${esc(n.site ? n.path : n.kind)}</text>` : `
        <rect class="dmHeadBar" width="${W}" height="${HEAD - 4}" rx="6"/>
        <text class="dmTitle" x="10" y="16">${esc(n.title)}</text>
        <text class="dmTag" x="${W - 10}" y="29" text-anchor="end">${esc(n.kind)}</text>
        <text class="dmSub" x="10" y="29">${esc(fitPath(n.path))}<title>${esc(n.path)}</title></text>
        ${n.shown.map((col, i) => `<g transform="translate(0,${HEAD + i * ROW})">${col.note ? `<title>${esc(col.note)}</title>` : ""}
          ${col.key ? `<text class="dmKeyTxt ${col.key}" x="10" y="12">${col.key === "name" ? "≈" : col.key.toUpperCase()}</text>` : ""}
          <text class="dmCol" x="34" y="12">${esc(col.n)}</text></g>`).join("")}
        ${n.cols.length > n.shown.length || expanded.has(n.id) ? `<text class="dmMore" x="34" y="${HEAD + n.shown.length * ROW + 12}">${expanded.has(n.id) ? "show keys only" : `+ ${n.cols.length - n.shown.length} more columns`}</text>` : ""}`}
    </g>`).join("")}
  </svg>`;
  wrap.innerHTML = svg;

  // Hover: light up a box's edges and neighbours
  const svgEl = wrap.querySelector("svg");
  wrap.querySelectorAll(".dmNode").forEach(g => {
    const id = g.dataset.n;
    g.onmouseenter = () => {
      const near = new Set([id]);
      edges.forEach((e, i) => {
        const on = e.f === id || e.t === id;
        if (on) { near.add(e.f); near.add(e.t); }
        svgEl.querySelector(`[data-e="${i}"]`).classList.toggle("on", on);
      });
      svgEl.classList.add("tracing");
      wrap.querySelectorAll(".dmNode").forEach(o => o.classList.toggle("near", near.has(o.dataset.n)));
    };
    g.onmouseleave = () => { svgEl.classList.remove("tracing"); };
    if (NODES.find(n => n.id === id).cols) g.onclick = () => { expanded.has(id) ? expanded.delete(id) : expanded.add(id); draw(wrap); };
  });
}
