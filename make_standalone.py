"""
make_standalone.py
==================
Inlines config.py and dear_canada_utils.py into any notebook so it can be
shared as a single self-contained .ipynb file — no external dependencies.

Usage
-----
    python make_standalone.py CLS_from_162/notebook_01_text_analysis.ipynb

Output
------
    CLS_from_162/notebook_01_text_analysis_standalone.ipynb

The original notebook is never modified.
"""

import json
import sys
import textwrap
from pathlib import Path

ROOT       = Path(__file__).resolve().parent
CONFIG     = ROOT / "config.py"
UTILS      = ROOT / "dear_canada_utils.py"
IMPORT_TAG = "# AUTO-GENERATED — do not edit this cell by hand"


def _make_code_cell(source: str) -> dict:
    return {
        "cell_type":       "code",
        "execution_count": None,
        "metadata":        {},
        "outputs":         [],
        "source":          source,
    }


def _make_markdown_cell(source: str) -> dict:
    return {
        "cell_type": "markdown",
        "metadata":  {},
        "source":    source,
    }


def _strip_import_cells(cells: list) -> list:
    """Remove previously inlined cells so re-running is idempotent."""
    return [c for c in cells if IMPORT_TAG not in "".join(c.get("source", []))]


def make_standalone(notebook_path: Path) -> Path:
    nb = json.loads(notebook_path.read_text(encoding="utf-8"))

    config_src = CONFIG.read_text(encoding="utf-8")
    utils_src  = UTILS.read_text(encoding="utf-8")

    # Remove the `from config import …` and `sys.path` lines from utils
    # since config will be inlined directly above it.
    utils_lines = []
    for line in utils_src.splitlines():
        if line.startswith("from config import") or (
            "sys.path.insert" in line and "dear_canada_utils" in line
        ):
            continue
        utils_lines.append(line)
    utils_src_clean = "\n".join(utils_lines)

    header = _make_markdown_cell(
        "## Inlined dependencies\n"
        "_This cell and the two code cells below were generated automatically "
        "by `make_standalone.py`. They replace the external `config.py` and "
        "`dear_canada_utils.py` files so this notebook is fully self-contained._"
    )

    config_cell = _make_code_cell(
        f"{IMPORT_TAG}\n# ── config.py (inlined) "
        + "─" * 50
        + f"\n\n{config_src}"
    )

    utils_cell = _make_code_cell(
        f"{IMPORT_TAG}\n# ── dear_canada_utils.py (inlined) "
        + "─" * 40
        + f"\n\n{utils_src_clean}"
    )

    cells = _strip_import_cells(nb["cells"])

    # Find the first code cell that does sys.path / imports and insert before it
    insert_at = 0
    for i, cell in enumerate(cells):
        src = "".join(cell.get("source", []))
        if "sys.path" in src or "from dear_canada_utils" in src:
            insert_at = i
            break

    cells = (
        cells[:insert_at]
        + [header, config_cell, utils_cell]
        + cells[insert_at:]
    )

    nb["cells"] = cells
    out_path    = notebook_path.with_stem(notebook_path.stem + "_standalone")
    out_path.write_text(json.dumps(nb, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Written → {out_path}")
    return out_path


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    for arg in sys.argv[1:]:
        make_standalone(Path(arg).resolve())
