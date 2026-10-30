import { $, esc } from "./util.js";
import * as store from "./store.js";
import * as network from "./network.js";
import * as assignment from "./assignment.js";
import * as exporter from "./export.js";
import * as bank from "./bank.js";
import { nodeEditor } from "./editor.js";
import { TYPES, nodeName, typeDot } from "./types.js";

// A view is a module exporting mount(ctx) → cleanup function. "stage" views fill the centre
// (the network); the others are reading pages that scroll.
// To add one: write js/<name>.js, add it here, and link it in index.html as #/<name>.
const VIEWS = { network: { mod: network, stage: true }, assignment: { mod: assignment }, export: { mod: exporter }, references: { mod: bank } };

// ───────────── right-hand column: the editor for the selected node
let editor = null; // { id, destroy, focusTitle }

function setHead(n) {
  $("#rightStar").textContent = n.starred ? "★" : "☆";
  $("#rightStar").setAttribute("aria-pressed", !!n.starred);
  $("#rightStar").setAttribute("aria-label", n.starred ? "Unstar this node" : "Star this node");
  $("#rightTitle").textContent = nodeName(n);
  $("#rightSub").innerHTML = `${typeDot(n.type)} ${esc(TYPES[n.type].label)}`;
}
function showEditor(id) {
  const n = store.get(id);
  if (!n) return closeEditor();
  if (editor?.id === id) return;
  editor?.destroy();
  const ed = nodeEditor(id, { setHead, go: path => { location.hash = "#/" + path; }, close: () => store.select(null), open: openNode });
  editor = { id, ...ed };
  $("#rightBody").replaceChildren(ed.el);
  setHead(n);
  $("#right").hidden = false;
  $("#right").scrollTop = 0;
}
function closeEditor() {
  editor?.destroy();
  editor = null;
  $("#right").hidden = true;
}
store.onSelect(id => id ? showEditor(id) : closeEditor());

function openNode(id, { focusTitle } = {}) {
  store.select(id);
  if (focusTitle) editor?.focusTitle();
}
$("#rightClose").onclick = () => store.select(null);
$("#rightStar").onclick = () => {
  const n = editor && store.get(editor.id);
  if (!n) return;
  store.setStar(n.id, !n.starred);
  setHead(n);
};
$("#rightWide").onclick = () => {
  const wide = $("#right").classList.toggle("wide");
  $("#rightWide").textContent = wide ? "⇥" : "⇤";
  editor?.refresh();
  $("#rightWide").setAttribute("aria-label", wide ? "Narrow the editor" : "Widen the editor");
};

// ───────────── navigation
$("#navToggle").onclick = () => {
  const open = $("#nav").classList.toggle("open");
  $("#navToggle").setAttribute("aria-expanded", open);
};

const currentPath = () => decodeURIComponent(location.hash.replace(/^#\/?/, "").split("?")[0]);
const currentParams = () => Object.fromEntries(new URLSearchParams(location.hash.split("?")[1] || ""));

const go = path => { location.hash = "#/" + path; };
function highlightNav() {
  const path = currentPath() || "network";
  document.querySelectorAll("#nav [data-route]").forEach(a => a.classList.toggle("active", a.dataset.route === path));
}

let cleanup = null;
function route() {
  const [kind, ...rest] = currentPath().split("/");
  const name = VIEWS[kind] ? kind : "network";
  highlightNav();
  $("#nav").classList.remove("open");
  cleanup?.();
  $("#stage").replaceChildren();
  $("#pageInner").replaceChildren();
  const v = VIEWS[name];
  $("#stage").hidden = !v.stage;
  $("#page").hidden = !!v.stage;
  $("#page").scrollTop = 0;
  cleanup = v.mod.mount({ stage: $("#stage"), page: $("#pageInner"), params: { ...currentParams(), path: rest }, openNode, go }) || null;
}

// ───────────── sidebar: the assignment's sections
function renderSections() {
  $("#secLinks").innerHTML = store.sections().map((s, i) =>
    `<a href="#/assignment/${s.id}" data-route="assignment/${s.id}" class="secLink"><span class="secNo">${i + 1}</span>${esc(store.sectionName(s))}</a>`).join("");
  highlightNav();
}
$("#addSection").onclick = () => go(`assignment/${store.addSection().id}`);
store.onChange(kind => { if (kind !== "assignment-text") renderSections(); });

// ───────────── writing font (kept per browser)
const FONT_KEY = "privateWeb.font";
const DYSLEXIC_CSS = "https://cdn.jsdelivr.net/npm/@fontsource/opendyslexic@5.2.5/index.css";
function setFont(f) {
  if (f === "dyslexic" && !document.getElementById("dyslexicFont"))
    document.head.append(Object.assign(document.createElement("link"), { id: "dyslexicFont", rel: "stylesheet", href: DYSLEXIC_CSS }));
  document.documentElement.dataset.font = f;
  $("#fontPick").value = f;
  try { localStorage.setItem(FONT_KEY, f); } catch { /* not remembered */ }
}
$("#fontPick").onchange = e => setFont(e.target.value);
let savedFont = "times";
try { savedFont = localStorage.getItem(FONT_KEY) || "times"; } catch { /* default */ }
setFont(savedFont);

// ───────────── save status
function showStatus(s) {
  const el = $("#saveStatus");
  const time = s.at ? new Date(s.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  el.classList.toggle("err", s.state === "error");
  el.textContent = s.state === "error" ? s.msg
    : s.state === "loading" ? "Loading…"
    : s.state === "saved" ? (store.mode === "server" ? `Saved to data/notebook.json${time ? " · " + time : ""}`
      : "Saved in this browser only. Run server.py to save to a file.")
    : "Saving…";
}
store.onStatus(showStatus);
addEventListener("beforeunload", e => { if (store.hasPending()) { e.preventDefault(); e.returnValue = ""; } });

await store.load();
showStatus(store.status);
renderSections();
addEventListener("hashchange", route);
route();
