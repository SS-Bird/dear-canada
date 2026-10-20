# Dear Canada website

A static site with no build step: plain HTML/CSS/JS, using Leaflet for the map and D3 for the network. Everything that gets deployed is in `public/`.

```
Web/
├── data_sources.json      which pipeline outputs get published
├── scripts/sync_data.py   copies them into public/data/ and writes the manifest
├── vercel.json            serve public/, cache headers for data
└── public/
    ├── index.html         layout: nav | map + project UI | detail column
    ├── css/style.css
    ├── js/app.js          basemap, router, right-hand panel, temp data listing
    ├── js/projects/       one module per project (places.js, network.js)
    ├── js/books.js        book code → title
    ├── pages/*.html       about / contact / placeholder / home text
    └── data/              synced data + manifest.json (generated, don't edit)
```

## Updating the data

1. Re-run a pipeline, or edit `data_sources.json` to point at different files (globs work).
2. `python3 scripts/sync_data.py` (from `Web/`)
3. Commit and push. Vercel redeploys, and visitors re-download only the files that changed.

The manifest is checked on every visit. Each data file is requested with its modified time as a version tag and cached for good, so an unchanged file is never downloaded twice.

## Running locally

```
python3 -m http.server 8000 -d public
```
Then open http://localhost:8000. Opening `index.html` directly from disk won't work, because browsers block `fetch` on `file://` URLs.

## Deploying on Vercel

Import the repo, set **Root Directory** to `Web`, and leave the framework preset as *Other*. `vercel.json` handles the rest.

## Extending

- **New project:** add `js/projects/<name>.js` exporting `mount({ map, stage, panel, manifest })` that returns a cleanup function. Then register it in `PROJECTS` in `app.js` and link it in `index.html` as `#/<name>`.
- **New text page:** add `pages/<name>.html` and link it as `#/page/<name>`.
- **Remove the temporary data listing:** delete the `#dataSec` section in `index.html`. The `#/data/...` route can stay or go.
