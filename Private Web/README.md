# Narrating Canada — private notebook

A small site for working out HC and LO applications: a network of colleges, courses, HCs, LOs,
readings, notes and location references, a compiled assignment those references point into,
and Markdown exports. Plain HTML/CSS/JS like `Web/`, with the same look.

## Running it

```
python3 server.py
```
Then open http://localhost:8010. Everything you write is saved to `data/notebook.json`
about half a second after you stop typing. The first save each day also copies the previous
version to `data/backups/`. `data/` is in `.gitignore`.

If you open the site without `server.py` (for example `python3 -m http.server -d public`), it still
works but saves only in that browser's localStorage, and the sidebar says so.

```
Private Web/
├── server.py             serves public/ and reads/writes data/notebook.json
├── data/                 notebook.json + backups/ (created on first save; not in git)
└── public/
    ├── index.html        layout: nav | centre view | node editor
    ├── css/style.css     palette and layout copied from Web/
    └── js/
        ├── app.js        router, right-hand column, save status
        ├── store.js      the notebook: nodes, links, assignment, saving, location-reference tracking
        ├── types.js      node types (label, colour, rank)
        ├── network.js    #/network — force layout, colleges in the middle
        ├── editor.js     the right-hand editor for one node
        ├── assignment.js #/assignment — the compiled assignment
        ├── cite.js       Chicago citations, DOI (Crossref) and ISBN (Open Library) lookup
        └── export.js     #/export — Markdown exports, JSON backup and import
```

## How it works

**Nodes.** Each node has a title, a Markdown writing area, and `created` / `updated` times
(linking or unlinking also counts as an update). Courses, HCs and LOs also have a code
(`CS110`, `#sourcequality`). Links are undirected. Each type has a rank (college 0, course 1,
HC/LO 2, reading/note 3, location reference 4), and the network puts each rank on a wider
ring, so colleges sit in the middle. The **+** buttons in the editor offer the types below the
current one. **Shift-drag** between two nodes links them. The **Show** checkboxes hide
node types; that choice is remembered in the browser.

**Readings.** Pick a kind (book, chapter, article, web page, report, thesis), fill in the fields,
or paste a DOI/ISBN and press *Fill in*. The editor shows the Chicago bibliography entry, first
note and short note, with copy buttons that keep the italics. Looked-up titles are converted to
headline case; check them, along with the author names. Under *Write the bibliography entry
yourself* you can type an entry that replaces the generated one.

**Reference bank** (`#/references`). Every reading in the notebook, with a Chicago entry and a
status: *Cited* (with which sections), *Linked, not cited yet*, or *Not placed yet*, which is for
sources worth keeping until they find a home. Add one by title, or by DOI/ISBN to have it filled in.
You can filter, search, sort A–Z or newest first, and download or copy the shown list as a
bibliography.

**Compiled assignment.** The assignment has its own sidebar section. *Whole assignment* shows
every section in order. Each section has its own page (`#/assignment/<id>`) where you can rename it,
move it up or down, or delete it. *+ Add section* creates a new one. Your earlier text became the
first section.

**Citations in the assignment.** While editing a paragraph, *Cite a reading…* opens a picker:
search your readings, optionally give page numbers, and press Enter or click one. *+ New reading
with this title* creates the reading and opens it on the right so you can fill in its details.
The citation is stored in the text as `{cite:<reading id>|<pages>}`, which you'll see while editing.
On the page it shows as a superscript number, with a *Notes* list at the bottom. In the
*Compiled assignment* export it becomes a Markdown footnote (`[^1]`) in Chicago style: a full
note for the first citation of a source and a short note after that, followed by a bibliography.
Pandoc turns these into real footnotes in Word or PDF. In the HC/LO export, quoted passages show
citations as short notes in parentheses.

**Writing font.** Times New Roman (the default), Arial or OpenDyslexic, chosen from the sidebar dropdown and
remembered per browser. It applies to everything you write and read: the assignment, notes and
previews. The writing areas are white; in dark mode they are dark grey.

**Location references.** Each paragraph keeps an id through edits. To make a location reference, select some words on
the assignment page. If a note (or any other node) is open in the editor, the new reference is
linked to it. A reference stores the paragraph id, the quoted words, and a snapshot of the
paragraph:
- If you edit the paragraph, the snapshot updates.
- If the quoted words move (you split, merge or rewrite paragraphs) and exactly one paragraph
  still contains them, the reference follows them there.
- If the words disappear but the paragraph is still there, the reference is marked *Words changed*.
- If the paragraph is deleted, the reference keeps its last version, marked *Passage removed*.
  It is listed at the bottom of the assignment page and included in the exports.

*Point somewhere else…* on a reference lets you pick a new passage for it.

**Exports** (`#/export`):
- *From the HCs & LOs*: one section per HC/LO with its course and college, its definition,
  then the connected notes with their passages and sources, then readings, then a
  bibliography. This is the version to read through or give to an LLM.
- *Everything*: every node grouped by type, with its connections, and optionally the
  assignment. Types can be left out.
- *Compiled assignment*: the assignment with section headings, Chicago footnotes and a bibliography.
- *Download notebook.json*: a full backup. *Import* replaces the notebook with a backup.

## Sharing with an advisor

At the moment this runs only on your machine. To share, either send an export, or deploy it.
Note that `server.py` is a local tool, so a deployed copy would need hosted storage and a
password. That is a bigger step, worth deciding on before doing it.
