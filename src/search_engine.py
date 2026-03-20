"""
TF-IDF search engine — loads prebuilt index from gamescope.db.

No indexing on startup. Run build_db.py once to generate the database.
"""

import json
import logging
import math
import os
import pickle
import sqlite3
from collections import Counter, defaultdict
from heapq import nlargest
from typing import Dict, List, Optional, Tuple

from text_utils import clean_text, tokenize, bigrams

logger = logging.getLogger(__name__)

SOCIAL_BOOST_FACTOR = 0.15
SNIPPETS_PER_GAME = 3
SIMILAR_GAMES_COUNT = 3

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "db", "gamescope.db")


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
    """TF-IDF search with inverted index — loads prebuilt DB, no indexing on startup."""

    def __init__(self):
        self.games: List[dict] = []
        self.idf: Dict[str, float] = {}
        self.postings: Dict[str, List[Tuple[int, float]]] = defaultdict(list)
        self.doc_norms: List[float] = []
        self.social_boost: List[float] = []
        self.review_texts: List[List[str]] = []

        self.tag_index: Dict[str, set] = defaultdict(set)
        self.genre_index: Dict[str, set] = defaultdict(set)

        self._load_db()

    def _load_db(self):
        if not os.path.exists(DB_PATH):
            raise FileNotFoundError(
                f"Database not found at {DB_PATH}. Run 'python build_db.py' first."
            )

        logger.info("Loading database from %s", DB_PATH)
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

        conn.close()

        # Build tag/genre indices (fast, in-memory)
        self._build_tag_genre_indices()
        logger.info("Search engine ready (%d terms in vocabulary)", len(self.idf))

    def _build_tag_genre_indices(self):
        for i, game in enumerate(self.games):
            for tag in (game.get("tags") or {}):
                self.tag_index[tag.lower()].add(i)
            for genre in game.get("genres") or []:
                self.genre_index[genre.lower()].add(i)

    def search(self, query: str, limit: int = 60) -> dict:
        tokens = tokenize(clean_text(query))
        if not tokens:
            return {"results": [], "process": None}

        query_bigrams = bigrams(tokens)
        query_counts = Counter(tokens + query_bigrams)
        N = len(self.games)

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

        scores = [0.0] * N
        touched = []
        for term, qw in query_weights.items():
            for doc_idx, doc_weight in self.postings.get(term, []):
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
            return cosine * self.social_boost[doc_idx]

        top = nlargest(limit, touched, key=final_score)

        query_token_set = set(tokens)
        results = []
        for doc_idx in top:
            cosine = scores[doc_idx] / (query_norm * self.doc_norms[doc_idx])
            boosted = cosine * self.social_boost[doc_idx]
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
                "score": round(boosted, 6),
                "review_snippets": snippets,
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
