"""
dear_canada_utils.py — shared analysis functions
=================================================
Import this from any notebook with:

    import sys; sys.path.insert(0, "..")
    from dear_canada_utils import *

All functions read stop-word configuration from config.py automatically.
"""

import re
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.cm as cm
import seaborn as sns
import pandas as pd
from pathlib import Path
from collections import Counter, defaultdict

from wordcloud import WordCloud
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.decomposition import LatentDirichletAllocation
from sklearn.metrics.pairwise import cosine_similarity

import nltk
nltk.download("vader_lexicon", quiet=True)
nltk.download("stopwords",    quiet=True)
nltk.download("punkt",        quiet=True)
nltk.download("punkt_tab",    quiet=True)
from nltk.corpus import stopwords as nltk_stopwords
from nltk.sentiment import SentimentIntensityAnalyzer
from nltk.tokenize import sent_tokenize

from config import (
    BOOKS,
    DB_FOLDER,
    TEXT_FILES_DIR,
    CUSTOM_STOP_WORDS_GLOBAL,
    CUSTOM_STOP_WORDS_PER_BOOK,
)


# ══════════════════════════════════════════════════════════════════════════════
# Stop words
# ══════════════════════════════════════════════════════════════════════════════

_base_stop_words = (
    set(nltk_stopwords.words("english")) | set(CUSTOM_STOP_WORDS_GLOBAL)
)


def get_stop_words(book_name=None, use_custom=True):
    """
    Return the stop-word set for a book.
    Always includes NLTK English base words.
    Custom global and per-book words are included only if use_custom=True.
    """
    if not use_custom:
        return set(nltk_stopwords.words("english"))
    return _base_stop_words | set(CUSTOM_STOP_WORDS_PER_BOOK.get(book_name, []))


# ══════════════════════════════════════════════════════════════════════════════
# Data loading
# ══════════════════════════════════════════════════════════════════════════════

def load_texts(books=None, registry=None):
    """
    Read plain-text files, strip front/back matter, split into chapters.

    Parameters
    ----------
    books    : list | None  — short names to load; None loads everything in registry
    registry : dict | None  — override the BOOKS registry from config.py

    Returns
    -------
    book_dfs : dict  {book_name: DataFrame(book, chapter_id, text)}
    data     : dict  {"BookName - chapterID": text}
    """
    reg = registry or BOOKS
    targets = books or list(reg.keys())

    book_dfs = {}
    data     = {}

    for book_name in targets:
        if book_name not in reg:
            print(f"[WARNING] '{book_name}' not in registry, skipping.")
            continue
        info = reg[book_name]
        path = Path(info["file"])
        if not path.exists():
            print(f"[WARNING] File not found, skipping: {path}")
            continue

        raw_text = path.read_text(encoding="utf-8")
        start = raw_text.find(info["start_marker"])
        end   = raw_text.find(info["end_marker"])
        if start == -1:
            print(f"[WARNING] start_marker not found in {book_name}, skipping.")
            continue
        if end == -1:
            print(f"[WARNING] end_marker not found in {book_name}; using end of file.")
            end = len(raw_text)
        diary_text = raw_text[start:end]

        sections = re.split(info["chapter_pattern"], diary_text)
        chapters = []
        for i in range(1, len(sections), 2):
            chapter_id = sections[i]
            text = sections[i + 1].strip() if i + 1 < len(sections) else ""
            chapters.append({"book": book_name, "chapter_id": chapter_id, "text": text})
            data[f"{book_name} - {chapter_id}"] = text

        book_dfs[book_name] = pd.DataFrame(chapters)
        print(f"OK  {book_name}: {len(chapters)} chapters loaded.")

    print(f"\nTotal chapters across all books: {len(data)}")
    return book_dfs, data


def load_db(books=None, db_folder=None):
    """
    Concatenate all per-book sentence CSVs into a single DataFrame.

    Parameters
    ----------
    books     : list | None  — filter to these book names (by CSV filename stem);
                               None loads all CSVs in the folder
    db_folder : Path | None  — override DB_FOLDER from config.py

    Returns
    -------
    db : DataFrame with columns book_name, chapter_id, entry_id, date, sentence
    """
    folder    = Path(db_folder or DB_FOLDER)
    csv_files = sorted(folder.glob("*.csv"))
    if books:
        csv_files = [f for f in csv_files if f.stem in books]
    if not csv_files:
        raise FileNotFoundError(
            f"No CSV files found in {folder.resolve()}. Check DB_FOLDER in config.py."
        )

    frames = []
    for f in csv_files:
        df = pd.read_csv(f)
        df.columns = df.columns.str.strip().str.lower()
        frames.append(df)
        print(f"  Loaded {len(df):,} rows from {f.name}")

    db = pd.concat(frames, ignore_index=True)

    expected = {"book_name", "chapter_id", "entry_id", "date", "sentence"}
    missing  = expected - set(db.columns)
    if missing:
        raise ValueError(f"CSV files are missing expected columns: {missing}")

    print(f"\nCombined DB: {len(db):,} rows | "
          f"{db['book_name'].nunique()} book(s): {sorted(db['book_name'].unique())} | "
          f"{db['entry_id'].nunique()} unique entries")
    return db


# ══════════════════════════════════════════════════════════════════════════════
# Text cleaning
# ══════════════════════════════════════════════════════════════════════════════


def clean_text(text, book_name=None, use_custom_stop_words=True):
    """Strip digits, punctuation, and (optionally) stop words (global + per-book)."""
    sw = get_stop_words(book_name, use_custom=use_custom_stop_words)
    text = re.sub(r"\d+", "", text)
    text = re.sub(r"[^\w\s]", "", text)
    return " ".join(w.lower() for w in text.split() if w.lower() not in sw)


# ══════════════════════════════════════════════════════════════════════════════
# Word clouds
# ══════════════════════════════════════════════════════════════════════════════

def generate_word_cloud(text, label, book_name=None, use_custom_stop_words=True):
    """
    Display a word cloud for `text`.

    Parameters
    ----------
    text      : str
    label     : str   — plot title
    book_name : str   — if given, applies per-book stop words
    use_stop_words : bool — whether to apply stop-word removal (default: True)
    """
    sw = get_stop_words(book_name, use_custom=use_custom_stop_words)
    wc = WordCloud(
        width=800, height=400, background_color="white",
        max_words=200, contour_width=1, contour_color="steelblue",
        stopwords=sw,
    ).generate(text or "empty")
    plt.figure(figsize=(10, 5))
    plt.imshow(wc, interpolation="bilinear")
    plt.title(label)
    plt.axis("off")
    plt.tight_layout()
    plt.show()


def word_clouds_for_book(book_name, book_dfs):
    """Generate one word cloud per chapter for a single book."""
    if book_name not in book_dfs:
        print(f"[WARNING] '{book_name}' not loaded.")
        return
    for _, row in book_dfs[book_name].iterrows():
        label = f"{book_name} — chapter {row['chapter_id']}"
        generate_word_cloud(row["text"], label=label, book_name=book_name)


# ══════════════════════════════════════════════════════════════════════════════
# Word frequency over chapters
# ══════════════════════════════════════════════════════════════════════════════

def plot_word_frequency(corpus, words, title="Word Frequency Over Chapters"):
    """
    Track word frequencies across chapters in narrative order.

    Parameters
    ----------
    corpus : dict  — {"BookName - chID": text}
    words  : list  — words to track
    title  : str
    """
    keys  = list(corpus.keys())
    freqs = {w: [] for w in words}
    for text in corpus.values():
        counts = Counter(re.findall(r"\b\w+\b", text.lower()))
        for w in words:
            freqs[w].append(counts.get(w.lower(), 0))

    plt.figure(figsize=(max(12, len(keys) * 0.4), 5))
    for w, f in freqs.items():
        plt.plot(range(len(keys)), f, label=w, marker="o", markersize=3)
    plt.title(title)
    plt.xlabel("Chapter (narrative order)")
    plt.ylabel("Raw word count")
    plt.xticks(ticks=range(len(keys)), labels=keys, rotation=90, fontsize=7)
    plt.legend()
    plt.tight_layout()
    plt.grid(True, alpha=0.3)
    plt.show()


# ══════════════════════════════════════════════════════════════════════════════
# Bigrams
# ══════════════════════════════════════════════════════════════════════════════

def top_ngrams(book_name, book_dfs, n=20, ngram=2, use_custom_stop_words=True):
    """
    Print the top-n ngrams for a book after stop-word removal.

    Parameters
    ----------
    book_name : str
    book_dfs  : dict
    n         : int        — how many results to show
    ngram     : 1 | 2 | 3  — unigrams, bigrams, or trigrams
    use_stop_words : bool  — whether to apply stop-word removal (default: True)
    """
    if book_name not in book_dfs:
        print(f"[WARNING] '{book_name}' not in book_dfs.")
        return
    if ngram not in (1, 2, 3):
        raise ValueError("ngram must be 1, 2, or 3")

    sw = get_stop_words(book_name, use_custom=use_custom_stop_words)
    all_text = " ".join(book_dfs[book_name]["text"].tolist()).lower()
    tokens   = [t for t in re.findall(r"\b[a-z]{3,}\b", all_text) if t not in sw]
    grams    = [
        " ".join(tokens[i : i + ngram])
        for i in range(len(tokens) - ngram + 1)
    ]

    label = {1: "unigrams", 2: "bigrams", 3: "trigrams"}[ngram]
    print(f"Top {n} {label} in '{book_name}' ({'no stop words' if not use_custom_stop_words else 'stop words applied'}):")
    for gram, count in Counter(grams).most_common(n):
        print(f"  {count:>5}  {gram}")


# ══════════════════════════════════════════════════════════════════════════════
# Keyword-in-context
# ══════════════════════════════════════════════════════════════════════════════

def keyword_in_context(keyword, db, book_name=None, max_results=30):
    """
    Print every sentence containing `keyword`.

    Parameters
    ----------
    keyword     : str
    db          : DataFrame  — the combined sentence database
    book_name   : str | None — restrict to one book, or None for all
    max_results : int
    """
    frame = db if book_name is None else db[db["book_name"] == book_name]
    hits  = frame[frame["sentence"].str.contains(keyword, case=False, na=False)]
    print(f"Found {len(hits)} sentence(s) containing '{keyword}'"
          + (f" in {book_name}" if book_name else "") + ".")
    for _, row in hits.head(max_results).iterrows():
        print(f"\n  [{row['book_name']} / {row['entry_id']}]")
        print(f"  {row['sentence'].strip()}")


# ══════════════════════════════════════════════════════════════════════════════
# Sentiment analysis
# ══════════════════════════════════════════════════════════════════════════════

_sia = SentimentIntensityAnalyzer()


def score_sentiment(db, books_to_plot=None, group_by="entry"):
    """
    Score every sentence with VADER, aggregate, then plot trajectories
    and a cross-book bar chart.

    Parameters
    ----------
    db            : DataFrame  — the combined sentence database
    books_to_plot : list | None
    group_by      : "entry" or "chapter"
        "entry"   — aggregate to diary-entry level (finer, default)
        "chapter" — aggregate to chapter level (broader)

    Returns
    -------
    aggregated : DataFrame aggregated to the chosen level
    """
    if group_by not in ("entry", "chapter"):
        raise ValueError("group_by must be 'entry' or 'chapter'")

    df     = db.copy()
    scores = df["sentence"].apply(_sia.polarity_scores)
    df     = df.join(pd.DataFrame(scores.tolist()))

    group_cols = (
        ["book_name", "chapter_id", "entry_id"]
        if group_by == "entry"
        else ["book_name", "chapter_id"]
    )

    aggregated = (
        df.groupby(group_cols, sort=False)
        .agg(
            date=(          "date",     "first"),
            mean_compound=( "compound", "mean"),
            mean_pos=(      "pos",      "mean"),
            mean_neg=(      "neg",      "mean"),
            sentence_count=("sentence", "count"),
        )
        .reset_index()
    )

    # Label for x-axis ticks — chapter_id when grouping by chapter
    label_col = "chapter_id" if group_by == "chapter" else "date"

    target_books = books_to_plot or sorted(aggregated["book_name"].unique())

    for book in target_books:
        subset = aggregated[aggregated["book_name"] == book].reset_index(drop=True)
        if subset.empty:
            print(f"[WARNING] No entries found for {book!r}")
            continue
        xs     = range(len(subset))
        labels = subset[label_col].fillna(subset.get("entry_id", subset["chapter_id"]).astype(str))

        plt.figure(figsize=(max(12, len(subset) * 0.4), 4))
        plt.plot(xs, subset["mean_compound"], color="purple", linewidth=2,
                 marker="o", markersize=3, label="Compound (mean)")
        plt.plot(xs, subset["mean_pos"],      color="green",  linewidth=1,
                 alpha=0.7, label="Positive (mean)")
        plt.plot(xs, subset["mean_neg"],      color="red",    linewidth=1,
                 alpha=0.7, label="Negative (mean)")
        plt.axhline(0, color="grey", linestyle="--", linewidth=0.8)
        plt.title(f"Sentiment trajectory — {book} (by {group_by})")
        plt.xlabel(group_by.capitalize())
        plt.ylabel("Mean VADER compound score")
        plt.ylim(-1.05, 1.05)
        plt.xticks(ticks=xs, labels=labels, rotation=90, fontsize=7)
        plt.legend()
        plt.tight_layout()
        plt.grid(True, alpha=0.3)
        plt.show()

    # Cross-book bar chart
    book_means = (
        aggregated[aggregated["book_name"].isin(target_books)]
        .groupby("book_name")["mean_compound"]
        .mean()
    )
    colors = ["steelblue" if v >= 0 else "salmon" for v in book_means.values]
    plt.figure(figsize=(max(6, len(book_means) * 1.8), 5))
    plt.bar(book_means.index, book_means.values, color=colors)
    plt.axhline(0, color="grey", linestyle="--", linewidth=0.8)
    plt.xlabel("Book")
    plt.ylabel("Mean compound sentiment score")
    plt.title(f"Overall sentiment — comparison across books (by {group_by})")
    plt.xticks(rotation=30, ha="right")
    plt.tight_layout()
    plt.show()

    return aggregated


# ══════════════════════════════════════════════════════════════════════════════
# LDA topic modelling
# ══════════════════════════════════════════════════════════════════════════════

def run_lda(data, n_topics=5, n_top_words=15, book_filter=None, use_custom_stop_words=True):
    """
    Fit LDA on the chapter corpus and display:
      1. Word-cloud grid — top words per topic
      2. One heatmap per book — chapter × topic distribution

    Parameters
    ----------
    data        : dict   — {"BookName - chID": text}
    n_topics    : int
    n_top_words : int
    book_filter : list | None — restrict to these book names
    use_stop_words : bool     — whether to apply stop-word removal (default: True)

    Returns
    -------
    lda, vectorizer, doc_topic_dist, doc_labels
    """
    if not data:
        print("No data loaded yet.")
        return

    corpus_items = (
        {k: v for k, v in data.items() if k.split(" - ")[0] in book_filter}
        if book_filter else data
    )
    doc_labels = list(corpus_items.keys())
    documents  = list(corpus_items.values())

    sw = list(get_stop_words(use_custom=use_custom_stop_words))


    vectorizer = CountVectorizer(
        stop_words=sw, max_df=0.95, min_df=2, ngram_range=(1, 2)
    )
    dtm           = vectorizer.fit_transform(documents)
    feature_names = vectorizer.get_feature_names_out()
    lda           = LatentDirichletAllocation(n_components=n_topics, random_state=42)
    lda.fit(dtm)
    print(f"LDA fitted: {n_topics} topics over {len(documents)} chapters "
          f"({'no customstop words' if not use_custom_stop_words else 'stop words applied'}).")

    # Word-cloud grid
    fig, axes = plt.subplots(1, n_topics, figsize=(4 * n_topics, 4))
    if n_topics == 1:
        axes = [axes]
    for idx, (topic, ax) in enumerate(zip(lda.components_, axes)):
        top_words = [feature_names[i] for i in topic.argsort()[:-n_top_words - 1:-1]]
        wc = WordCloud(
            background_color="white", max_words=n_top_words, contour_color="black"
        ).generate(" ".join(top_words))
        ax.imshow(wc, interpolation="bilinear")
        ax.set_title(f"Topic {idx + 1}")
        ax.axis("off")
    plt.suptitle("Top words per LDA topic", y=1.02)
    plt.tight_layout()
    plt.show()

    # Per-book heatmaps
    doc_topic_dist = lda.transform(dtm)
    book_indices   = defaultdict(list)
    for i, label in enumerate(doc_labels):
        book_indices[label.split(" - ")[0]].append(i)

    for book_name, idxs in book_indices.items():
        sub_dist   = doc_topic_dist[idxs]
        sub_labels = [doc_labels[i] for i in idxs]
        plt.figure(figsize=(max(6, n_topics * 1.5), max(4, len(sub_labels) * 0.35)))
        sns.heatmap(
            sub_dist,
            cmap="Blues",
            xticklabels=[f"Topic {i+1}" for i in range(n_topics)],
            yticklabels=sub_labels,
            cbar=True, vmin=0, vmax=1,
        )
        plt.xlabel("Topics")
        plt.ylabel("Chapters")
        plt.title(f"Topic distribution — {book_name}")
        plt.tight_layout()
        plt.show()

    return lda, vectorizer, doc_topic_dist, doc_labels

# ══════════════════════════════════════════════════════════════════════════════
# Vector embeddings
# ══════════════════════════════════════════════════════════════════════════════

_FIRST_PERSON = re.compile(
    r"\b(I|me|my|myself|mine|I'm|I've|I'll|I'd)\b", re.IGNORECASE
)


def substitute_pronouns(text, girl_name):
    """
    Replace English first-person pronouns with the girl's name.
    Sentence-initial matches are capitalised; mid-sentence ones are lowercase.
    """
    def _replace(match):
        start     = match.start()
        preceding = text[max(0, start - 2):start]
        if not preceding.strip() or preceding.strip().endswith("."):
            return girl_name.capitalize()
        return girl_name.lower()
    return _FIRST_PERSON.sub(_replace, text)


def build_embedding_corpus(book_dfs, registry=None, skip_books=None):
    """
    Apply pronoun substitution to every book's full text.

    Parameters
    ----------
    book_dfs    : dict         — from load_texts()
    registry    : dict | None  — defaults to BOOKS from config.py
    skip_books  : list | None  — book names to exclude

    Returns
    -------
    substituted_texts : dict  {book_name: full text with pronouns replaced}
    """
    reg        = registry or BOOKS
    skip       = set(skip_books or [])
    result     = {}
    for book_name, info in reg.items():
        if book_name in skip or book_name not in book_dfs:
            if book_name not in book_dfs:
                print(f"[SKIP] {book_name} — text not loaded.")
            continue
        girl      = info.get("girl_name", book_name)
        full_text = " ".join(book_dfs[book_name]["text"].tolist())
        result[book_name] = substitute_pronouns(full_text, girl)
        print(f"OK  {book_name} ({girl}): pronouns substituted.")
    return result


def generate_embeddings(substituted_texts, model_name="all-MiniLM-L6-v2"):
    """
    Encode each book's text with sentence-transformers, mean-pool to a
    single book-level vector.

    Parameters
    ----------
    substituted_texts : dict  — from build_embedding_corpus()
    model_name        : str   — any sentence-transformers model name

    Returns
    -------
    book_embeddings   : dict  {book_name: 384-d mean vector}
    sentence_emb_data : dict  {book_name: (sentences_list, embedding_matrix)}
    """
    from sentence_transformers import SentenceTransformer
    print(f"Loading model: {model_name} …")
    model = SentenceTransformer(model_name)
    print("Model loaded.\n")

    book_embeddings   = {}
    sentence_emb_data = {}

    for book_name, text in substituted_texts.items():
        sentences = [s.strip() for s in sent_tokenize(text) if len(s.split()) >= 4]
        print(f"  {book_name}: encoding {len(sentences):,} sentences …", end=" ")
        emb_matrix = model.encode(
            sentences, batch_size=64, show_progress_bar=False, convert_to_numpy=True
        )
        book_embeddings[book_name]   = emb_matrix.mean(axis=0)
        sentence_emb_data[book_name] = (sentences, emb_matrix)
        print(f"done. Shape: {emb_matrix.shape}")

    return book_embeddings, sentence_emb_data


def plot_similarity_matrix(book_embeddings):
    """Cosine similarity heatmap across all books."""
    names      = list(book_embeddings.keys())
    matrix     = np.vstack([book_embeddings[b] for b in names])
    sim_matrix = cosine_similarity(matrix)

    plt.figure(figsize=(max(6, len(names) * 1.2), max(5, len(names))))
    sns.heatmap(
        sim_matrix, annot=True, fmt=".3f",
        xticklabels=names, yticklabels=names,
        cmap="coolwarm", vmin=0, vmax=1,
        square=True, linewidths=0.5,
    )
    plt.title("Cosine similarity between character embeddings\n"
              "(1 = identical voice, 0 = no overlap)")
    plt.tight_layout()
    plt.show()

    print("Most similar pairs:")
    pairs = [
        (sim_matrix[i, j], names[i], names[j])
        for i in range(len(names))
        for j in range(i + 1, len(names))
    ]
    for score, a, b in sorted(pairs, reverse=True)[:5]:
        print(f"  {a} ↔ {b}: {score:.4f}")


def plot_umap(sentence_emb_data, n_neighbors=15, min_dist=0.1):
    """
    2-D UMAP projection of all sentence embeddings, coloured by book.
    Stars mark each book's centroid.

    Parameters
    ----------
    sentence_emb_data : dict  — from generate_embeddings()
    n_neighbors       : int   — UMAP neighbourhood size
    min_dist          : float — UMAP minimum distance
    """
    import umap

    all_vecs, all_labels = [], []
    for book_name, (sentences, emb) in sentence_emb_data.items():
        all_vecs.append(emb)
        all_labels.extend([book_name] * len(sentences))
    all_vecs = np.vstack(all_vecs)

    print(f"Fitting UMAP on {all_vecs.shape[0]:,} vectors …")
    reducer      = umap.UMAP(n_neighbors=n_neighbors, min_dist=min_dist, random_state=42)
    embedding_2d = reducer.fit_transform(all_vecs)
    print("Done.")

    label_series  = pd.Series(all_labels)
    unique_books  = label_series.unique()
    palette       = cm.get_cmap("tab10", len(unique_books))
    color_map     = {b: palette(i) for i, b in enumerate(unique_books)}

    plt.figure(figsize=(11, 8))
    for book_name in unique_books:
        mask = label_series == book_name
        plt.scatter(
            embedding_2d[mask, 0], embedding_2d[mask, 1],
            label=book_name, s=4, alpha=0.5, color=color_map[book_name],
        )
    for book_name in unique_books:
        mask   = label_series == book_name
        cx, cy = embedding_2d[mask, 0].mean(), embedding_2d[mask, 1].mean()
        plt.scatter(cx, cy, marker="*", s=300, color=color_map[book_name],
                    edgecolors="black", linewidth=0.5, zorder=5)
        plt.annotate(book_name, (cx, cy), textcoords="offset points",
                     xytext=(6, 4), fontsize=10, fontweight="bold")

    plt.legend(markerscale=4, fontsize=9, title="Book")
    plt.title("UMAP of sentence embeddings — character voices\n"
              "(★ = book centroid; proximity = semantic similarity)")
    plt.xlabel("UMAP dimension 1")
    plt.ylabel("UMAP dimension 2")
    plt.tight_layout()
    plt.show()


def find_similar_sentences(query, sentence_emb_data, model_name="all-MiniLM-L6-v2",
                           exclude_book=None, top_k=10):
    """
    Find the most semantically similar sentences to `query` across all books.

    Parameters
    ----------
    query             : str
    sentence_emb_data : dict  — from generate_embeddings()
    model_name        : str   — must match the model used to generate embeddings
    exclude_book      : str | None
    top_k             : int
    """
    from sentence_transformers import SentenceTransformer
    model     = SentenceTransformer(model_name)
    query_vec = model.encode([query], convert_to_numpy=True)

    results = []
    for book_name, (sentences, emb) in sentence_emb_data.items():
        if book_name == exclude_book:
            continue
        sims    = cosine_similarity(query_vec, emb)[0]
        top_idx = sims.argsort()[::-1][:top_k]
        for idx in top_idx:
            results.append((sims[idx], book_name, sentences[idx]))

    results.sort(reverse=True)
    print(f'Query: "{query}"\n')
    print(f"Top {top_k} most similar sentences:\n")
    for rank, (score, book, sent) in enumerate(results[:top_k], 1):
        print(f"  {rank:>2}. [{book}] (sim={score:.4f})")
        print(f"      {sent.strip()}\n")
