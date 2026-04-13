"""
TF-IDF search engine — loads prebuilt index from gamescope.db.

When AUTO_BUILD_DB is enabled, missing index artifacts are rebuilt at startup.
"""

import json
import logging
import math
import os
import pickle
import re
import sqlite3
import subprocess
import sys
from collections import Counter, defaultdict
from heapq import nlargest
from typing import Dict, List, Optional, Tuple

try:
    import numpy as np
except Exception:
    np = None

from text_utils import clean_text, tokenize, bigrams

logger = logging.getLogger(__name__)

SOCIAL_BOOST_FACTOR = 0.15
SNIPPETS_PER_GAME = 3
SIMILAR_GAMES_COUNT = 3

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "db", "gamescope.db")
SVD_ALPHA = float(os.environ.get("SVD_ALPHA", "0.7"))
ENABLE_SVD_SEARCH = os.environ.get("ENABLE_SVD_SEARCH", "1").lower() not in {"0", "false", "no"}
ENABLE_SVD_EXPLAINABILITY = os.environ.get("ENABLE_SVD_EXPLAINABILITY", "1").lower() not in {"0", "false", "no"}
ENABLE_NEGATION_QUERY = os.environ.get("ENABLE_NEGATION_QUERY", "1").lower() in {"1", "true", "yes"}
NEGATION_MODE = os.environ.get("NEGATION_MODE", "soft").lower()
NEGATION_PATTERN = re.compile(r"\b(?:no|not|without)\s+([a-z0-9]+(?:\s+[a-z0-9]+)?)")
AUTO_BUILD_DB = os.environ.get("AUTO_BUILD_DB", "1").lower() not in {"0", "false", "no"}
NSFW_TAGS = {"sexual content", "nudity"}
MODULE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(MODULE_DIR)
BUILD_SCRIPT_CANDIDATES = [
    os.path.join(PROJECT_ROOT, "scripts", "build_db.py"),
    os.path.join(MODULE_DIR, "scripts", "build_db.py"),
    os.path.join(os.getcwd(), "scripts", "build_db.py"),
]
BUILD_SCRIPT_PATH = next((p for p in BUILD_SCRIPT_CANDIDATES if os.path.exists(p)), BUILD_SCRIPT_CANDIDATES[0])
BUILD_SCRIPT_CWD = os.path.dirname(os.path.dirname(BUILD_SCRIPT_PATH))
REQUIRED_INDEX_KEYS = ["idf", "postings", "doc_norms", "social_boost", "review_texts"]
REQUIRED_SVD_KEYS = [
    "svd_doc_vecs_v1",
    "svd_term_components_v1",
    "svd_singular_values_v1",
    "svd_vocab_v1",
    "svd_doc_norms_v1",
    "svd_meta_v1",
]
DEFAULT_SVD_K = int(os.environ.get("AUTO_BUILD_SVD_K", "96"))


def _safe_float(val):
    if val is None:
        return None
    if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
        return None
    return val


def _get_image_url(game: dict) -> str:
    if game.get("steam_app_id"):
        return f"https://cdn.akamai.steamstatic.com/steam/apps/{game['steam_app_id']}/header.jpg"
    imgs = game.get("image_url") or []
    return imgs[0] if imgs else "https://placehold.co/460x215/1b2838/c7d5e0?text=No+Image"


class GameSearchEngine:
    """TF-IDF/SVD search loading prebuilt index with optional auto-build."""

    def __init__(self):
        self.games: List[dict] = []
        self.idf: Dict[str, float] = {}
        self.postings: Dict[str, List[Tuple[int, float]]] = defaultdict(list)
        self.doc_norms: List[float] = []
        self.social_boost: List[float] = []
        self.review_texts: List[List[str]] = []

        self.tag_index: Dict[str, set] = defaultdict(set)
        self.genre_index: Dict[str, set] = defaultdict(set)
        self.doc_token_sets: List[set] = []

        self.svd_doc_vecs: Optional[np.ndarray] = None
        self.svd_term_components: Optional[np.ndarray] = None
        self.svd_doc_norms: Optional[np.ndarray] = None
        self.svd_vocab: List[str] = []
        self.svd_vocab_index: Dict[str, int] = {}
        self.svd_meta: Dict = {}
        self.component_top_terms: Dict[int, List[str]] = {}
        self.svd_enabled = False
        self.nsfw_docs: set = set()

        self._load_db()

    def _load_db(self):
        if not os.path.exists(DB_PATH):
            self._maybe_build_db("database file missing")
        if not os.path.exists(DB_PATH):
            raise FileNotFoundError(f"Database not found at {DB_PATH}.")

        logger.info("Loading database from %s", DB_PATH)
        conn = sqlite3.connect(DB_PATH)
        if not self._has_games_table(conn):
            conn.close()
            self._maybe_build_db("games table missing")
            conn = sqlite3.connect(DB_PATH)
        if not self._has_games_table(conn):
            conn.close()
            raise RuntimeError("Unable to load games table from database.")
        missing_keys = self._missing_required_index_keys(conn)
        if missing_keys:
            conn.close()
            self._maybe_build_db(f"missing index keys: {', '.join(missing_keys)}")
            conn = sqlite3.connect(DB_PATH)
            missing_keys = self._missing_required_index_keys(conn)
        if missing_keys:
            conn.close()
            raise RuntimeError(f"Missing required search index keys after build: {', '.join(missing_keys)}")
        needs_svd = ENABLE_SVD_SEARCH or ENABLE_SVD_EXPLAINABILITY
        if needs_svd:
            missing_svd_keys = self._missing_keys(conn, REQUIRED_SVD_KEYS)
            if missing_svd_keys:
                conn.close()
                self._maybe_build_db(
                    f"missing SVD keys: {', '.join(missing_svd_keys)}",
                    svd_k=DEFAULT_SVD_K,
                )
                conn = sqlite3.connect(DB_PATH)

        # Load games
        rows = conn.execute("SELECT idx, data FROM games ORDER BY idx").fetchall()
        self.games = [json.loads(row[1]) for row in rows]
        logger.info("Loaded %d games", len(self.games))

        # Load precomputed index
        def load_blob(key):
            row = conn.execute("SELECT value FROM search_index WHERE key = ?", (key,)).fetchone()
            if row is None:
                raise ValueError(f"Missing search index key: {key}")
            return pickle.loads(row[0])

        self.idf = load_blob("idf")
        self.postings = load_blob("postings")
        self.doc_norms = load_blob("doc_norms")
        self.social_boost = load_blob("social_boost")
        self.review_texts = load_blob("review_texts")

        try:
            self.svd_doc_vecs = load_blob("svd_doc_vecs_v1")
            self.svd_term_components = load_blob("svd_term_components_v1")
            self.svd_doc_norms = load_blob("svd_doc_norms_v1")
            self.svd_vocab = load_blob("svd_vocab_v1")
            self.svd_meta = load_blob("svd_meta_v1")
            self.svd_vocab_index = {term: i for i, term in enumerate(self.svd_vocab)}
            if (
                np is not None
                and
                isinstance(self.svd_doc_vecs, np.ndarray)
                and isinstance(self.svd_term_components, np.ndarray)
                and isinstance(self.svd_doc_norms, np.ndarray)
                and self.svd_doc_vecs.shape[0] == len(self.games)
            ):
                self.svd_enabled = True
                self._build_component_top_terms()
        except Exception:
            self.svd_enabled = False

        conn.close()

        # Build tag/genre indices (fast, in-memory)
        self._build_tag_genre_indices()
        logger.info("Search engine ready (%d terms in vocabulary)", len(self.idf))

    def _has_games_table(self, conn: sqlite3.Connection) -> bool:
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='games'"
        ).fetchone()
        if row is None:
            return False
        count_row = conn.execute("SELECT COUNT(*) FROM games").fetchone()
        return bool(count_row and count_row[0] > 0)

    def _missing_required_index_keys(self, conn: sqlite3.Connection) -> List[str]:
        return self._missing_keys(conn, REQUIRED_INDEX_KEYS)

    def _missing_keys(self, conn: sqlite3.Connection, required_keys: List[str]) -> List[str]:
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='search_index'"
        ).fetchone()
        if row is None:
            return required_keys[:]
        rows = conn.execute("SELECT key FROM search_index").fetchall()
        present = {r[0] for r in rows}
        return [k for k in required_keys if k not in present]

    def _maybe_build_db(self, reason: str, svd_k: int = DEFAULT_SVD_K) -> None:
        if not AUTO_BUILD_DB:
            return
        if not os.path.exists(BUILD_SCRIPT_PATH):
            logger.warning("Auto-build skipped; build script missing: %s", BUILD_SCRIPT_PATH)
            return
        logger.info("Auto-building search index (%s) with svd_k=%d", reason, svd_k)
        try:
            subprocess.run(
                [sys.executable, BUILD_SCRIPT_PATH, "--db", DB_PATH, "--svd-k", str(svd_k)],
                cwd=BUILD_SCRIPT_CWD,
                check=True,
            )
        except Exception as exc:
            logger.exception("Auto-build failed: %s", exc)

    def _build_tag_genre_indices(self):
        self.doc_token_sets = []
        self.nsfw_docs = set()
        for i, game in enumerate(self.games):
            for tag in (game.get("tags") or {}):
                tag_lower = tag.lower()
                self.tag_index[tag_lower].add(i)
                if tag_lower in NSFW_TAGS:
                    self.nsfw_docs.add(i)
            for genre in game.get("genres") or []:
                self.genre_index[genre.lower()].add(i)
            token_set = set(tokenize(clean_text(game.get("name", ""))))
            token_set.update(tokenize(clean_text(game.get("description", ""))))
            token_set.update(tokenize(" ".join(game.get("genres") or [])))
            token_set.update(tokenize(" ".join((game.get("tags") or {}).keys())))
            self.doc_token_sets.append(token_set)

    def _build_component_top_terms(self, top_n: int = 8):
        if self.svd_term_components is None or not self.svd_vocab:
            return
        for component_idx in range(self.svd_term_components.shape[1]):
            column = self.svd_term_components[:, component_idx]
            top_indices = np.argsort(-np.abs(column))[:top_n]
            self.component_top_terms[component_idx] = [self.svd_vocab[idx] for idx in top_indices]

    def _extract_negated_terms(self, query: str) -> set:
        matches = NEGATION_PATTERN.findall(query.lower())
        terms = set()
        for m in matches:
            toks = tokenize(m)
            terms.update(toks)
            terms.update(bigrams(toks))
        return terms

    def _doc_negation_hits(self, doc_idx: int, negated_terms: set) -> List[str]:
        if not negated_terms or doc_idx >= len(self.doc_token_sets):
            return []
        token_set = self.doc_token_sets[doc_idx]
        return sorted(list(negated_terms.intersection(token_set)))

    def _compute_svd_query_vector(self, query_counts: Counter) -> Optional[np.ndarray]:
        if np is None or not self.svd_enabled or self.svd_term_components is None:
            return None
        query_latent = np.zeros(self.svd_term_components.shape[1], dtype=np.float32)
        used = False
        for term, count in query_counts.items():
            if term not in self.svd_vocab_index:
                continue
            idf_val = self.idf.get(term, 0.0)
            if idf_val <= 0:
                continue
            weight = (1.0 + math.log(count)) * idf_val
            query_latent += weight * self.svd_term_components[self.svd_vocab_index[term]]
            used = True
        if not used:
            return None
        return query_latent

    def search(self, query: str, limit: int = 60, filter_nsfw: bool = True) -> dict:
        tokens = tokenize(clean_text(query))
        negated_terms = self._extract_negated_terms(query) if ENABLE_NEGATION_QUERY else set()
        if not tokens:
            return {"results": [], "process": None}

        if negated_terms:
            tokens = [t for t in tokens if t not in negated_terms]
        query_bigrams = bigrams(tokens)
        if negated_terms:
            query_bigrams = [b for b in query_bigrams if b not in negated_terms]
        query_counts = Counter(tokens + query_bigrams)
        N = len(self.games)

        # Pure negation query (e.g. "no combat") — use inverted SVD to find
        # games semantically opposite to the negated concept
        if not query_counts and negated_terms:
            neg_counts = Counter(negated_terms)
            neg_svd = self._compute_svd_query_vector(neg_counts)

            scored_docs: List[Tuple[float, int]] = []
            for doc_idx in range(N):
                if filter_nsfw and doc_idx in self.nsfw_docs:
                    continue
                neg_hits = self._doc_negation_hits(doc_idx, negated_terms)
                if neg_hits:
                    continue
                svd_score = 0.0
                if (
                    np is not None
                    and neg_svd is not None
                    and self.svd_doc_vecs is not None
                    and self.svd_doc_norms is not None
                ):
                    neg_svd_norm = float(np.linalg.norm(neg_svd))
                    doc_norm = float(self.svd_doc_norms[doc_idx])
                    if neg_svd_norm > 0 and doc_norm > 0:
                        # Negate: lower cosine with the negated term = higher score
                        cosine = float(np.dot(neg_svd, self.svd_doc_vecs[doc_idx])) / (
                            neg_svd_norm * doc_norm
                        )
                        svd_score = -cosine
                boost = self.social_boost[doc_idx] if doc_idx < len(self.social_boost) else 1.0
                final = ((svd_score + 1.0) / 2.0) * boost  # normalize to 0-1 range
                scored_docs.append((final, doc_idx))

            top_docs = nlargest(limit, scored_docs, key=lambda x: x[0])

            results = []
            for final, doc_idx in top_docs:
                game = self.games[doc_idx]
                top_reviews = self._get_top_reviews(game)
                tags = game.get("tags") or {}
                top_tags = sorted(tags.keys(), key=lambda t: tags[t], reverse=True)[:5]
                results.append({
                    "id": game.get("id", ""),
                    "name": game.get("name", ""),
                    "description": clean_text(game.get("description", "")),
                    "avg_rating": _safe_float(game.get("avg_rating")),
                    "image_url": _get_image_url(game),
                    "source": game.get("source", ""),
                    "genres": game.get("genres") or [],
                    "top_reviews": top_reviews,
                    "price_usd": _safe_float(game.get("price_usd")),
                    "release_date": game.get("release_date"),
                    "platform": game.get("platform") or [],
                    "sentiment": game.get("computed_sentiment", (
                        (game.get("positive") or 0)
                        / max(1, (game.get("positive") or 0) + (game.get("negative") or 0))
                    )),
                    "top_tags": top_tags,
                    "similar_ids": [],
                    "steam_app_id": game.get("steam_app_id"),
                    "steam_url": (
                        f"https://store.steampowered.com/app/{game.get('steam_app_id')}/"
                        if game.get("steam_app_id")
                        else None
                    ),
                    "score": round(final, 6),
                    "review_snippets": [],
                    "explain": {
                        "tfidf_score": 0.0,
                        "svd_score": round(final, 6),
                        "hybrid_score": round(final, 6),
                        "negation_hits": [],
                    },
                })

            return {
                "results": results,
                "process": {
                    "tokens": [{"token": t, "idf": 0.0, "df": 0, "in_vocab": False} for t in negated_terms],
                    "total_docs": N,
                    "docs_matched": len(scored_docs),
                    "docs_scored": len(results),
                    "top_genres": [],
                    "top_tags": [],
                    "svd": None,
                    "negation": {
                        "enabled": True,
                        "mode": NEGATION_MODE,
                        "terms": sorted(list(negated_terms)),
                    },
                },
            }

        query_weights: Dict[str, float] = {}
        token_info = []
        for term, count in query_counts.items():
            idf_val = self.idf.get(term, 0.0)
            df_val = len(self.postings.get(term, []))
            in_vocab = term in self.idf
            if in_vocab:
                query_weights[term] = (1.0 + math.log(count)) * idf_val
            token_info.append({
                "token": term,
                "idf": round(idf_val, 3),
                "df": df_val,
                "in_vocab": in_vocab,
            })

        if not query_weights:
            return {"results": [], "process": {
                "tokens": token_info, "total_docs": N,
                "docs_matched": 0, "docs_scored": 0,
            }}

        query_norm = math.sqrt(sum(w * w for w in query_weights.values()))
        svd_query = self._compute_svd_query_vector(query_counts) if ENABLE_SVD_SEARCH else None
        svd_query_norm = float(np.linalg.norm(svd_query)) if np is not None and svd_query is not None else 0.0

        scores = [0.0] * N
        touched = []
        for term, qw in query_weights.items():
            for doc_idx, doc_weight in self.postings.get(term, []):
                if filter_nsfw and doc_idx in self.nsfw_docs:
                    continue
                if scores[doc_idx] == 0.0:
                    touched.append(doc_idx)
                scores[doc_idx] += qw * doc_weight

        if not touched:
            return {"results": [], "process": {
                "tokens": token_info, "total_docs": N,
                "docs_matched": 0, "docs_scored": 0,
            }}

        def final_score(doc_idx):
            cosine = scores[doc_idx] / (query_norm * self.doc_norms[doc_idx])
            svd_cosine = 0.0
            if (
                svd_query is not None
                and svd_query_norm > 0
                and self.svd_doc_vecs is not None
                and self.svd_doc_norms is not None
            ):
                svd_cosine = float(np.dot(svd_query, self.svd_doc_vecs[doc_idx])) / (
                    svd_query_norm * float(self.svd_doc_norms[doc_idx])
                )
            hybrid = cosine
            if svd_query is not None:
                hybrid = SVD_ALPHA * cosine + (1.0 - SVD_ALPHA) * svd_cosine
            neg_hits = self._doc_negation_hits(doc_idx, negated_terms)
            if neg_hits:
                if NEGATION_MODE == "strict":
                    return -1.0
                hybrid *= 0.65 ** len(neg_hits)
            return hybrid * self.social_boost[doc_idx]

        top = nlargest(limit, touched, key=final_score)

        query_token_set = set(tokens)
        results = []
        for doc_idx in top:
            cosine = scores[doc_idx] / (query_norm * self.doc_norms[doc_idx])
            svd_cosine = 0.0
            if (
                svd_query is not None
                and svd_query_norm > 0
                and self.svd_doc_vecs is not None
                and self.svd_doc_norms is not None
            ):
                svd_cosine = float(np.dot(svd_query, self.svd_doc_vecs[doc_idx])) / (
                    svd_query_norm * float(self.svd_doc_norms[doc_idx])
                )
            hybrid = cosine if svd_query is None else SVD_ALPHA * cosine + (1.0 - SVD_ALPHA) * svd_cosine
            neg_hits = self._doc_negation_hits(doc_idx, negated_terms)
            if neg_hits:
                if NEGATION_MODE == "strict":
                    continue
                hybrid *= 0.65 ** len(neg_hits)
            boosted = hybrid * self.social_boost[doc_idx]
            if cosine <= 0:
                continue

            game = self.games[doc_idx]
            snippets = self._extract_snippets(doc_idx, query_token_set)
            top_reviews = self._get_top_reviews(game)

            tags = game.get("tags") or {}
            top_tags = sorted(tags.keys(), key=lambda t: tags[t], reverse=True)[:5]

            results.append({
                "id": game.get("id", ""),
                "name": game.get("name", ""),
                "description": clean_text(game.get("description", "")),
                "avg_rating": _safe_float(game.get("avg_rating")),
                "image_url": _get_image_url(game),
                "source": game.get("source", ""),
                "genres": game.get("genres") or [],
                "top_reviews": top_reviews,
                "price_usd": _safe_float(game.get("price_usd")),
                "release_date": game.get("release_date"),
                "platform": game.get("platform") or [],
                "sentiment": game.get("computed_sentiment", (
                    (game.get("positive") or 0)
                    / max(1, (game.get("positive") or 0) + (game.get("negative") or 0))
                )),
                "top_tags": top_tags,
                "similar_ids": [],
                "steam_app_id": game.get("steam_app_id"),
                "steam_url": (
                    f"https://store.steampowered.com/app/{game.get('steam_app_id')}/"
                    if game.get("steam_app_id")
                    else None
                ),
                "score": round(boosted, 6),
                "review_snippets": snippets,
                "explain": {
                    "tfidf_score": round(cosine, 6),
                    "svd_score": round(svd_cosine, 6) if svd_query is not None else None,
                    "hybrid_score": round(hybrid, 6),
                    "negation_hits": neg_hits,
                },
            })

        genre_counts: Counter = Counter()
        tag_counts: Counter = Counter()
        for r in results:
            for g in r["genres"]:
                genre_counts[g] += 1
            for t in r["top_tags"][:5]:
                tag_counts[t] += 1

        process_meta = {
            "tokens": token_info,
            "total_docs": N,
            "docs_matched": len(touched),
            "docs_scored": len(results),
            "top_genres": [{"name": g, "count": c} for g, c in genre_counts.most_common(8)],
            "top_tags": [{"name": t, "count": c} for t, c in tag_counts.most_common(12)],
            "svd": None,
            "negation": {
                "enabled": ENABLE_NEGATION_QUERY,
                "mode": NEGATION_MODE,
                "terms": sorted(list(negated_terms)),
            },
        }

        if np is not None and ENABLE_SVD_EXPLAINABILITY and svd_query is not None and self.component_top_terms:
            top_component_indices = np.argsort(-np.abs(svd_query))[:3]
            process_meta["svd"] = {
                "enabled": self.svd_enabled,
                "alpha": SVD_ALPHA,
                "components": [
                    {
                        "component": int(idx),
                        "weight": round(float(svd_query[idx]), 6),
                        "top_terms": self.component_top_terms.get(int(idx), []),
                    }
                    for idx in top_component_indices
                ],
            }

        return {"results": results, "process": process_meta}

    def _get_top_reviews(self, game: dict, limit: int = 3) -> List[dict]:
        reviews = []
        for r in sorted(
            game.get("steam_reviews") or [],
            key=lambda x: x.get("helpfulness") or 0,
            reverse=True,
        )[:limit]:
            reviews.append({
                "reviewer": r.get("user", "Anonymous"),
                "rating": None,
                "summary": "",
                "text": clean_text(r.get("review", ""))[:300],
            })
        for r in sorted(
            game.get("amazon_reviews") or [],
            key=lambda x: x.get("rating") or 0,
            reverse=True,
        )[:max(0, limit - len(reviews))]:
            reviews.append({
                "reviewer": r.get("reviewer_name", "Anonymous"),
                "rating": r.get("rating"),
                "summary": r.get("summary", ""),
                "text": clean_text(r.get("review", ""))[:300],
            })
        return reviews

    def _extract_snippets(
        self, doc_index: int, query_tokens: set, limit: int = SNIPPETS_PER_GAME
    ) -> List[str]:
        reviews = self.review_texts[doc_index]
        if not reviews:
            return []

        scored = []
        for review in reviews:
            if not review.strip():
                continue
            review_tokens = set(tokenize(review))
            overlap = len(query_tokens & review_tokens)
            if overlap > 0:
                score = overlap / (1 + math.log(1 + len(review_tokens)))
                snippet = review[:300].strip()
                if len(review) > 300:
                    snippet += "..."
                scored.append((score, snippet))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [s for _, s in scored[:limit]]

    def _find_similar_for_game(
        self, doc_index: int, exclude_ids: set, limit: int = SIMILAR_GAMES_COUNT
    ) -> List[str]:
        game = self.games[doc_index]
        source_tags = set()
        source_genres = set()
        for tag in (game.get("tags") or {}):
            source_tags.add(tag.lower())
        for genre in game.get("genres") or []:
            source_genres.add(genre.lower())

        candidate_scores: Dict[int, float] = defaultdict(float)
        for tag in source_tags:
            for idx in self.tag_index.get(tag, set()):
                if idx != doc_index:
                    candidate_scores[idx] += 1.0
        for genre in source_genres:
            for idx in self.genre_index.get(genre, set()):
                if idx != doc_index:
                    candidate_scores[idx] += 2.0

        scored = sorted(candidate_scores.items(), key=lambda x: x[1], reverse=True)
        result = []
        for idx, _ in scored:
            gid = self.games[idx].get("id", "")
            if gid not in exclude_ids:
                result.append(gid)
                if len(result) >= limit:
                    break
        return result

    def get_game_by_id(self, game_id: str) -> Optional[dict]:
        for game in self.games:
            if game.get("id") == game_id:
                return game
        return None
