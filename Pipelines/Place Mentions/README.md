# Place Mentions

Two notebooks, run in order, and two scripts for the boundary polygons.

| Step | Notebook | Reads | Writes |
|---|---|---|---|
| 1. Find places in the text | `01_place_extraction.ipynb` | `data/Book Repository/Entries as Csv/*_entries.csv`, `resources/` | `intermediate/place_mentions_extracted.csv` (+ review tables, NER cache, annotation files) |
| 2. Attach them to a geography | `02_place_matching.ipynb` | step 1's output, `data/Gazetteers/` | `data/Pipe Outputs/places/` (final), `intermediate/matching/` (review), and the website's places data |
| 3. Boundaries | `03_region_boundaries.py` (needs geopandas; rerun only when the boundary data or simplification changes) | `data/Gazetteers/doi-10.5683-sp2-iq7e0x/` (HACOLP), `data/Gazetteers/naturalearth/`, and the TCP geodatabase (optional: where its subdivisions are under 500 km², borders keep 300 m detail instead of 4 km) | `data/Pipe Outputs/places/boundaries_hacolp.json`, `boundaries_world.json` |
| 4. Census subdivisions | `04_census_boundaries.py` (needs geopandas; about a minute; rerun only when the TCP data or simplification changes) | `data/Gazetteers/TCP_CANADA_CSD_202306/` | `data/Pipe Outputs/historical/`: one simplified layer per census (`tcp_csd_*.json`), overlaps between censuses (`tcp_links_*.json`) and the 1911 crosswalk (`tcp_1911_crosswalk.csv`), for the website's *Historical boundaries* map |

Step 1 finds place names with spaCy NER (`en_core_web_trf`), filters out names that are people, and suggests a place type from the context (settlement, region, country, water, landform, facility, vessel), e.g. *Quebec* the city vs the province. Step 2 matches each name to the curated overrides, the CGNDB, the TCP census subdivisions (“CHGIS”), or the curated world list, using that type and the provinces each book is set in. Each Canadian point also gets the census subdivision containing it, from the nearest census within ten years (`csd_*` columns); the website fills that subdivision when the place is named after it (`csd_same_name`). It then applies the hand corrections in `data/Gazetteers/curated/place_corrections.csv`, made on the website's map (section 8.0).

Folders:

- `resources/`: hand-edited lexicon of known names and their types, and a list of words that are never places.
- `intermediate/`: data passed between the steps and review tables. Everything here can be regenerated.
- `annotation/`: entries exported for hand-labelling (`to_annotate/`), corrected labels (`gold/`), and training data built from them (section 8 of step 1).

Gazetteer downloads are described in `data/Gazetteers/README.md`. The prototype pipelines are in `Pipelines/Archived_Pipelines/v1_place_*`.
