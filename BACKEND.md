# GameScope Backend

Flask (Python 3.10) app serving a precomputed TF-IDF search engine over ~5000 games from Steam and Amazon. The entire index is built offline and loaded into memory at startup — no indexing at runtime.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                       build_db.py (offline)                  │
│                                                              │
│  final_dataset_1.json ──► sample 5000 games ──► tokenize     │
│  (raw ~5000+ games)       by quality/genre      & stem       │
│                                                  │           │
│                           compute sentiment ◄────┘           │
│                           (VADER + Steam votes)              │
│                                    │                         │
│                           build TF-IDF index                 │
│                           (idf, postings, norms, boosts)     │
│                                    │                         │
│                                    ▼                         │
│                             gamescope.db                     │
└──────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────┐
│                    search_engine.py (runtime)                │
│                                                              │
│  startup: load gamescope.db into memory                      │
│           unpickle index structures                          │
│           build tag/genre lookup tables                      │
│                                                              │
│  query:   tokenize ──► lookup postings ──► cosine sim        │
│           + bigrams    accumulate scores   × social boost    │
│                                            ──► top-K results │
└──────────────────────────────────────────────────────────────┘
```

---

## Text Processing Pipeline (`text_utils.py`)

Shared between index-time (`build_db.py`) and query-time (`search_engine.py`) so tokens always match.

1. **`clean_text(value)`** — unescape HTML entities, strip HTML tags
2. **`tokenize(text)`** — lowercase → extract `[a-z0-9]+` tokens → remove English stopwords (NLTK, 60+ words) → Snowball stem each token
3. **`bigrams(tokens)`** — consecutive pairs joined with `_` (e.g. `["open", "world"]` → `["open_world"]`)

Example:
```
"An amazing open-world RPG!"
  → clean:    "An amazing open-world RPG!"
  → tokenize: ["amaz", "open", "world", "rpg"]
  → bigrams:  ["amaz_open", "open_world", "world_rpg"]
```

---

## Index Building (`build_db.py`)

Run once offline: `python data/build_db.py`

### Step 1 — Sample Games

Selects 5000 games from the full dataset, balanced by source and genre:

- **Quality scoring** — each game scored by: has rating (+2), log(review count) (up to +5), has image (+1), has description (+0.5), has tags (+0.5), review count (+0.2 each, max 10)
- **Source allocation** — "both" source games taken first (up to 36), Amazon gets 25%, Steam gets the rest
- **Genre diversity** — Steam games sampled via round-robin across genres so no single genre dominates

### Step 2 — Trim & Compute Sentiment

Each game is trimmed to essential fields (description capped at 1000 chars, max 8 reviews per source, review text capped at 500 chars).

**Sentiment scoring (0–1):**

| Condition | Method |
|-----------|--------|
| ≥10 Steam reviews | `positive / (positive + negative)` |
| Has review text | VADER compound score, normalized to 0–1 |
| Both available | `0.7 × steam_sentiment + 0.3 × vader_sentiment` |
| Neither | Default `0.5` |

### Step 3 — Build TF-IDF Index

**Field weighting** — tokens from different fields carry different weights:

| Field | Weight |
|-------|--------|
| Game name | 3.0 |
| Tags & genres | 2.0 |
| Description | 1.5 |
| Bigrams | 1.5 |
| Reviews | 1.0 |

**Per-document process:**
1. Tokenize each field separately (name, description, genres, tags, reviews)
2. Build weighted term frequency counter — each token occurrence adds its field weight
3. Generate bigrams *per-field* (not across fields, to avoid spurious cross-field bigrams)
4. Record document frequency (DF) for each term

**Pruning:** Terms with DF < 2 are removed (appear in only one game — adds bulk, never helps ranking).

**IDF formula (smoothed):**
```
idf(term) = log((1 + N) / (1 + df)) + 1.0
```
where N = total docs, df = document frequency.

**Postings list:** For each term, stores `(doc_index, weight)` pairs where:
```
weight = (1 + log(weighted_count)) × idf
```

**Document norms:** L2 norm of each document's weight vector, precomputed for cosine similarity.

**Social boost factor per game:**
```
popularity = min(log(1 + total_reviews) / log(1 + 100000), 1.0)
social_boost = 1.0 + 0.15 × (0.7 × sentiment + 0.3 × popularity − 0.5)
```

This gives well-reviewed, well-liked games a small ranking boost (±~7.5% max).

### Step 4 — Write to SQLite

Everything is stored in `src/db/gamescope.db`:

| Table | Contents |
|-------|----------|
| `games` | `idx` (int PK), `id` (text, indexed), `data` (JSON blob per game) |
| `search_index` | `key` (text PK), `value` (pickled blob) — stores `idf`, `postings`, `doc_norms`, `social_boost`, `review_texts` |

---

## Search Algorithm (`search_engine.py`)

### Startup

1. Load all 5000 game JSON objects into `self.games` list
2. Unpickle all index structures (`idf`, `postings`, `doc_norms`, `social_boost`, `review_texts`)
3. Build in-memory tag and genre inverted indices (maps lowercase tag/genre → set of doc indices)

### Query Processing

Given a query string (e.g. `"open world RPG with good story"`):

```
1. clean_text(query)
2. tokenize → stemmed unigrams
3. bigrams → stemmed bigram pairs
4. Merge into query_counts (Counter of all query terms)
```

### Scoring

For each query term that exists in the vocabulary:

```
query_weight = (1 + log(term_count_in_query)) × idf(term)
```

Accumulate dot product scores across all documents:

```python
for each query term:
    for each (doc_idx, doc_weight) in postings[term]:
        scores[doc_idx] += query_weight × doc_weight
```

Final ranking:

```
cosine_similarity = dot_product / (query_norm × doc_norm)
final_score = cosine_similarity × social_boost[doc_idx]
```

Top-K results selected via `heapq.nlargest`.

### Snippet Extraction

For each result, reviews are scored by token overlap with the query:

```
snippet_score = |query_tokens ∩ review_tokens| / (1 + log(1 + |review_tokens|))
```

Top 3 scoring reviews are returned as snippets (truncated to 300 chars).

### Review Selection

Top reviews are selected independently of the query:
- Steam reviews: sorted by helpfulness score (descending)
- Amazon reviews: sorted by star rating (descending)
- Combined up to 3 total, Steam prioritized

---

## Database Schema

```sql
CREATE TABLE games (
    idx INTEGER PRIMARY KEY,
    id TEXT UNIQUE,
    data TEXT  -- JSON blob
);
CREATE INDEX idx_game_id ON games(id);

CREATE TABLE search_index (
    key TEXT PRIMARY KEY,
    value BLOB  -- pickled Python objects
);
```

**Index keys:**

| Key | Type | Description |
|-----|------|-------------|
| `idf` | `dict[str, float]` | Term → IDF score |
| `postings` | `dict[str, list[tuple[int, float]]]` | Term → list of (doc_index, weight) |
| `doc_norms` | `list[float]` | L2 norm per document |
| `social_boost` | `list[float]` | Boost multiplier per document |
| `review_texts` | `list[list[str]]` | Raw review texts per document (for snippet extraction) |

---

## Constants

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `TARGET_TOTAL` | 5000 | build_db.py | Games to index |
| `MAX_REVIEWS_PER_GAME` | 8 | build_db.py | Reviews stored per game |
| `NAME_WEIGHT` | 3.0 | build_db.py | TF weight for title tokens |
| `TAG_GENRE_WEIGHT` | 2.0 | build_db.py | TF weight for tag/genre tokens |
| `DESC_WEIGHT` | 1.5 | build_db.py | TF weight for description tokens |
| `REVIEW_WEIGHT` | 1.0 | build_db.py | TF weight for review tokens |
| `BIGRAM_WEIGHT` | 1.5 | build_db.py | TF weight for bigram tokens |
| `SOCIAL_BOOST_FACTOR` | 0.15 | both | Max ± influence of social signals |
| `MIN_DF` | 2 | build_db.py | Minimum doc frequency to keep term |
| `SNIPPETS_PER_GAME` | 3 | search_engine.py | Review snippets per result |

---

## Data Flow Summary

```
User types "open world RPG"
        │
        ▼
  tokenize + stem → ["open", "world", "rpg"] + ["open_world", "world_rpg"]
        │
        ▼
  compute query weights using IDF
        │
        ▼
  lookup each term in postings → accumulate scores per game
        │
        ▼
  normalize by doc norms → cosine similarity
        │
        ▼
  multiply by social boost (sentiment + popularity)
        │
        ▼
  take top 60 results
        │
        ▼
  for each result: extract review snippets, top reviews, top tags
        │
        ▼
  return JSON array to frontend
```
