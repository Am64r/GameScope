# GameScope Backend

Flask (Python 3.10) app serving a precomputed TF-IDF + hybrid SVD search engine over ~5000 games from Steam and Amazon. The entire index is built offline and loaded into memory at startup.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    scripts/build_db.py (offline)             │
│                                                              │
│  final_dataset_1.json ──► sample 5000 games ──► tokenize     │
│  (raw ~5000+ games)       by quality/genre      & stem       │
│                                                  │           │
│                           compute sentiment ◄────┘           │
│                           (VADER + Steam votes)              │
│                                    │                         │
│                     build TF-IDF + SVD artifacts             │
│               (idf, postings, norms, boosts, svd_*)          │
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

Run once offline: `python scripts/build_db.py`

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
| `search_index` | `key` (text PK), `value` (pickled blob) — stores `idf`, `postings`, `doc_norms`, `social_boost`, `review_texts`, and `svd_*` blobs |

### Step 5 — Build SVD Artifacts

`scripts/build_db.py` also computes truncated SVD over the TF-IDF matrix to support hybrid semantic ranking and explainability.

Stored keys:

| Key | Type | Description |
|-----|------|-------------|
| `svd_doc_vecs_v1` | `np.ndarray` | Document latent vectors (`N x k`) |
| `svd_term_components_v1` | `np.ndarray` | Term loading matrix (`V x k`) |
| `svd_singular_values_v1` | `np.ndarray` | Singular values |
| `svd_vocab_v1` | `list[str]` | Vocabulary aligned with SVD columns |
| `svd_doc_norms_v1` | `np.ndarray` | Precomputed norms for latent cosine |
| `svd_meta_v1` | `dict` | Build metadata and weights |

---

## Search Algorithm (`search_engine.py`)

### Startup

1. Load all 5000 game JSON objects into `self.games` list
2. Unpickle all index structures (`idf`, `postings`, `doc_norms`, `social_boost`, `review_texts`) and optional `svd_*` artifacts
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
hybrid_score = alpha × tfidf_cosine + (1 - alpha) × svd_cosine
final_score = hybrid_score × social_boost[doc_idx]
```

Top-K results selected via `heapq.nlargest`.

If SVD artifacts are missing or disabled, ranking falls back to TF-IDF-only behavior.

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

## RAG Pipeline (`llm_routes.py`)

When `SPARK_API_KEY` is set, `POST /api/rag` runs a four-step streaming pipeline:

1. **Title grounding** — a title-only TF-IDF index returns the top-N catalog titles for the raw user query. When the top cosine clears `TITLE_CANDIDATE_THRESHOLD`, those names are injected into the rewrite prompt so the LLM can preserve exact titles (e.g. "call of duty") instead of paraphrasing them into generic genre words.
2. **Query rewrite (LLM call #1)** — rewrites the request into 3–10 IR-friendly keywords. System prompt requires proper nouns / candidate titles to be preserved verbatim.
3. **Retrieval** — runs `GameSearchEngine.search()` on the concatenation of the original query and the rewrite, so original tokens (especially titles) can't be dropped by the LLM.
4. **Answer streaming (LLM call #2)** — streams a grounded recommendation over SSE, citing games from the top-K retrieved context.

### Title Index

Built in-memory at startup (not persisted to `gamescope.db`); shares the `text_utils` tokenizer with the main index.

| Structure | Type | Description |
|-----------|------|-------------|
| `title_idf` | `dict[str, float]` | Smoothed IDF over name tokens only |
| `title_postings` | `dict[str, list[tuple[int, float]]]` | Term → (doc_index, weight) over titles |
| `title_doc_norms` | `list[float]` | L2 norm per title |

`search_titles(query, limit)` ranks candidates by `title_cosine × social_boost` (popular franchise entries surface first) and returns raw cosine as `score` so callers can gate on a semantic threshold.

### Environment Knobs

| Var | Default | Purpose |
|-----|---------|---------|
| `SPARK_API_KEY` | — | Enables `/api/rag` and LLM calls |
| `TITLE_CANDIDATE_LIMIT` | 20 | Max candidates injected into rewrite prompt |
| `TITLE_CANDIDATE_THRESHOLD` | 0.15 | Min top-candidate cosine to trigger injection |

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
| `svd_doc_vecs_v1` | `np.ndarray` | Doc latent vectors |
| `svd_term_components_v1` | `np.ndarray` | Term-to-component loadings |
| `svd_singular_values_v1` | `np.ndarray` | Singular values |
| `svd_vocab_v1` | `list[str]` | SVD vocabulary mapping |
| `svd_doc_norms_v1` | `np.ndarray` | Doc latent norms |
| `svd_meta_v1` | `dict` | SVD metadata |

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
