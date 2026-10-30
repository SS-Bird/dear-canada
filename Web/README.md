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
    ├── js/app.js          base maps and projections, router, right-hand panel, temp data listing
    ├── js/projects/       one module per project (places.js, network.js, historical.js)
    ├── js/books.js        book code → title
    ├── js/flags.js        flags/corrections store; js/flagForm.js the map's form, js/flagsPage.js the #/flags log
    ├── js/census.js       loads TCP census layers, finds the subdivision under a point
    ├── js/dataMap.js      the #/datamap page: a schema diagram of the place and boundary data
    ├── pages/*.html       about / contact / placeholder / home text
    └── data/              synced data + manifest.json (generated, don't edit)
```

## Updating the data

1. Re-run a pipeline, or edit `data_sources.json` to point at different files (globs work).
2. `python3 scripts/sync_data.py` (from `Web/`)
3. Commit and push. Vercel redeploys, and visitors re-download only the files that changed.

The manifest is checked on every visit. Each data file is requested with its modified time as a version tag and cached for good, so an unchanged file is never downloaded twice.

## Flags and corrections

Click any place on the map, then **Flag or correct…** (or click a mention to read its sentence and flag just that one). A flag either fixes the mention straight away (*Save as resolved*: new location, name, type, census subdivision, or “not a place”) or records an issue to come back to (*Save as open flag*). Fixes show on the map at once.

New flags live only in that browser (`localStorage`) until they are put in the data:

1. On **Flags & fixes** (`#/flags`), download `place_corrections.csv`. It holds every flag, published and new.
2. Replace `data/Gazetteers/curated/place_corrections.csv` with it.
3. Run `python3 scripts/sync_data.py` (the site then reads them from the published file), or re-run the matching notebook, whose section 8.0 also writes the corrections into `place_mentions.csv`. Commit and push.

After that sync, the browser's local copies match the published rows and are dropped. **Import a CSV…** merges a downloaded file into another browser. Anyone visiting the site can make flags in their own browser, but they only reach the data through this download.

`#/places?q=<name>` opens the map with a search filled in, and `&mode=sequence` starts in the “books one after another” mode.

## Census subdivisions on the place map

A located Canadian place fills its census subdivision (from `csd_polygons.geojson`, the nearest census within ten years) when the subdivision is under the size set in the map's panel (500 km² by default; the slider is log scaled), so places in townships, parishes and towns fill while places in vast western and northern subdivisions stay dots. A place named after its subdivision (`csd_same_name`, e.g. Guelph) always fills it. The other option fills only those named places.

To attach places to a subdivision by hand, flag them as **Wrong or missing census subdivision** (the location kinds have the same fields): pick a census, then type the subdivision's name or click **Pick on map**. The form offers the mention's own census, or the nearest one however far, so *Torn Apart*'s 1941 Vancouver can be attached to 1921 Vancouver. A subdivision chosen by hand always fills, whatever its size; **No subdivision** makes a place a dot again. The flag stores `csd_year` and `csd_id`; until the matching notebook runs again, the site draws the polygon from the census layer (`js/census.js`).

Fills fade with area (`AREA_*` in `places.js`), so provinces and big subdivisions are lighter than towns, and dots grow less with mentions when zoomed out (`DOT_*`).

## Base maps

The menu under the zoom buttons picks a base map, remembered per browser. In **Web Mercator**: Esri light grey with or without labels, CARTO Positron (no labels), Esri shaded relief, or none. In **Canada Lambert** (EPSG:3978, the projection NRCan and Statistics Canada use, which keeps the north from stretching): NRCan relief, simple grey (with modern provincial borders), roads and rivers, or none. NRCan's tiles stop a little beyond Canada. With no base map, land is drawn from the site's own boundary files. Switching projection re-projects every layer; all overlays are vector data, so both projects work in either. Lambert needs proj4js and Proj4Leaflet (loaded in `index.html`).

## Data map

`#/datamap` (Context section) draws the place and boundary data as a schema: sources, pipelines, outputs and site pages, with data-flow arrows and dashed joins between key columns. The tables, columns and links are written out by hand in `NODES`, `FLOWS` and `JOINS` at the top of `js/dataMap.js`; update them when a pipeline's inputs or columns change. The knowledge network is left out on purpose.

## Historical boundaries

`#/historical` (`js/projects/historical.js`) is a workshop map for the boundary data on its own: HACOLP provinces, colonies and territories (the places `boundaries` file) for the year on the slider, under the TCP census subdivisions of the nearest census (or one chosen by hand, including the two alternative 1911 layers). Clicking a subdivision shows its attributes and the subdivisions it overlaps in every other census. `#/historical?year=1881` opens at a year. Its data come from `Pipelines/Place Mentions/04_census_boundaries.py`. Each layer is 1–4.5 MB, and a layer is loaded only when it is first shown.

## Running locally

```
python3 -m http.server 8000 -d public
```
Then open http://localhost:8000. Opening `index.html` directly from disk won't work, because browsers block `fetch` on `file://` URLs.

## Deploying on Vercel

Import the repo, set **Root Directory** to `Web`, and leave the framework preset as *Other*. `vercel.json` handles the rest.

## Extending

- **New project:** add `js/projects/<name>.js` exporting `mount({ map, stage, panel, manifest, params })` that returns a cleanup function. Then register it in `PROJECTS` in `app.js` and link it in `index.html` as `#/<name>`.
- **New text page:** add `pages/<name>.html` and link it as `#/page/<name>`.
- **Remove the temporary data listing:** delete the `#dataSec` section in `index.html`. The `#/data/...` route can stay or go.
