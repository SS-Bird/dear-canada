# Dear Canada — Computational Distant Reading

A digital humanities project applying computational text analysis to the *Dear Canada* series — a collection of historical fiction novels written as girls' diaries, published by Scholastic Canada. Each book follows a different protagonist through a formative period of Canadian history, narrated entirely in the first person.

The six books analysed here span the seventeenth to early twentieth centuries and together offer a portrait of girlhood, migration, survival, and identity across very different historical contexts:

| Short name | Title | Setting |
|------------|-------|---------|
| `SofS` | *A Sea of Sorrows* | Irish famine migration, 1847 |
| `NbutC` | *With Nothing but Our Courage* | Loyalist exodus, 1783 |
| `AinUTL` | *Alone in an Untamed Land* | New France, 1666 |
| `DRtoF` | *A Desperate Road to Freedom*  | Underground Railroad, 1856 |
| `FitS` | *Footsteps in the Snow* | Red River Settlement, 1815 |
| `PasWide` | *A Prairie as Wide as the Sea*  | Ukrainian immigration, 1903 |

---

## What this project does

The analysis treats each book as a corpus of diary entries and applies a range of computational methods to surface patterns that are difficult to see through close reading alone — emotional arcs across a narrative, shared vocabulary between characters, thematic clusters, and how closely the girls' voices resemble one another at a semantic level.

**Notebook 1 — Text Analysis** covers exploratory, word-count-based methods:
- Word clouds (full book or per chapter)
- Word frequency over narrative time
- Sentiment analysis via VADER (by entry or by chapter)
- N-gram analysis (unigrams, bigrams, trigrams)
- Keyword-in-context search

**Notebook 2 — Modelling** covers the heavier computational methods:
- LDA topic modelling with per-book heatmaps
- Character-level BERT sentence embeddings
- Cosine similarity matrix across all six girls
- UMAP projection of sentence embeddings
- Semantic sentence search across books

**Sentiment Analysis** 
 - A separate repo is established for that set of projects, find it here: https://github.com/SS-Bird/dear-canada-ml- 


---

## Project structure

```
Dear Canada/
├── config.py                        # book registry, paths, stop words — edit here
├── dear_canada_utils.py             # all analysis functions
├── make_standalone.py               # export a self-contained notebook for sharing
├── TextFiles/                       # plain-text exports of each epub
├── MLAsgmts/
│   └── dataframes/
│       └── untagged/
│           └── sentence_dfs/        # per-book sentence CSVs (book_name, chapter_id, entry_id, date, sentence)
└── CLS_from_162/
    ├── notebook_01_text_analysis.ipynb
    └── notebook_02_modelling.ipynb
```
---
## Linked materials
- https://docs.google.com/spreadsheets/d/1UkWaCTh-HceQEYjTebiS6Oi2fZ9cXofcTSfUPRqSASE/edit?usp=sharing 
---

## Setup

**Requirements:** Python 3.10+, conda

1. Clone the repository and navigate to the project root:
   ```bash
   git clone <repo-url>
   cd "Dear Canada"
   ```

2. Create and activate the conda environment:
   ```bash
   conda create -n dear-canada python=3.11
   conda activate dear-canada
   ```

3. Install dependencies:
   ```bash
   pip install jupyter wordcloud nltk scikit-learn sentence-transformers umap-learn matplotlib seaborn pandas numpy
   ```

4. Launch Jupyter **from the project root** (this is important — the notebooks resolve imports relative to this location):
   ```bash
   jupyter lab
   ```

5. Open either notebook from `CLS_from_162/` and run all cells.

> The sentence-transformers model (`all-MiniLM-L6-v2`, ~90 MB) downloads automatically on first run of the embedding section and is cached afterwards.

---

## Configuration

All project settings live in **`config.py`** at the project root — paths, the book registry, and stop words. You should not need to edit the notebooks or `dear_canada_utils.py` for routine changes.

**Adding a book:** add an entry to the `BOOKS` dict in `config.py`. Three templates are provided in the file covering the epub naming conventions used across the series.

**Custom stop words:** edit `CUSTOM_STOP_WORDS_GLOBAL` (applied to all books) or `CUSTOM_STOP_WORDS_PER_BOOK` (keyed by short name). The default English NLTK stop-word list is always active; custom words layer on top and can be toggled per function call with `use_custom_stop_words=False`.

**Reloading changes mid-session:** Python caches imported modules. To pick up edits to `config.py` or `dear_canada_utils.py` without restarting the kernel, run the import cell which uses `importlib.reload()` — both notebooks include this by default.

---

## Sharing a standalone notebook

To share a single notebook with someone who does not have the project files:

```bash
python make_standalone.py CLS_from_162/notebook_01_text_analysis.ipynb
```

This produces `notebook_01_text_analysis_standalone.ipynb` with `config.py` and `dear_canada_utils.py` inlined as code cells. The recipient needs no other files. Running the script again overwrites cleanly.

---


## Methods note

Sentiment analysis uses [VADER](https://github.com/cjhutto/vaderSentiment) (Valence Aware Dictionary and sEntiment Reasoner), which was designed for short, informal text and performs well on diary-style writing without requiring training data. Scores range from −1 (most negative) to +1 (most positive).

Character embeddings use [`all-MiniLM-L6-v2`](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) via the `sentence-transformers` library. Before embedding, first-person pronouns are replaced with each girl's name so the model can distinguish narrators across books. Book-level vectors are the mean of all sentence embeddings. Similarity is measured with cosine distance; 2-D projections use UMAP.
