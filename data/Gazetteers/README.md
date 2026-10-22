# Gazetteers

Place databases used by `Pipelines/Place Mentions/02_place_matching.ipynb`.

| Folder | Content | In git |
|---|---|---|
| `cgndb/` | Canadian Geographical Names Database, national CSV (English) | No (77 MB; re-download) |
| `chgis/` | Canadian Historical GIS census subdivisions, 1851–1921 (file geodatabase `.gdb` folder) | No |
| `curated/place_overrides.csv` | Hand-curated historical and problem names (Upper Canada, Bytown, Grosse Île…), bounded by year and book | Yes |
| `curated/world_places.csv` | Hand-curated places outside Canada that the diaries mention; matched by exact name only | Yes |

## Downloads

**CGNDB**: `cgn_canada_csv_eng.zip` from
<https://ftp.cartes.canada.ca/pub/nrcan_rncan/vector/geobase_cgn_toponyme/prov_csv_eng/>. Unzip into `cgndb/`. The file is regenerated weekly, so record each download here.

| Downloaded | File | File date | Records |
|---|---|---|---|
| 2026-10-20 | `cgn_canada_csv_eng.csv` | 2026-10-13 | 366,235 |

**CHGIS**: the census subdivision geodatabase with one layer per census year (1851–1921). Put the `.gdb` folder in `chgis/`. The matching notebook finds the first `.gdb` or `.gpkg` there; check the detected layers and fields in its section 3.6.

## Editing the curated tables

Coordinates are representative points (a settlement, a capital or an approximate centre), not boundaries. Use `note` to say which. Use `year_from`/`year_to` for names valid only in a period (York = Toronto 1793–1834), and `book` for names that mean different places in different books (Chinatown).
