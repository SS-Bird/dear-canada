# Place mentions, v1 prototype (2026-10-13)

Output of the first place pipeline (`Pipelines/Archived_Pipelines/v1_place_mention_pipeline.ipynb`): spaCy `en_core_web_sm`, GPE/LOC/FAC/ORG labels, Nominatim geocoding with a worldwide fallback.

Retired on 2026-10-21 because it tagged many character names as places and mapped them to unrelated places worldwide. These files were also the website's places data until then. Replaced by `data/Pipe Outputs/places/`.

- `place_mentions.csv`: one row per mention
- `unique_places.csv`: one row per distinct place string
- `geocode_cache.sqlite`: raw Nominatim responses
