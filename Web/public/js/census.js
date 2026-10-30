// TCP census subdivision layers (project "historical", role "csd_layer": tcp_csd_<key>.json, written by
// Pipelines/Place Mentions/04_census_boundaries.py), for the correction form and for subdivisions attached
// by hand that are not yet in the places dataset csd_polygons.geojson.
import { fetchDataset } from "./data.js";

const cache = new Map();
const fileOf = (manifest, key) => manifest?.datasets.find(d => d.project === "historical" && d.role === "csd_layer" && d.name === `tcp_csd_${key}.json`);

/** The main census years with a layer in the manifest (1851 … 1921; the 1911 alternatives are left out). */
export const censusYears = manifest => (manifest?.datasets || [])
  .map(d => d.project === "historical" && d.role === "csd_layer" && d.name.match(/^tcp_csd_(\d{4})\.json$/)?.[1])
  .filter(Boolean).map(Number).sort((a, b) => a - b);

/** The census nearest a year (ties to the earlier one), with no limit on the distance. */
export function nearestCensus(years, y) {
  if (!years.length || !isFinite(y)) return years.at(-1) ?? null;
  return years.reduce((best, c) => Math.abs(c - y) < Math.abs(best - y) ? c : best);
}

/** { year, features: [{id, name, cd, pr, km2, hex}], geometries, byId: Map(id → index) }, loaded once. */
export function loadCensus(manifest, year) {
  const key = String(year);
  if (!cache.has(key)) {
    const ds = fileOf(manifest, key);
    cache.set(key, ds ? fetchDataset(ds).then(d => ({ ...d, byId: new Map(d.features.map((f, i) => [f.id, i])), boxes: null }))
      : Promise.reject(new Error(`No census layer for ${key} in the manifest`)));
  }
  return cache.get(key);
}

const ringsOf = g => g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat() : [];

/** Index of the feature containing [lon, lat] (even–odd rule over all rings), or -1. */
export function csdAt(layer, lat, lon) {
  layer.boxes ??= layer.geometries.map(g => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const ring of ringsOf(g)) for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return [x0, y0, x1, y1];
  });
  let best = -1;
  layer.geometries.forEach((g, i) => {
    const [x0, y0, x1, y1] = layer.boxes[i];
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) return;
    let inside = false;
    for (const ring of ringsOf(g)) {
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        const [xa, ya] = ring[a], [xb, yb] = ring[b];
        if ((ya > lat) !== (yb > lat) && lon < (xb - xa) * (lat - ya) / (yb - ya) + xa) inside = !inside;
      }
    }
    // A placeholder hexagon sits inside its larger subdivision; prefer the smaller one
    if (inside && (best < 0 || layer.features[i].km2 < layer.features[best].km2)) best = i;
  });
  return best;
}

export const csdText = f => [f.name, f.cd && f.cd !== f.name ? f.cd : null, f.pr].filter(Boolean).join(", ");
