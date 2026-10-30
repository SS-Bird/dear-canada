"""Build the census subdivision layers for the website's historical boundaries map, and the 1911 crosswalk.

Usage (from the repository root):
    python3 "Pipelines/Place Mentions/04_census_boundaries.py"

Reads The Canadian Peoples (TCP) census subdivision geodatabase (data/Gazetteers/TCP_CANADA_CSD_202306/,
see data/Gazetteers/README.md) and writes to data/Pipe Outputs/historical/:

    tcp_csd_<layer>.json    one per layer (1851 … 1921, plus 1911_V1T1 and 1911_V2T2), simplified:
        {"key": "1911", "year": 1911, "layer": "CANADA_1911_CSD", "table": …, "geometries": [GeoJSON geometry, …],
         "features": [{"id", "name", "cd", "pr", "km2", "hex": true if a placeholder hexagon}, …]}
    tcp_links_<layer>.json  for each feature of that layer (same order), the features of every other layer it
        overlaps: {"key": "1911", "links": [{"1901": [[index, share of this, share of that], …], …}, …]}
    tcp_1911_crosswalk.csv  each subdivision of the main (hybrid) 1911 layer against the subdivisions of the
        published tables it was built from (Volume 1 Table 1 and Volume 2 Table 2), for joining aggregate data

Shares are fractions of each polygon's area, computed on the simplified polygons (so to about a
percent); overlaps under MIN_SHARE of both polygons (slivers along a redrawn border) are left out.

Needs geopandas and shapely 2.
"""
import csv
import json
import math
import re
from pathlib import Path

import geopandas as gpd
import numpy as np
import pyogrio
import shapely
from shapely.geometry import mapping

ROOT = Path(__file__).resolve().parents[2]
GDB = next((ROOT / "data" / "Gazetteers" / "TCP_CANADA_CSD_202306").glob("*.gdb"), None)
OUT = ROOT / "data" / "Pipe Outputs" / "historical"
SIMPLIFY_M = 120      # base tolerance in metres (layers are in Canada Lambert); large polygons get up to 1/300 of their width
DECIMALS = 4          # ~10 m
MIN_SHARE = 0.02      # overlaps smaller than this share of both polygons are slivers
HEX_KM2 = (2.4, 2.7)  # TCP's placeholder hexagons are 1 km a side (about 2.6 km²)

# The key table each layer reproduces (from TCP_CANADA_HGIS_CSD_202306.pdf)
TABLES = {
    "1851": "1851 Vol. 1, Table 3 (Appendices 5 and 6)",
    "1861": "1861 Vol. 1, Tables 1 and 2",
    "1871": "1871 Vol. 1, Table 1",
    "1881": "1881 Vol. 1, Table 1",
    "1891": "1891 Vol. 1, Table 3",
    "1901": "1901 Vol. 1, Table 7",
    "1911": "Hybrid: 1911 Vol. 1, Table 1 for NB, NS, PE, ON, QC; Vol. 2, Table 2 for the west",
    "1911_V1T1": "1911 Vol. 1, Table 1",
    "1911_V2T2": "1911 Vol. 2, Table 2",
    "1921": "1921 Vol. 1, Table 16",
}


def field(gdf, stem):
    """The column whose name, without its census year, is `stem` (NAME_CSD_1911, Name_CSD_1851 → namecsd)."""
    for c in gdf.columns:
        if re.sub(r"_?1[89]\d{2}$", "", re.sub(r"[^a-z0-9_]", "", c.lower())).replace("_", "") == stem:
            return c
    raise KeyError(f"no {stem} field in {list(gdf.columns)}")


def rounded(o):
    if isinstance(o, float):
        return round(o, DECIMALS)
    if isinstance(o, (list, tuple)):
        return [rounded(x) for x in o]
    if isinstance(o, dict):
        return {k: rounded(v) for k, v in o.items()}
    return o


def simplify_for_web(geom):
    """Simplify with a tolerance that grows with the polygon (the 1921 Northwest Territories is the whole Arctic)."""
    tol = max(SIMPLIFY_M, math.sqrt(geom.area) / 300)
    parts = [p for p in getattr(geom, "geoms", [geom]) if p.area >= tol * tol]
    geom = shapely.MultiPolygon(parts) if len(parts) > 1 else (parts[0] if parts else geom)
    return geom.simplify(tol, preserve_topology=True)


def is_hexagon(geom):
    km2 = geom.area / 1e6
    polys = getattr(geom, "geoms", [geom])
    return HEX_KM2[0] <= km2 <= HEX_KM2[1] and len(polys) == 1 and len(polys[0].exterior.coords) == 7


def load_layers():
    if GDB is None:
        raise SystemExit("No .gdb in data/Gazetteers/TCP_CANADA_CSD_202306/; see data/Gazetteers/README.md")
    layers = {}
    for name, _ in pyogrio.list_layers(GDB):
        m = re.fullmatch(r"CANADA_(\d{4})_CSD(?:_(V1T1|V2T2))?", name)
        if not m:
            continue
        key = m.group(1) + (f"_{m.group(2)}" if m.group(2) else "")
        g = gpd.read_file(GDB, layer=name)
        uid = next(c for c in g.columns if "UID" in c.upper())
        g = gpd.GeoDataFrame({
            "id": g[uid].astype(str), "name": g[field(g, "namecsd")].astype(str).str.strip(),
            "cd": g[field(g, "namecd")].astype(str).str.strip(), "pr": g[field(g, "pr")].astype(str),
        }, geometry=shapely.make_valid(g.geometry.values), crs=g.crs)
        g = g[~g.geometry.is_empty].reset_index(drop=True)
        g["web"] = shapely.make_valid(np.array([simplify_for_web(x) for x in g.geometry], dtype=object))
        layers[key] = (name, g)
        print(f"  {key:10} {name:22} {len(g):6} subdivisions")
    return dict(sorted(layers.items()))


def overlaps(a, b):
    """(i, j, share of a[i], share of b[j]) for every pair of overlapping polygons above MIN_SHARE.
    Computed on the simplified polygons: full-detail coastlines make the intersections far too slow."""
    ga, gb = a["web"].values, b["web"].values
    ia, ib = shapely.STRtree(gb).query(ga, predicate="intersects")
    if not len(ia):
        return []
    inter = shapely.area(shapely.intersection(ga[ia], gb[ib]))
    sa, sb = inter / shapely.area(ga[ia]), inter / shapely.area(gb[ib])
    keep = (sa >= MIN_SHARE) | (sb >= MIN_SHARE)
    return list(zip(ia[keep].tolist(), ib[keep].tolist(), np.round(sa[keep], 3).tolist(), np.round(sb[keep], 3).tolist()))


def write_layer(key, name, g):
    web = gpd.GeoSeries(g["web"], crs=g.crs).to_crs(4326)
    feats = [{"id": r.id, "name": r.name, "cd": r.cd, "pr": r.pr, "km2": round(geom.area / 1e6, 2),
              **({"hex": True} if is_hexagon(geom) else {})}
             for r, geom in zip(g.itertuples(), g.geometry)]
    path = OUT / f"tcp_csd_{key}.json"
    path.write_text(json.dumps({
        "source": "The Canadian Peoples / Les populations canadiennes Project, “Census of Canada Historical GIS, "
                  "CSD Polygons,” CIEQ, Université Laval and HGIS Lab, University of Saskatchewan, 2023 (CC open data)",
        "key": key, "year": int(key[:4]), "layer": name, "table": TABLES.get(key, ""),
        "geometries": [rounded(mapping(x)) for x in web], "features": feats,
    }, separators=(",", ":"), ensure_ascii=False))
    print(f"  wrote {path.name} ({path.stat().st_size / 1e6:.1f} MB)")


def relation(sh, so):
    if max(sh, so) < 0.05:
        return "border_sliver"     # neighbours touching along a border drawn slightly differently
    if sh >= 0.98 and so >= 0.98:
        return "identical"
    if sh >= 0.98:
        return "hybrid_within"     # the hybrid unit is part of the table's unit (the table merged units)
    if so >= 0.98:
        return "hybrid_contains"   # the table split the hybrid unit
    return "overlap"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    layers = load_layers()
    for key, (name, g) in layers.items():
        write_layer(key, name, g)

    keys = list(layers)
    links = {k: [dict() for _ in range(len(layers[k][1]))] for k in keys}
    pairs = {}
    for i, ka in enumerate(keys):
        for kb in keys[i + 1:]:
            ov = overlaps(layers[ka][1], layers[kb][1])
            pairs[(ka, kb)] = ov
            for a, b, sa, sb in ov:
                links[ka][a].setdefault(kb, []).append([b, sa, sb])
                links[kb][b].setdefault(ka, []).append([a, sb, sa])
            print(f"  {ka} × {kb}: {len(ov)} overlaps")
    for k in keys:
        for d in links[k]:
            for lst in d.values():
                lst.sort(key=lambda x: -x[1])
        path = OUT / f"tcp_links_{k}.json"
        path.write_text(json.dumps({"key": k, "min_share": MIN_SHARE, "links": links[k]}, separators=(",", ":")))
        print(f"  wrote {path.name} ({path.stat().st_size / 1e6:.1f} MB)")

    # 1911 crosswalk: the hybrid layer against both published tables
    hyb = layers["1911"][1]
    path = OUT / "tcp_1911_crosswalk.csv"
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["hybrid_id", "hybrid_name", "cd", "pr", "table", "table_id", "table_name",
                    "relation", "share_of_hybrid", "share_of_table"])
        n = 0
        for tk in ("1911_V1T1", "1911_V2T2"):
            tab = layers[tk][1]
            for a, b, sa, sb in sorted(pairs[("1911", tk)], key=lambda x: (hyb.id[x[0]], -x[2])):
                h, t = hyb.iloc[a], tab.iloc[b]
                w.writerow([h.id, h["name"], h.cd, h.pr, tk[5:], t.id, t["name"], relation(sa, sb), sa, sb])
                n += 1
    print(f"  wrote {path.name} ({n} rows)")


if __name__ == "__main__":
    main()
