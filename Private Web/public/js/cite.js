import { CITE_RE } from "./util.js";

// Chicago (17th ed., notes and bibliography) citations for reference nodes, written as
// markdown (*italics*), plus DOI lookup through Crossref and ISBN lookup through Open Library.

export const KINDS = {
  book:    { label: "Book", fields: ["authors", "editors", "title", "edition", "place", "publisher", "year", "doi", "url"] },
  chapter: { label: "Chapter in an edited book", fields: ["authors", "title", "container", "editors", "pages", "place", "publisher", "year", "doi", "url"] },
  article: { label: "Journal article", fields: ["authors", "title", "container", "volume", "issue", "year", "pages", "doi", "url"] },
  web:     { label: "Web page", fields: ["authors", "title", "container", "date", "accessed", "url"] },
  report:  { label: "Report", fields: ["authors", "title", "place", "publisher", "year", "url"] },
  thesis:  { label: "Thesis or dissertation", fields: ["authors", "title", "genre", "publisher", "year", "url"] },
  other:   { label: "Other", fields: ["authors", "title", "container", "publisher", "year", "url"] },
};

export const FIELD_LABELS = {
  authors: "Authors — one per line, “Last, First” (or an organisation)",
  editors: "Editors — one per line, “Last, First”",
  title: "Title (with subtitle)",
  container: { chapter: "Book title", article: "Journal", web: "Website name", other: "Published in" },
  edition: "Edition (e.g. 2nd)", place: "Place of publication", publisher: { thesis: "University", default: "Publisher" },
  year: "Year", pages: "Pages (e.g. 12–34)", volume: "Volume", issue: "Issue", doi: "DOI", url: "URL",
  date: "Date published (YYYY-MM-DD)", accessed: "Date accessed (YYYY-MM-DD)", genre: "Type (e.g. PhD diss., MA thesis)",
};
export const fieldLabel = (f, kind) => {
  const l = FIELD_LABELS[f];
  return typeof l === "string" ? l : l[kind] || l.default || f;
};

// ───────────── names
const people = s => String(s || "").split("\n").map(x => x.trim()).filter(Boolean).map(x => {
  const i = x.indexOf(",");
  return i < 0 ? { org: x } : { last: x.slice(0, i).trim(), first: x.slice(i + 1).trim() };
});
const inverted = p => p.org || [p.last, p.first].filter(Boolean).join(", ");
const normal = p => p.org || [p.first, p.last].filter(Boolean).join(" ");
const lastName = p => p.org || p.last;

function andList(xs) {
  if (xs.length <= 1) return xs.join("");
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(", ")}, and ${xs.at(-1)}`;
}
function bibNames(ps) {
  if (!ps.length) return "";
  if (ps.length > 10) return [inverted(ps[0]), ...ps.slice(1, 7).map(normal)].join(", ") + ", et al.";
  if (ps.length === 1) return inverted(ps[0]);
  if (ps.length === 2) return `${inverted(ps[0])}, and ${normal(ps[1])}`;
  return `${inverted(ps[0])}, ${ps.slice(1, -1).map(normal).join(", ")}, and ${normal(ps.at(-1))}`;
}
const noteNames = ps => ps.length > 3 ? `${normal(ps[0])} et al.` : andList(ps.map(normal));
const shortNames = ps => ps.length > 3 ? `${lastName(ps[0])} et al.` : andList(ps.map(lastName));

// ───────────── punctuation helpers
const endsInPunct = s => /[.?!]["”’*]*$/.test(s);
const sentence = s => s && (endsInPunct(s) ? s : s + ".");
/** “Title.” or “Title?” — closing punctuation goes inside the quotes. */
const quoted = (t, p) => /[?!]$/.test(t) ? `“${t}”` : `“${t}${p}”`;
const italic = t => `*${t}*`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function longDate(iso) {
  const m = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/.exec(iso || "");
  if (!m) return iso || "";
  if (!m[2]) return m[1];
  return m[3] ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : `${MONTHS[+m[2] - 1]} ${m[1]}`;
}
const pages = p => String(p || "").replace(/\s*-+\s*/g, "–");
const link = r => r.doi ? `https://doi.org/${r.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, "")}` : r.url || "";
const ordinalEd = e => e ? (/ed\.?$/i.test(e) ? e : `${e} ed.`) : "";
const pubFacts = r => [r.place && r.publisher ? `${r.place}: ${r.publisher}` : r.place || r.publisher, r.year].filter(Boolean).join(", ");

function shortTitle(t) {
  const main = t.split(":")[0].trim();
  const words = main.split(/\s+/);
  return words.length > 4 ? words.slice(0, 4).join(" ") : main;
}
const isItalicTitle = kind => kind === "book" || kind === "report";

/** { bib, note, short } as markdown strings. A written-out override replaces the bibliography entry. */
export function cite(r, page = "") {
  page = pages(page).trim();
  const kind = r.kind || "book";
  const A = people(r.authors), E = people(r.editors);
  const t = (r.title || "").trim() || "Untitled";
  const url = link(r);
  const bib = [], note = [];

  // Bibliography
  if (A.length) bib.push(sentence(bibNames(A)));
  else if (E.length && kind === "book") bib.push(sentence(`${bibNames(E)}, ${E.length > 1 ? "eds" : "ed"}`));
  bib.push(isItalicTitle(kind) || kind === "other" && !r.container ? sentence(italic(t)) : quoted(t, "."));
  if (kind === "book" || kind === "report") {
    if (r.edition) bib.push(sentence(ordinalEd(r.edition)));
    if (E.length && A.length) bib.push(sentence(`Edited by ${andList(E.map(normal))}`));
    if (pubFacts(r)) bib.push(sentence(pubFacts(r)));
  } else if (kind === "chapter") {
    bib.push(sentence([`In ${italic(r.container || "Untitled")}`, E.length && `edited by ${andList(E.map(normal))}`, r.pages && pages(r.pages)].filter(Boolean).join(", ")));
    if (pubFacts(r)) bib.push(sentence(pubFacts(r)));
  } else if (kind === "article") {
    let s = italic(r.container || "Untitled");
    if (r.volume) s += ` ${r.volume}`;
    if (r.issue) s += `${r.volume ? "," : ""} no. ${r.issue}`;
    if (r.year) s += ` (${r.year})`;
    if (r.pages) s += `: ${pages(r.pages)}`;
    bib.push(sentence(s));
  } else if (kind === "web") {
    if (r.container) bib.push(sentence(r.container));
    if (r.date) bib.push(sentence(longDate(r.date)));
    else if (r.accessed) bib.push(sentence(`Accessed ${longDate(r.accessed)}`));
  } else if (kind === "thesis") {
    bib.push(sentence([r.genre || "PhD diss.", r.publisher, r.year].filter(Boolean).join(", ")));
  } else {
    if (r.container) bib.push(sentence(`In ${italic(r.container)}`));
    if (pubFacts(r)) bib.push(sentence(pubFacts(r)));
  }
  if (url) bib.push(sentence(url));

  // First full note (page number left for you to add)
  const who = A.length ? noteNames(A) : E.length ? `${andList(E.map(normal))}, ${E.length > 1 ? "eds." : "ed."}` : "";
  if (who) note.push(who);
  if (isItalicTitle(kind)) {
    let s = italic(t);
    if (r.edition) s += `, ${ordinalEd(r.edition).replace(/^\w/, c => c.toLowerCase())}`;
    if (pubFacts(r)) s += ` (${pubFacts(r)})`;
    note.push(s);
  } else if (kind === "chapter") {
    note.push(quoted(t, ","));
    note.push(`in ${italic(r.container || "Untitled")}${E.length ? `, ed. ${andList(E.map(normal))}` : ""}${pubFacts(r) ? ` (${pubFacts(r)})` : ""}`);
  } else if (kind === "article") {
    note.push(quoted(t, ","));
    note.push(`${italic(r.container || "Untitled")}${r.volume ? " " + r.volume : ""}${r.issue ? `, no. ${r.issue}` : ""}${r.year ? ` (${r.year})` : ""}`);
  } else if (kind === "thesis") {
    note.push(`${quoted(t, "")} (${[r.genre || "PhD diss.", r.publisher, r.year].filter(Boolean).join(", ")})`);
  } else {
    note.push(quoted(t, ","));
    if (r.container) note.push(r.container);
    if (kind === "web" && (r.date || r.accessed)) note.push(r.date ? longDate(r.date) : `accessed ${longDate(r.accessed)}`);
  }
  if (page) { if (kind === "article") note[note.length - 1] += `: ${page}`; else note.push(page); }
  if (url) note.push(url);
  // Quoted titles already carry their comma (“Title,”), so join without doubling it.
  const noteText = sentence(note.reduce((s, part) => !s ? part : /[,?!]”$/.test(s) ? `${s} ${part}` : `${s}, ${part}`, ""));

  const st = shortTitle(t);
  const who2 = A.length ? shortNames(A) : E.length ? shortNames(E) : "";
  const shortTitlePart = isItalicTitle(kind) ? italic(st) + (page ? `, ${page}.` : ".") : page ? `${quoted(st, ",")} ${page}.` : quoted(st, ".");
  const shortText = [who2, shortTitlePart].filter(Boolean).join(", ");

  return { bib: (r.override || "").trim() || bib.join(" "), note: noteText, short: shortText };
}

// ───────────── citations inside the compiled assignment
export const citeToken = (id, page) => `{cite:${id}${page ? "|" + page.trim() : ""}}`;

/** Numbering for one document: the first citation of a source gets the full note, later ones the short note. */
export const noteState = () => ({ n: 0, seen: new Set(), notes: [], cited: new Map() });
function nextNote(state, r, id, page) {
  const n = ++state.n;
  const c = r && cite(r, page);
  const text = !r ? "[Missing reference: it was deleted from the notebook.]" : state.seen.has(id) ? c.short : c.note;
  if (r) { state.seen.add(id); state.cited.set(id, r); }
  state.notes.push({ n, id, text });
  return n;
}

/** Text → Markdown with footnote markers ([^3]); the notes collect in state.notes. */
export const withFootnotes = (text, get, state) =>
  String(text || "").replace(CITE_RE, (m, id, page) => `[^${nextNote(state, get(id), id, page)}]`);

/** Text → Markdown with superscript note numbers for reading on the page. */
export const withNoteNumbers = (text, get, state) =>
  String(text || "").replace(CITE_RE, (m, id, page) => {
    const n = nextNote(state, get(id), id, page);
    return `<sup class="citeMark" data-cite="${id}">${n}</sup>`;
  });

/** Text → Markdown with short citations in parentheses, for quoting a passage elsewhere. */
export const withInlineCites = (text, get, cited) =>
  String(text || "").replace(CITE_RE, (m, id, page) => {
    const r = get(id);
    if (!r) return " [missing reference]";
    cited?.set(id, r);
    return ` (${cite(r, page).short.replace(/\.(”?)$/, "$1")})`;
  });

// ───────────── lookup
// Catalogues often store titles in sentence case; Chicago wants headline case. Words that
// already have capitals inside them (GeoNames, iPhone, NASA) are left alone.
const MINOR = new Set("a an the and but or nor for so yet as at by in of off on per to up via with from into over upon than".split(" "));
export function headline(t) {
  return String(t || "").split(/(\s+|(?<=[:—–?!])\s*)/).reduce((out, w, i, all) => {
    if (!w.trim()) return out + w;
    const prev = out.trimEnd(), first = !prev || /[:—–?!]$/.test(prev);
    const last = all.slice(i + 1).every(x => !x.trim());
    const lower = w.toLowerCase();
    if (/[A-Z]/.test(w.slice(1)) || /\d/.test(w)) return out + w;
    if (!first && !last && MINOR.has(lower)) return out + lower;
    return out + w.replace(/^([“"'(]*)(\p{L})/u, (m, p, c) => p + c.toUpperCase()).replace(/-(\p{Ll})/gu, (m, c) => "-" + c.toUpperCase());
  }, "");
}

const CROSSREF_KIND = { "journal-article": "article", "book-chapter": "chapter", book: "book", monograph: "book", "edited-book": "book",
  "reference-book": "book", report: "report", dissertation: "thesis", "posted-content": "web", "proceedings-article": "chapter" };

/** A DOI, a doi.org link or an ISBN → reference fields. */
export async function lookup(input) {
  const s = input.trim();
  const doi = /10\.\d{4,9}\/\S+/.exec(s)?.[0];
  if (doi) return fromCrossref(doi);
  const isbn = s.replace(/[^0-9Xx]/g, "");
  if (isbn.length === 10 || isbn.length === 13) return fromOpenLibrary(isbn);
  throw new Error("That doesn't look like a DOI (10.xxxx/…) or an ISBN.");
}

async function fromCrossref(doi) {
  const r = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  if (!r.ok) throw new Error(r.status === 404 ? "Crossref has no record of that DOI." : `Crossref answered ${r.status}.`);
  const m = (await r.json()).message;
  const names = list => (list || []).map(p => p.family ? `${p.family}, ${p.given || ""}`.trim().replace(/,$/, "") : p.name).filter(Boolean).join("\n");
  const title = headline([m.title?.[0], m.subtitle?.[0]].filter(Boolean).join(": "));
  const year = (m.issued || m.published || m["published-print"] || m["published-online"])?.["date-parts"]?.[0]?.[0];
  return {
    kind: CROSSREF_KIND[m.type] || "other",
    authors: names(m.author), editors: names(m.editor), title,
    container: m["container-title"]?.[0] || "", volume: m.volume || "", issue: m.issue || "",
    pages: pages(m.page), year: year ? String(year) : "", publisher: m.publisher || "",
    place: m["publisher-location"] || "", doi: m.DOI || doi, url: "",
  };
}

async function fromOpenLibrary(isbn) {
  const r = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  if (!r.ok) throw new Error(`Open Library answered ${r.status}.`);
  const b = (await r.json())[`ISBN:${isbn}`];
  if (!b) throw new Error("Open Library has no record of that ISBN.");
  const invert = name => { const w = name.trim().split(/\s+/); return w.length > 1 ? `${w.at(-1)}, ${w.slice(0, -1).join(" ")}` : name; };
  return {
    kind: "book",
    authors: (b.authors || []).map(a => invert(a.name)).join("\n"),
    title: headline([b.title, b.subtitle].filter(Boolean).join(": ")),
    publisher: b.publishers?.[0]?.name || "", place: b.publish_places?.[0]?.name || "",
    year: /\d{4}/.exec(b.publish_date || "")?.[0] || "", url: "",
  };
}
