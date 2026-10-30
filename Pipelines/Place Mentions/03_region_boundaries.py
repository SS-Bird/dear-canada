"""Build the boundaries the website fills for region and country mentions.

Usage (from the repository root):
    python3 "Pipelines/Place Mentions/03_region_boundaries.py"

Reads the HACOLP Territorial Evolution polygons (one shapefile per boundary change,
1667–2001; see data/Gazetteers/README.md) and writes one file,
data/Pipe Outputs/places/boundaries_hacolp.json:

    {"years": [1667, …], "geometries": [GeoJSON geometry, …],
     "layers": {"1667": [{"name": …, "country": …, "g": index into geometries}, …], …}}

It also reads Natural Earth's modern countries (1:50m map units, so England, Scotland and
Wales are separate) and US states, and writes data/Pipe Outputs/places/boundaries_world.json:

    {"features": [{"name": …, "admin": …, "kind": "country" | "state", "g": GeoJSON geometry}, …],
     "names": {folded name: [feature index, …]}}

`names` holds each unit's own names, and its country's name for every unit of that country
("united kingdom" → England, Scotland, Wales, Northern Ireland). Canada is left out: Canadian
mentions use the historical layers.

Names are normalised across years (Québec/Quebec, NorthWest/North-West Territories…),
the Great Lakes are cut out, shapes are simplified, and a polygon unchanged between
snapshots is stored once. Simplification is lighter in densely settled areas: within
DENSE_BUFFER_M of any TCP census subdivision under DENSE_KM2 (any census, 1851–1921), so the
St. Lawrence valley, southern Ontario, the Maritimes and the Vancouver area keep their coasts
and rivers. Without the TCP geodatabase every area is simplified the same way. Which mentions fill which polygon is decided on the site from
data/Gazetteers/curated/region_aliases.csv and region_polygons.csv, so editing those
needs only `python3 Web/scripts/sync_data.py`, not this script.

Needs geopandas.
"""
import json
import re
import unicodedata
from pathlib import Path

import geopandas as gpd
import pandas as pd
import pyogrio
import shapely
from shapely.geometry import mapping

ROOT = Path(__file__).resolve().parents[2]
GAZ = ROOT / "data" / "Gazetteers"
OUT = ROOT / "data" / "Pipe Outputs" / "places" / "boundaries_hacolp.json"
OUT_WORLD = ROOT / "data" / "Pipe Outputs" / "places" / "boundaries_world.json"
NE_DIR = GAZ / "naturalearth"
WORLD_SIMPLIFY_DEG = 0.03  # Natural Earth is in degrees
WORLD_STATES_OF = {"United States of America"}  # countries drawn down to states/provinces
SIMPLIFY_M = 4000  # tolerance in metres (layers are in a Lambert projection)
DENSE_SIMPLIFY_M = 300  # tolerance in densely settled areas
DENSE_WORLD_DEG = 0.004  # the same for Natural Earth (US states along the border)
DENSE_KM2, DENSE_BUFFER_M = 500, 5000  # see the docstring
DECIMALS = 3       # ~100 m
TCP_GDB = next((GAZ / "TCP_CANADA_CSD_202306").glob("*.gdb"), None)
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


def fold(s):
    """Same as fold() in 02_place_matching.ipynb and js/util.js."""
    s = unicodedata.normalize("NFKD", str(s))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = s.replace("'", "").replace("’", "").replace("‘", "").replace(".", "")
    s = re.sub(r"[-‐‑–—/]", " ", s)
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\bsaint\b", "st", s)
    s = re.sub(r"\bsainte\b", "ste", s)
    return " ".join(s.split())


def dense_mask():
    """Where census subdivisions are small: a GeoSeries of one polygon in the TCP projection, or None."""
    if TCP_GDB is None:
        print("  ! no TCP geodatabase; boundaries are simplified the same way everywhere")
        return None
    parts, crs = [], None
    for layer in pyogrio.list_layers(TCP_GDB)[:, 0]:
        if not re.match(r"^CANADA_\d{4}_CSD$", layer):
            continue
        g = pyogrio.read_dataframe(TCP_GDB, layer=layer, columns=[])
        crs = g.crs
        parts.extend(g.geometry[g.geometry.area < DENSE_KM2 * 1e6].simplify(300))
    mask = shapely.union_all(shapely.buffer(parts, DENSE_BUFFER_M, quad_segs=4)).simplify(2000)
    print(f"  dense areas: {mask.area / 1e6:,.0f} km²")
    return gpd.GeoSeries([mask], crs=crs)


def polygons_only(geom):
    parts = [p for p in shapely.get_parts(shapely.make_valid(geom)) if p.geom_type in ("Polygon", "MultiPolygon")]
    return shapely.union_all(parts) if parts else shapely.Polygon()


def simplify(geom, tol, dense_tol, mask):
    """Simplify with `tol`, but with `dense_tol` inside `mask` (a shapely geometry or None)."""
    coarse = geom.simplify(tol, preserve_topology=True)
    if mask is None or not geom.intersects(mask):
        return coarse
    fine = geom.simplify(dense_tol, preserve_topology=True)
    return polygons_only(shapely.union(fine.intersection(mask), coarse.difference(mask)))


def build_world(mask=None):
    units_zip, states_zip = NE_DIR / "ne_50m_admin_0_map_units.zip", NE_DIR / "ne_50m_admin_1_states_provinces_lakes.zip"
    if not units_zip.exists():
        print(f"  ! {units_zip.relative_to(ROOT)} not found; skipping the world layer (see data/Gazetteers/README.md)")
        return
    units = gpd.read_file(f"zip://{units_zip}")
    units = units[units["ADMIN"] != "Canada"]
    feats, names, by_admin = [], {}, {}

    def add(name, admin, kind, geom, aliases):
        geom = simplify(geom, WORLD_SIMPLIFY_DEG, DENSE_WORLD_DEG, mask)
        if geom.is_empty:
            return
        i = len(feats)
        feats.append({"name": name, "admin": admin, "kind": kind, "g": rounded(mapping(geom))})
        for a in aliases:
            if isinstance(a, str) and a.strip():
                names.setdefault(fold(a), [i])  # first one wins: countries before states (Georgia)
        by_admin.setdefault(admin, []).append(i)

    for _, r in units.iterrows():
        add(r["NAME_LONG"], r["ADMIN"], "country", r.geometry,
            [r["NAME"], r["NAME_LONG"], r["GEOUNIT"], r["SUBUNIT"], r["BRK_NAME"], r["FORMAL_EN"]])
    for admin, idx in by_admin.items():
        names.setdefault(fold(admin), idx)
    if states_zip.exists():
        states = gpd.read_file(f"zip://{states_zip}")
        for _, r in states[states["admin"].isin(WORLD_STATES_OF)].iterrows():
            add(r["name"], r["admin"], "state", r.geometry, [r["name"]])
    OUT_WORLD.write_text(json.dumps({
        "source": "Natural Earth 1:50m admin 0 map units and admin 1 states/provinces (public domain), modern borders",
        "features": feats, "names": names,
    }, separators=(",", ":"), ensure_ascii=False))
    print(f"Wrote {OUT_WORLD.relative_to(ROOT)} ({OUT_WORLD.stat().st_size / 1e6:.1f} MB, {len(feats)} shapes).")


def main():
    dense = dense_mask()
    build_world(dense.to_crs(4326).iloc[0] if dense is not None else None)
    files = layer_files()
    mask = None
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
        if mask is None and dense is not None:
            mask = dense.to_crs(g.crs).iloc[0]
        g["geometry"] = [simplify(x, SIMPLIFY_M, DENSE_SIMPLIFY_M, mask) for x in g.geometry]
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
