# Gazetteers

Place databases used by `Pipelines/Place Mentions/02_place_matching.ipynb`, and the historical boundaries used by `03_region_boundaries.py`.

| Folder | Content | In git |
|---|---|---|
| `cgndb/` | Canadian Geographical Names Database, national CSV (English) | No (77 MB; re-download) |
| `chgis/` | Canadian Historical GIS census subdivisions, 1851–1921 (file geodatabase `.gdb` folder) | No |
| `doi-10.5683-sp2-iq7e0x/` | HACOLP Territorial Evolution: province, colony and territory polygons at 47 dates, 1667–2001 | No (150 MB; re-download) |
| `curated/region_aliases.csv` | Names of provinces, colonies and territories (Upper Canada, Canada West, B.C.…) → a region id | Yes |
| `curated/region_polygons.csv` | Region id → HACOLP polygon names, by year of the mention | Yes |
| `curated/place_overrides.csv` | Hand-curated historical and problem names (Upper Canada, Bytown, Grosse Île…), bounded by year and book | Yes |
| `curated/world_places.csv` | Hand-curated places outside Canada that the diaries mention; matched by exact name only | Yes |

## Downloads

**CGNDB**: `cgn_canada_csv_eng.zip` from
<https://ftp.cartes.canada.ca/pub/nrcan_rncan/vector/geobase_cgn_toponyme/prov_csv_eng/>. Unzip into `cgndb/`. The file is regenerated weekly, so record each download here.

| Downloaded | File | File date | Records |
|---|---|---|---|
| 2026-10-20 | `cgn_canada_csv_eng.csv` | 2026-10-13 | 366,235 |

**CHGIS**: the census subdivision geodatabase with one layer per census year (1851–1921). Put the `.gdb` folder in `chgis/`. The matching notebook finds the first `.gdb` or `.gpkg` there; check the detected layers and fields in its section 3.6.

**HACOLP**: *Historical Atlas of Canada Online Learning Project, Territorial Evolution 2012*, <https://borealisdata.ca/dataset.xhtml?persistentId=doi:10.5683/SP2/IQ7E0X>. Download the whole dataset and unzip it here; `03_region_boundaries.py` finds `**/shapefiles_new/boundaries_*_poly.zip` (it reads the zips directly).

| Downloaded | Notes |
|---|---|
| 2026-10-25 | Polygons for 1667–2001 plus `Lakes_poly.zip` |

## Editing the curated tables

Coordinates are representative points (a settlement, a capital or an approximate centre), not boundaries. Use `note` to say which. Use `year_from`/`year_to` for names valid only in a period (York = Toronto 1793–1834), and `book` for names that mean different places in different books (Chinatown).

### Region tables

On the website, a mention fills a polygon when its name (or its matched name) is in `region_aliases.csv` and its `location_precision` is not `settlement`, `site` or `feature`, so Quebec the city stays a dot. Matching runs in the browser, so after editing either table just run `python3 Web/scripts/sync_data.py`.

In `region_polygons.csv`, `year_from`/`year_to` are compared with the mention's year (blank = open-ended). `polygons` lists HACOLP names separated by `;`. Only the names present in the snapshot in force that year are filled, so one row can cover a lineage (`Upper Canada;Canada West;Ontario`). `@Canada` means every polygon whose country is Canada. `level` = `country` rows (Canada, the US) are filled only when the map's “Fill whole countries” box is ticked. If no row or polygon fits, the mention falls back to a dot. The polygon names are printed at the end of `03_region_boundaries.py`.
