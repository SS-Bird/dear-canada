export const $ = (sel, root = document) => root.querySelector(sel);

export const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Build a DOM node from an HTML string. */
export function html(str) {
  const t = document.createElement("template");
  t.innerHTML = str.trim();
  return t.content.firstElementChild;
}

/** Markdown → sanitised HTML. */
export const md = text => DOMPurify.sanitize(marked.parse(String(text ?? "")));
export const mdInline = text => DOMPurify.sanitize(marked.parseInline(String(text ?? "")));

/** A citation in assignment text: {cite:<reference node id>} or {cite:<id>|<pages>}. Leading space is
 *  swallowed so the note number sits against the word or punctuation before it. */
export const CITE_RE = /[ \t]*\{cite:([\w-]+)(?:\|([^}]*))?\}/g;

/** Collapse whitespace the same way for stored quotes, selections and rendered text. */
export const squash = s => String(s ?? "").replace(/\s+/g, " ").trim();

/** The text a reader sees once the markdown is rendered (used to find quoted words). */
const plainCache = new Map();
export function plain(text) {
  if (!plainCache.has(text)) {
    const d = document.createElement("div");
    d.innerHTML = md(String(text ?? "").replace(CITE_RE, ""));
    if (plainCache.size > 2000) plainCache.clear();
    plainCache.set(text, squash(d.textContent));
  }
  return plainCache.get(text);
}

/** Wrap the first occurrence of `quote` (whitespace-insensitive) inside rendered HTML in <mark>s. */
export function markText(root, quote, cls, attrs = {}) {
  quote = squash(quote);
  if (!quote) return false;
  const map = [];
  let norm = "", prevSpace = true;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT,
    { acceptNode: n => n.parentElement?.closest(".citeMark") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT }); // note numbers aren't words
  for (let n; (n = walker.nextNode());) {
    const v = n.nodeValue;
    for (let i = 0; i < v.length; i++) {
      const sp = /\s/.test(v[i]);
      if (sp && prevSpace) continue;
      norm += sp ? " " : v[i]; map.push([n, i]); prevSpace = sp;
    }
  }
  const at = norm.indexOf(quote);
  if (at < 0) return false;
  const spans = new Map(); // text node → [start, end) within it
  for (let k = at; k < at + quote.length; k++) {
    const [n, i] = map[k], s = spans.get(n);
    if (s) s[1] = i + 1; else spans.set(n, [i, i + 1]);
  }
  for (const [n, [s, e]] of spans) {
    const r = document.createRange();
    r.setStart(n, s); r.setEnd(n, e);
    const m = document.createElement("mark");
    m.className = cls;
    for (const [k, v] of Object.entries(attrs)) m.setAttribute(k, v);
    r.surroundContents(m);
  }
  return true;
}

export const fmtDate =iso => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
export const fmtDay = iso => iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : "—";

export const shorten = (s, n) => { s = squash(s); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; };

export function download(name, text, type = "text/markdown") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: type + ";charset=utf-8" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Copy plain text, plus formatted HTML when given (so italics survive a paste into Docs or Word). */
export async function copy(text, htmlText) {
  if (htmlText && window.ClipboardItem) {
    await navigator.clipboard.write([new ClipboardItem({
      "text/plain": new Blob([text], { type: "text/plain" }),
      "text/html": new Blob([htmlText], { type: "text/html" }),
    })]);
  } else await navigator.clipboard.writeText(text);
}

/** Textareas that grow with their content. */
export function autogrow(ta) {
  const fit = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + 2 + "px"; };
  ta.addEventListener("input", fit);
  requestAnimationFrame(fit);
  return fit;
}
