# Dear Canada

Computational analysis of the *Dear Canada* diary series (20 books), and a website (the Dear Canada Atlas) to explore the results.

```
Dear Canada/
├── data/
│   ├── Book Repository/      source texts: EPubs, TextFiles, Entries as Csv (one row per diary entry)
│   ├── Gazetteers/           place databases for matching (CGNDB, CHGIS, curated lists); see its README
│   └── Pipe Outputs/         final pipeline outputs: places/, v2/, v3/ (network), topics_corpus/,
│                             Archived Versions/
├── Pipelines/
│   ├── Place Mentions/       01 extract place names + type from the text, 02 match them to geographies
│   ├── LLM network extraction/   knowledge-graph extraction with Claude (v3)
│   ├── Topic Modeling/       inter- and intra-book topic models
│   └── Archived_Pipelines/   superseded versions
├── Web/                      static site (Leaflet + D3), deployed on Vercel; see its README
└── Tangents/                 side projects and coursework (paths may be outdated since the Oct 17 reorganisation)
```

## Workflow

1. Run a pipeline notebook; it writes to `data/Pipe Outputs/`.
2. Publish to the site: `Web/data_sources.json` lists what is published; `python3 Web/scripts/sync_data.py` copies it into `Web/public/data/` (the place matching notebook does this itself).
3. Commit and push; Vercel redeploys.

## Status

- **Places**: NER-based extraction (spaCy `en_core_web_trf`) with person filtering and place-type suggestions; matching to historical overrides, CGNDB, CHGIS (data pending) and a short world list. Ready for hand annotation and fine-tuning. Details in `Pipelines/Place Mentions/README.md`.
- **Network**: v3 knowledge graph for *A Sea of Sorrows* (first half).
- **Topics**: topic models across and within books.
