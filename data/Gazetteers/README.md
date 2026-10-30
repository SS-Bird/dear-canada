# Gazetteers

Place databases used by `Pipelines/Place Mentions/02_place_matching.ipynb`, and the historical boundaries used by `03_region_boundaries.py` and `04_census_boundaries.py`.

| Folder | Content | In git |
|---|---|---|
| `cgndb/` | Canadian Geographical Names Database, national CSV (English) | No (77 MB; re-download) |
| `TCP_CANADA_CSD_202306/` | The Canadian Peoples (TCP/LPC) historical GIS: census subdivision polygons for every census 1851–1921 (file geodatabase), with its documentation in English and French | No (93 MB) |
| `doi-10.5683-sp2-iq7e0x/` | HACOLP Territorial Evolution: province, colony and territory polygons at 47 dates, 1667–2001 | No (150 MB; re-download) |
| `naturalearth/` | Natural Earth 1:50m modern countries (map units) and US states, for mentions outside Canada | No (2 MB; re-download) |
| `curated/region_aliases.csv` | Names of provinces, colonies and territories (Upper Canada, Canada West, B.C.…) → a region id | Yes |
| `curated/region_polygons.csv` | Region id → HACOLP polygon names, by year of the mention | Yes |
| `curated/place_corrections.csv` | Flags and corrections made on the website (download from its *Flags & fixes* page; see `Web/README.md`) | Yes |
| `curated/place_overrides.csv` | Hand-curated historical and problem names (Upper Canada, Bytown, Grosse Île…), bounded by year and book | Yes |
| `curated/world_places.csv` | Hand-curated places outside Canada that the diaries mention; matched by exact name only | Yes |

## Downloads

**CGNDB**: `cgn_canada_csv_eng.zip` from
<https://ftp.cartes.canada.ca/pub/nrcan_rncan/vector/geobase_cgn_toponyme/prov_csv_eng/>. Unzip into `cgndb/`. The file is regenerated weekly, so record each download here.

| Downloaded | File | File date | Records |
|---|---|---|---|
| 2026-10-20 | `cgn_canada_csv_eng.csv` | 2026-10-13 | 366,235 |

**TCP census subdivisions** (the notebook's “CHGIS” gazetteer): *The Canadian Peoples / Les populations canadiennes Project, “Census of Canada Historical GIS, CSD Polygons,” CIEQ, Université Laval and HGIS Lab, University of Saskatchewan, 2023*, version 2.0 (June 2023), open data. Keep the folder as it unzips, `TCP_CANADA_CSD_202306/` with `TCP_CANADA_CSD_202306.gdb` inside. The matching notebook finds the first `.gdb` there (check the detected layers and fields in its section 3.6); `04_census_boundaries.py` builds the website's census layers from it.

| Added | Notes |
|---|---|
| 2026-10-28 | Version 2.0 (June 2023). Layers `CANADA_YYYY_CSD` for 1851–1921, plus `CANADA_1911_CSD_V1T1` and `_V2T2` |

The attributes are only identifiers (province, census division and subdivision names, and a `TCPUID` code), with no census figures. Ids repeat across census years, so a subdivision is a year plus an id. Some subdivisions are 1 km hexagons standing in for settlements of unknown extent, and `NO DATA` polygons fill territory that was not enumerated (the matching notebook ignores them).

**1911 has three layers.** The census published different lists of subdivisions in different tables: Volume 1, Table 1 has 10,040 (thousands of small, often empty western townships), and Volume 2, Table 2 has 3,589 (some eastern units merged). The main layer `CANADA_1911_CSD` (3,825) is a hybrid: exactly the V1T1 subdivisions in NB, NS, PE, ON and QC, and exactly the V2T2 ones in the west. It is the layer the place matching uses, so 1911 behaves like every other census. Aggregate figures join to the table they come from, through `data/Pipe Outputs/historical/tcp_1911_crosswalk.csv`, written by `04_census_boundaries.py`. It has one row for each pair of overlapping hybrid and table subdivisions, with `relation` set to `identical`, `hybrid_within` (the table merged units, so share its figure out or report it for the larger unit), `hybrid_contains` (the table split the unit, so sum the parts), `overlap`, or `border_sliver` (ignore). Shares of each area are approximate, to about a percent.

**HACOLP**: *Historical Atlas of Canada Online Learning Project, Territorial Evolution 2012*, <https://borealisdata.ca/dataset.xhtml?persistentId=doi:10.5683/SP2/IQ7E0X>. Download the whole dataset and unzip it here; `03_region_boundaries.py` finds `**/shapefiles_new/boundaries_*_poly.zip` (it reads the zips directly).

| Downloaded | Notes |
|---|---|
| 2026-10-25 | Polygons for 1667–2001 plus `Lakes_poly.zip` |

**Natural Earth**: `ne_50m_admin_0_map_units.zip` and `ne_50m_admin_1_states_provinces_lakes.zip` from
<https://www.naturalearthdata.com/downloads/50m-cultural-vectors/> (direct: `https://naciscdn.org/naturalearth/50m/cultural/<file>.zip`), into `naturalearth/`, left zipped. Downloaded 2026-10-25. Public domain.

## Editing the curated tables

Coordinates are representative points (a settlement, a capital or an approximate centre), not boundaries. Use `note` to say which. Use `year_from`/`year_to` for names valid only in a period (York = Toronto 1793–1834), and `book` for names that mean different places in different books (Chinatown).

### Region tables

On the website, a mention fills a polygon when its name (or its matched name) is in `region_aliases.csv` and its `location_precision` is not `settlement`, `site` or `feature`, so Quebec the city stays a dot. Matching runs in the browser, so after editing either table just run `python3 Web/scripts/sync_data.py`.

In `region_polygons.csv`, `year_from`/`year_to` are compared with the mention's year (blank = open-ended). `polygons` lists HACOLP names separated by `;`. Only the names present in the snapshot in force that year are filled, so one row can cover a lineage (`Upper Canada;Canada West;Ontario`). `@Canada` means every polygon whose country is Canada. `level` = `country` rows (Canada) are drawn as the country's name unless the map's “Fill Canada” box is ticked. If no row or polygon fits, the mention falls back to a dot. The polygon names are printed at the end of `03_region_boundaries.py`.

Mentions outside Canada (countries, and US states) are shaded grey within modern Natural Earth borders, built by `03_region_boundaries.py` into `boundaries_world.json`. A country or region mention (`location_precision` `country`/`region`) fills the unit whose name matches its place name or matched name (Natural Earth's names: France, England, Virginia…; a country's name covers all its units, so United Kingdom fills England, Scotland, Wales and Northern Ireland). For other spellings, add a row to `region_aliases.csv` with region `world:<Natural Earth name>` (Britain → `world:United Kingdom`, New York State → `world:New York`). Canadian regions always take precedence.
