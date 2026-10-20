"""Copy pipeline outputs into the website and rebuild public/data/manifest.json.

Usage (from the Web/ folder):
    python3 scripts/sync_data.py

Reads data_sources.json, copies every matching file into public/data/<project>/,
removes files that are no longer listed, and writes a manifest the site reads on
load (file list, row counts, column names and a short preview of each file).
Standard library only.
"""
import csv
import datetime as dt
import glob
import json
import re
import shutil
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent
CONFIG = WEB / "data_sources.json"
OUT = WEB / "public" / "data"
HEAD_ROWS = 8
csv.field_size_limit(sys.maxsize)


def infer_role(name):
    if re.search(r"_edges\.json$", name):
        return "edges"
    if "_nodes_" in name:
        return "nodes"
    if re.search(r"_mentions\.json$", name):
        return "mentions"
    return "other"


def infer_group(name):
    """Book/run prefix, e.g. 'SofS_entries_halved' from 'SofS_entries_halved_nodes_dates.json'."""
    m = re.match(r"(.+?)_(nodes_|edges|mentions)", name)
    return m.group(1) if m else None


def short(v, n=120):
    s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
    return s if len(s) <= n else s[: n - 1] + "…"


def describe(path):
    if path.suffix.lower() == ".csv":
        with open(path, newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            rows, head = 0, []
            for r in reader:
                if rows < HEAD_ROWS:
                    head.append({k: short(v) for k, v in r.items()})
                rows += 1
            return "csv", rows, reader.fieldnames or [], head
    if path.suffix.lower() == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data = [data]
        cols = []
        for r in data[:200]:
            for k in (r if isinstance(r, dict) else {}):
                if k not in cols:
                    cols.append(k)
        head = [{k: short(v) for k, v in r.items()} if isinstance(r, dict) else {"value": short(r)} for r in data[:HEAD_ROWS]]
        return "json", len(data), cols, head
    return path.suffix.lstrip("."), None, [], []


def main():
    cfg = json.loads(CONFIG.read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    entries, keep = [], set()

    for spec in cfg["datasets"]:
        matches = sorted(glob.glob(str((CONFIG.parent / spec["source"]).resolve())))
        if not matches:
            print(f"  ! nothing matched {spec['source']}")
        for src in map(Path, matches):
            dest = OUT / spec["project"] / src.name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
            keep.add(dest)
            fmt, rows, cols, head = describe(dest)
            rel = dest.relative_to(WEB / "public").as_posix()
            entries.append({
                "id": rel.removeprefix("data/"),
                "project": spec["project"],
                "role": spec.get("role") or infer_role(src.name),
                "group": spec.get("group") or infer_group(src.name),
                "name": src.name,
                "path": rel,
                "format": fmt,
                "bytes": dest.stat().st_size,
                "rows": rows,
                "columns": cols,
                "head": head,
                "modified": dt.datetime.fromtimestamp(src.stat().st_mtime, dt.timezone.utc).isoformat(timespec="seconds"),
            })
            print(f"  + {rel}  ({rows} rows)")

    for f in OUT.rglob("*"):
        if f.is_file() and f.name != "manifest.json" and f not in keep:
            f.unlink()
            print(f"  - removed {f.relative_to(WEB / 'public')}")
    for d in sorted(OUT.rglob("*"), reverse=True):
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()

    (OUT / "manifest.json").write_text(json.dumps({"synced": now, "datasets": entries}, indent=1, ensure_ascii=False))
    print(f"Wrote manifest with {len(entries)} datasets.")


if __name__ == "__main__":
    main()
