"""
config.py — Dear Canada project configuration
==============================================
Single source of truth for:
  - Project paths
  - Book registry
  - Stop words (global + per-book)

Edit this file when you add a book, change a path, or adjust stop words.
Everything else (notebooks, utils) reads from here.
"""

from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────────────
# Root is the 'Dear Canada' folder — one level above CLS_from_162/
ROOT = Path(__file__).resolve().parent

TEXT_FILES_DIR = ROOT / "TextFiles"
DB_FOLDER      = ROOT / "MLAsgmts" / "dataframes" / "untagged" / "sentence_dfs"


# ── Stop words ─────────────────────────────────────────────────────────────────
# Added on top of NLTK's English stop-word list for every book.
# >>> Edit freely.
CUSTOM_STOP_WORDS_GLOBAL = [
     "said", "mother", "father", "Ma", "Pa", "michael", "grannie", "mama", "papa", "mr", "mrs", "tante", "barbe", "andry", "got"
]

# Extra stop words applied only to the named book.
# Keys must match the short names in BOOKS below.
# >>> Add per-book lists as needed.
CUSTOM_STOP_WORDS_PER_BOOK = {
    # "SofS":   ["anne", "marilla"],
    # "AinUTL": ["maman", "papa"],
}


# ── Book registry ──────────────────────────────────────────────────────────────
# Add one entry per Dear Canada book.
#
# Required keys
# -------------
# file             Path to the .txt file
# start_marker     ===== … ===== line where the diary body begins
# end_marker       ===== … ===== line where back-matter begins
# chapter_pattern  regex capturing the chapter id from those markers
# date_pattern     regex matching diary-entry date headings in the text
# girl_name        protagonist's first name (used by embedding section)
#
# Templates
# ---------
# Template A — most Dear Canada epubs (c01.htm structure)
# {
#     "file":            TEXT_FILES_DIR / "yourbook.txt",
#     "start_marker":    "===== c01.htm =====",
#     "end_marker":      "===== cop.htm =====",
#     "chapter_pattern": r"===== (c\d+)\.htm =====",
#     "date_pattern":    r"\b(January|February|March|April|May|June|July|"
#                         r"August|September|October|November|December)"
#                         r"\s+\d{1,2},\s*\d{4}\b",
#     "girl_name":       "FirstName",
# }
#
# Template B — ISBN prefix in filenames
# {
#     "file":            TEXT_FILES_DIR / "yourbook.txt",
#     "start_marker":    "===== 9781443100000_epub_c01.htm =====",
#     "end_marker":      "===== 9781443100000_epub_cop_r1.htm =====",
#     "chapter_pattern": r"===== 9781443100000_epub_c(\d+)\.htm =====",
#     "date_pattern":    r"\b(January|February|March|April|May|June|July|"
#                         r"August|September|October|November|December)\s+\d{1,2}\b",
#     "girl_name":       "FirstName",
# }
#
# Template C — ch1.html naming
# {
#     "file":            TEXT_FILES_DIR / "yourbook.txt",
#     "start_marker":    "===== ch1.html =====",
#     "end_marker":      "===== cop.html =====",
#     "chapter_pattern": r"===== ch(\d+)\.html =====",
#     "date_pattern":    r"\b(January|February|March|April|May|June|July|"
#                         r"August|September|October|November|December)"
#                         r"\s+\d{1,2}(?:st|nd|rd|th),\s*\d{4}\b",
#     "girl_name":       "FirstName",
# }

BOOKS = {
    "SofS": {
         "file": "../TextFiles/SofS.txt",         # >>> path to your .txt file
         "start_marker": "===== c01.htm =====",     # >>> first content section
         "end_marker":   "===== cop.htm =====",     # >>> copyright/back-matter marker
         "chapter_pattern": r"===== (c\d+)\.htm =====",
         "date_pattern": r"\b(January|February|March|April|May|June|July|"
                          r"August|September|October|November|December)"
                          r"\s+\d{1,2},\s*\d{4}\b",
    },

    "FitS": {
        "file": "../TextFiles/FitS.txt",
        "start_marker": "===== c01.htm =====",
        "end_marker": "===== cop.htm =====",
        "chapter_pattern": r"===== (c\d+)\.htm =====",
        "date_pattern": r"\b(January|February|March|April|May|June|July|August|September|"
             r"October|November|December)"
            r"\s+\d{1,2}\b"
    },

    "DRtoF": {
        "file": "../TextFiles/drtof.txt",
        "start_marker": "===== c01.htm =====",
        "end_marker": "===== cop.htm =====",
        "chapter_pattern": r"===== (c\d+)\.htm =====",
        "date_pattern": r"\b((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*"
                r"(January|February|March|April|May|June|July|August|September|"
                r"October|November|December)"
                r"\s+\d{1,2}"
                r"(?:\s*\n?\s*(?:st|nd|rd|th))?"
                r"[\s,\n]*\d{4}"
                r"(January|February|March|April|May|June|July|August|September|October|November|December)"
                r"\s+\d{4}"
                r"\b\d{4}\b"
    },

    "PasWide": {
        "file": "../TextFiles/PasWide.txt",
        "start_marker": "===== 9781443113342_epub_c01.htm =====",
        "end_marker": "===== 9781443113342_epub_cop_r1.htm =====",
        "chapter_pattern": r"===== 9781443113342_epub_c(\d+)\.htm =====",
        "date_pattern": r"\b(January|February|March|April|May|June|July|August|September|October|November|December)"
            r"\s+\d{1,2}\b"
    },

    "NbutC": {
        "file": "../TextFiles/NbutC.txt",
        "start_marker": "===== ch1.html =====",
        "end_marker": "===== cop.html =====",
        "chapter_pattern": r"===== ch(\d+)\.html =====",
        "date_pattern": r"\b(January|February|March|April|May|June|July|August|September|October|November|December)"
            r"\s+\d{1,2}(?:st|nd|rd|th),\s*\d{4}"
            r"\b"
    },

    "AinUTL": {
        "file": "../TextFiles/AinUTL.txt",
        "start_marker": "===== ch1.html =====",
        "end_marker": "===== cop.html =====",
        "chapter_pattern": r"===== ch(\d+)\.html =====",
        "date_pattern": r"\ble\s+\d{1,2}\s+"
            r"(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)"
            r"\s+\d{4}\b"
    }
}
