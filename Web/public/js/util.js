export const $ = (sel, root = document) => root.querySelector(sel);

export const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Build a DOM node from an HTML string. */
export function html(str) {
  const t = document.createElement("template");
  t.innerHTML = str.trim();
  return t.content.firstElementChild;
}

/** Loose comparison key for place names (accents, punctuation, "Saint" → "st"). */
export function fold(s) {
  return String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/['’.]/g, "").replace(/[-‐–—\/]/g, " ").replace(/\bsaint\b/g, "st").replace(/\s+/g, " ").trim();
}

/** "1862", "1862-05" or "1862-05-15" → UTC ms (works for years < 100 too). */
export function parseDate(s) {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec((s || "").trim());
  if (!m) return null;
  const dt = new Date(Date.UTC(2000, m[2] ? +m[2] - 1 : 0, m[3] ? +m[3] : 1));
  dt.setUTCFullYear(+m[1]);
  return dt.getTime();
}

export function parseCSV(text) {
  const out = []; let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = ""; out.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); out.push(row); }
  const header = (out.shift() || []).map(h => h.trim().replace(/^﻿/, ""));
  return out.filter(r => r.length > 1).map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

/** Read a CSS custom property (canvas and SVG attributes can't use var()). */
export const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const fmtBytes = n => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(0) + " KB" : (n / 1048576).toFixed(1) + " MB";
