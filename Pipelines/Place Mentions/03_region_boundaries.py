"""Build the historical province/territory boundaries the website fills for region mentions.

Usage (from the repository root):
    python3 "Pipelines/Place Mentions/03_region_boundaries.py"

Reads the HACOLP Territorial Evolution polygons (one shapefile per boundary change,
1667–2001; see data/Gazetteers/README.md) and writes one file,
data/Pipe Outputs/places/boundaries_hacolp.json:

    {"years": [1667, …], "geometries": [GeoJSON geometry, …],
     "layers": {"1667": [{"name": …, "country": …, "g": index into geometries}, …], …}}

Names are normalised across years (Québec/Quebec, NorthWest/North-West Territories…),
the Great Lakes are cut out, shapes are simplified, and a polygon unchanged between
snapshots is stored once. Which mentions fill which polygon is decided on the site from
data/Gazetteers/curated/region_aliases.csv and region_polygons.csv, so editing those
needs only `python3 Web/scripts/sync_data.py`, not this script.

Needs geopandas.
"""
import json
import re
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import mapping

ROOT = Path(__file__).resolve().parents[2]
GAZ = ROOT / "data" / "Gazetteers"
OUT = ROOT / "data" / "Pipe Outputs" / "places" / "boundaries_hacolp.json"
SIMPLIFY_M = 4000  # tolerance in metres (layers are in a Lambert projection)
DECIMALS = 2       # ~1 km
DROP = {"Russia", "Greenland", "Iceland"}  # off the edge of the story; never filled

RENAME = {
    "Québec": "Quebec",
    "Vancouver`s Island": "Vancouver Island",
    "NorthWest Territories": "North-West Territories",
    "Saint John Island": "St. John's Island",
    "Saint John's Island": "St. John's Island",
    "Claimed by France and Britain": "Claimed by Britain and France",
    "Claimed by Britain and USA": "Claimed by US and Britain",
    "PEI": "Prince Edward Island",
    "Unknown": "Unclaimed",
}
COUNTRY = {"Hudsons Bay Company": "Hudson's Bay Company", "disputed": "Disputed",
           "disputed Brit US": "Disputed", "disputed Brit Rus": "Disputed", "none": "", "open": ""}


def layer_files():
    files = sorted(GAZ.glob("**/shapefiles_new/boundaries_*_poly.zip"))
    if not files:
        raise SystemExit(f"No HACOLP boundaries_*_poly.zip under {GAZ}; see its README.")
    return {int(re.search(r"_(\d{4})_poly", f.name).group(1)): f for f in files}


def name_of(r):
    for col in ("PROV_NAME", "FIRST_PROV"):
        v = r.get(col)
        if isinstance(v, str) and v.strip():
            return RENAME.get(v.strip(), v.strip())
    return {"France": "Saint-Pierre and Miquelon"}.get(r.get("COUNTRY"), "Unclaimed")


def country_of(r, name, year):
    c = r.get("COUNTRY")
    if isinstance(c, str) and c.strip():
        return COUNTRY.get(c.strip(), c.strip())
    # From 1882 the layers drop the COUNTRY field
    if name == "USA":
        return "USA"
    if name == "Newfoundland" and year < 1949:
        return "Britain"
    return "Canada"


def rounded(o):
    if isinstance(o, float):
        return round(o, DECIMALS)
    if isinstance(o, (list, tuple)):
        return [rounded(x) for x in o]
    if isinstance(o, dict):
        return {k: rounded(v) for k, v in o.items()}
    return o


def main():
    files = layer_files()
    lakes_zip = next(GAZ.glob("**/shapefiles_new/Lakes_poly.zip"), None)
    lakes = gpd.read_file(f"zip://{lakes_zip}").union_all() if lakes_zip else None

    geoms, geom_index, layers = [], {}, {}
    for year, f in files.items():
        g = gpd.read_file(f"zip://{f}")
        g["name"] = [name_of(r) for _, r in g.iterrows()]
        g["country"] = [country_of(r, n, year) for (_, r), n in zip(g.iterrows(), g["name"])]
        g = g[~g["name"].isin(DROP)]
        g = g.dissolve(by=["name", "country"], as_index=False)[["name", "country", "geometry"]]
        if lakes is not None:
            g["geometry"] = g.geometry.difference(lakes)
        g["geometry"] = g.geometry.simplify(SIMPLIFY_M, preserve_topology=True)
        g = g[~g.geometry.is_empty].to_crs(4326)
        feats = []
        for _, r in g.iterrows():
            gj = json.dumps(rounded(mapping(r.geometry)), separators=(",", ":"))
            if gj not in geom_index:
                geom_index[gj] = len(geoms)
                geoms.append(json.loads(gj))
            feats.append({"name": r["name"], "country": r["country"], "g": geom_index[gj]})
        layers[str(year)] = feats
        print(f"  {year}: {len(feats)} polygons")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "source": "Historical Atlas of Canada Online Learning Project (HACOLP), Territorial Evolution 2012. "
                  "Borealis, doi:10.5683/SP2/IQ7E0X",
        "years": sorted(files), "geometries": geoms, "layers": layers,
    }, separators=(",", ":"), ensure_ascii=False))
    names = sorted({f["name"] for fs in layers.values() for f in fs})
    print(f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1e6:.1f} MB, {len(geoms)} unique shapes).")
    print("Polygon names:", "; ".join(names))


if __name__ == "__main__":
    pd.options.mode.chained_assignment = None
    main()
