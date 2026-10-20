// All data comes from public/data/, written by scripts/sync_data.py.
// The manifest is always revalidated; each data file is requested with its modified time
// as a version tag, so browsers keep an unchanged file cached between visits
// and fetch it again only after it changes.
import { parseCSV } from "./util.js";

let manifestPromise = null;
const cache = new Map();

export function loadManifest() {
  manifestPromise ??= fetch("data/manifest.json", { cache: "no-cache" }).then(r => {
    if (!r.ok) throw new Error("manifest.json not found — run scripts/sync_data.py");
    return r.json();
  });
  return manifestPromise;
}

export function fetchDataset(ds) {
  if (!cache.has(ds.path)) {
    const url = ds.path + "?v=" + encodeURIComponent(ds.modified || "");
    cache.set(ds.path, fetch(url).then(async r => {
      if (!r.ok) throw new Error(`Could not load ${ds.name} (${r.status})`);
      return ds.format === "csv" ? parseCSV(await r.text()) : r.json();
    }));
    cache.get(ds.path).catch(() => cache.delete(ds.path));
  }
  return cache.get(ds.path);
}
