"""
Routes: React app serving and game search API.

Search is an in-memory TF-IDF + cosine similarity engine over curated game
metadata AND player reviews from data/curated_games.json and data/curated_reviews.json.

Features:
- Reviews incorporated into search corpus for vibe/mood-based discovery
- Review snippet extraction to show *why* a game matched
- Social signal boosting (sentiment ratio, review volume)
- Similar game recommendations based on shared tags/genres
"""
import html
import json
import logging
import math
import os
import re
from collections import Counter, defaultdict
from typing import Dict, List, Optional, Tuple

from flask import jsonify, request, send_from_directory

# ── AI toggle ────────────────────────────────────────────────────────────────
USE_LLM = False
# USE_LLM = True
# ─────────────────────────────────────────────────────────────────────────────

logger = logging.getLogger(__name__)

TOKEN_RE = re.compile(r"[a-z0-9]+")
HTML_TAG_RE = re.compile(r"<[^>]+>")
MAX_RESULTS = 50

# Weight given to review text vs metadata in the combined document.
REVIEW_TEXT_WEIGHT = 2.0
# How much social signals affect final ranking (0 = pure TF-IDF, 1 = heavy boost).
SOCIAL_BOOST_FACTOR = 0.15
# Number of review snippets to return per game.
SNIPPETS_PER_GAME = 3
# Number of similar games to suggest per result set.
SIMILAR_GAMES_COUNT = 5


def _clean_text(value: str) -> str:
    if not value:
        return ""
    text = html.unescape(str(value))
    return HTML_TAG_RE.sub(" ", text)


def _tokenize(text: str) -> List[str]:
    return TOKEN_RE.findall(text.lower())


def _format_game_document(app_id: str, game: Dict, reviews: List[Dict]) -> Dict:
    genres = game.get("genres") or []
    tags = list((game.get("tags") or {}).keys())

    # Combine metadata fields.
    metadata_text = " ".join(
        [
            _clean_text(game.get("name", "")),
            _clean_text(game.get("short_description", "")),
            _clean_text(game.get("about_the_game", "")),
            " ".join(genres),
            " ".join(tags),
        ]
    )

    # Aggregate review text — this is what enables vibe/mood search.
    review_texts = [_clean_text(r.get("review", "")) for r in reviews]
    combined_reviews = " ".join(review_texts)

    # Weight review text by repeating it (simple but effective for TF-IDF).
    doc_text = metadata_text + (" " + combined_reviews) * int(REVIEW_TEXT_WEIGHT)

    # Compute sentiment ratio for social boosting.
    positive = game.get("positive") or 0
    negative = game.get("negative") or 0
    total_reviews = positive + negative
    sentiment_ratio = positive / total_reviews if total_reviews > 0 else 0.5

    return {
        "app_id": app_id,
        "name": game.get("name", ""),
        "short_description": game.get("short_description", ""),
        "genres": genres,
        "tags": tags,
        "price": game.get("price"),
        "positive": positive,
        "negative": negative,
        "total_reviews": total_reviews,
        "sentiment_ratio": sentiment_ratio,
        "doc_text": doc_text,
        "review_texts": review_texts,  # Keep individual reviews for snippet extraction.
    }


class GameSearchEngine:
    """TF-IDF search engine with review-based search and social signal boosting."""

    def __init__(self, documents: List[Dict]):
        self.documents = documents
        self.idf: Dict[str, float] = {}
        self.postings: Dict[str, List[Tuple[int, float]]] = defaultdict(list)
        self.doc_norms: List[float] = [0.0] * len(documents)

        # Tag/genre index for similar game lookups.
        self.tag_index: Dict[str, set] = defaultdict(set)
        self.genre_index: Dict[str, set] = defaultdict(set)

        self._build()

    def _build(self) -> None:
        if not self.documents:
            return

        doc_term_counts: List[Counter] = []
        doc_freq: Counter = Counter()

        for i, document in enumerate(self.documents):
            tokens = _tokenize(document["doc_text"])
            term_counts = Counter(tokens)
            doc_term_counts.append(term_counts)
            for term in term_counts.keys():
                doc_freq[term] += 1

            # Build tag/genre indices for similar game lookups.
            for tag in document.get("tags", []):
                self.tag_index[tag.lower()].add(i)
            for genre in document.get("genres", []):
                self.genre_index[genre.lower()].add(i)

        total_docs = len(self.documents)
        self.idf = {
            term: math.log((1 + total_docs) / (1 + df)) + 1.0
            for term, df in doc_freq.items()
        }

        for doc_index, term_counts in enumerate(doc_term_counts):
            if not term_counts:
                self.doc_norms[doc_index] = 1.0
                continue

            norm_sq = 0.0
            for term, count in term_counts.items():
                tf = 1.0 + math.log(count)
                weight = tf * self.idf.get(term, 0.0)
                self.postings[term].append((doc_index, weight))
                norm_sq += weight * weight

            self.doc_norms[doc_index] = math.sqrt(norm_sq) if norm_sq > 0 else 1.0

    def _extract_snippets(
        self, doc_index: int, query_tokens: set, limit: int = SNIPPETS_PER_GAME
    ) -> List[str]:
        """Find the most relevant review snippets for the query."""
        document = self.documents[doc_index]
        review_texts = document.get("review_texts", [])
        if not review_texts:
            return []

        scored_reviews: List[Tuple[float, str]] = []
        for review in review_texts:
            if not review.strip():
                continue
            review_tokens = set(_tokenize(review))
            overlap = len(query_tokens & review_tokens)
            if overlap > 0:
                # Score by overlap normalized by review length (prefer concise matches).
                score = overlap / (1 + math.log(1 + len(review_tokens)))
                # Truncate long reviews for snippet display.
                snippet = review[:300].strip()
                if len(review) > 300:
                    snippet += "..."
                scored_reviews.append((score, snippet))

        scored_reviews.sort(key=lambda x: x[0], reverse=True)
        return [snippet for _, snippet in scored_reviews[:limit]]

    def _compute_social_boost(self, doc_index: int) -> float:
        """Compute a social signal multiplier based on sentiment and popularity."""
        doc = self.documents[doc_index]
        sentiment = doc["sentiment_ratio"]
        total = doc["total_reviews"]

        # Log-scaled popularity (diminishing returns for massive review counts).
        popularity = math.log(1 + total) / math.log(1 + 100000)  # normalize
        popularity = min(popularity, 1.0)

        # Blend: mostly sentiment, some popularity.
        social_score = 0.7 * sentiment + 0.3 * popularity
        # Convert to a multiplier around 1.0.
        return 1.0 + SOCIAL_BOOST_FACTOR * (social_score - 0.5)

    def search(self, query: str, limit: int = 20) -> List[Dict]:
        tokens = _tokenize(_clean_text(query))
        if not tokens:
            return []

        query_counts = Counter(tokens)
        query_weights: Dict[str, float] = {}

        for term, count in query_counts.items():
            if term not in self.idf:
                continue
            tf = 1.0 + math.log(count)
            query_weights[term] = tf * self.idf[term]

        if not query_weights:
            return []

        query_norm = math.sqrt(sum(w * w for w in query_weights.values()))
        if query_norm == 0:
            return []

        dot_products: Dict[int, float] = defaultdict(float)
        for term, query_weight in query_weights.items():
            for doc_index, doc_weight in self.postings.get(term, []):
                dot_products[doc_index] += query_weight * doc_weight

        query_token_set = set(tokens)
        scored_results: List[Tuple[float, Dict]] = []

        for doc_index, dot_product in dot_products.items():
            denominator = query_norm * self.doc_norms[doc_index]
            if denominator == 0:
                continue
            tfidf_score = dot_product / denominator
            if tfidf_score <= 0:
                continue

            # Apply social signal boost.
            social_boost = self._compute_social_boost(doc_index)
            final_score = tfidf_score * social_boost

            document = self.documents[doc_index]
            snippets = self._extract_snippets(doc_index, query_token_set)

            scored_results.append(
                (
                    final_score,
                    {
                        "app_id": document["app_id"],
                        "name": document["name"],
                        "short_description": document["short_description"],
                        "genres": document["genres"],
                        "tags": document.get("tags", [])[:10],
                        "price": document["price"],
                        "positive": document["positive"],
                        "negative": document["negative"],
                        "review_snippets": snippets,
                        "score": round(final_score, 6),
                    },
                )
            )

        scored_results.sort(key=lambda pair: pair[0], reverse=True)
        return [result for _, result in scored_results[:limit]]

    def find_similar(
        self, app_ids: List[str], exclude_ids: set, limit: int = SIMILAR_GAMES_COUNT
    ) -> List[Dict]:
        """Find games similar to the given app_ids based on shared tags and genres."""
        if not app_ids:
            return []

        # Collect tags and genres from the source games.
        source_tags: Counter = Counter()
        source_genres: Counter = Counter()
        source_indices = set()

        app_id_to_index = {
            doc["app_id"]: i for i, doc in enumerate(self.documents)
        }

        for app_id in app_ids:
            idx = app_id_to_index.get(app_id)
            if idx is None:
                continue
            source_indices.add(idx)
            doc = self.documents[idx]
            for tag in doc.get("tags", []):
                source_tags[tag.lower()] += 1
            for genre in doc.get("genres", []):
                source_genres[genre.lower()] += 1

        # Score candidate games by tag/genre overlap.
        candidate_scores: Dict[int, float] = defaultdict(float)

        for tag, count in source_tags.items():
            for doc_idx in self.tag_index.get(tag, set()):
                if doc_idx not in source_indices:
                    candidate_scores[doc_idx] += count * 1.0  # tag weight

        for genre, count in source_genres.items():
            for doc_idx in self.genre_index.get(genre, set()):
                if doc_idx not in source_indices:
                    candidate_scores[doc_idx] += count * 2.0  # genre weight

        # Apply sentiment boost to similar games too.
        scored = []
        for doc_idx, sim_score in candidate_scores.items():
            doc = self.documents[doc_idx]
            if doc["app_id"] in exclude_ids:
                continue
            social = self._compute_social_boost(doc_idx)
            final = sim_score * social
            scored.append(
                (
                    final,
                    {
                        "app_id": doc["app_id"],
                        "name": doc["name"],
                        "short_description": doc["short_description"],
                        "genres": doc["genres"],
                        "tags": doc.get("tags", [])[:10],
                        "price": doc["price"],
                        "positive": doc["positive"],
                        "negative": doc["negative"],
                        "review_snippets": [],
                        "score": round(final, 6),
                    },
                )
            )

        scored.sort(key=lambda x: x[0], reverse=True)
        return [r for _, r in scored[:limit]]


def _load_documents() -> List[Dict]:
    current_directory = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(current_directory)
    games_file_path = os.path.join(project_root, "data", "curated_games.json")
    reviews_file_path = os.path.join(project_root, "data", "curated_reviews.json")

    with open(games_file_path, "r", encoding="utf-8") as f:
        games = json.load(f)

    # Load reviews — keyed by app_id.
    reviews_by_app: Dict[str, List[Dict]] = {}
    if os.path.exists(reviews_file_path):
        with open(reviews_file_path, "r", encoding="utf-8") as f:
            reviews_by_app = json.load(f)
        logger.info("Loaded reviews for %d games", len(reviews_by_app))
    else:
        logger.warning("Reviews file not found at %s — searching metadata only", reviews_file_path)

    documents = [
        _format_game_document(app_id, game, reviews_by_app.get(app_id, []))
        for app_id, game in games.items()
    ]
    logger.info("Loaded %d games for TF-IDF indexing (with reviews)", len(documents))
    return documents


SEARCH_ENGINE = GameSearchEngine(_load_documents())


def json_search(query: str, limit: int = 20) -> List[Dict]:
    bounded_limit = max(1, min(limit, MAX_RESULTS))
    return SEARCH_ENGINE.search(query=query, limit=bounded_limit)


def register_routes(app):
    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve(path):
        if path != "" and os.path.exists(os.path.join(app.static_folder, path)):
            return send_from_directory(app.static_folder, path)
        return send_from_directory(app.static_folder, "index.html")

    @app.route("/api/config")
    def config():
        return jsonify({"use_llm": USE_LLM})

    @app.route("/api/episodes")
    @app.route("/api/search")
    def episodes_search():
        query = request.args.get("title", "")
        limit_raw = request.args.get("limit", "20")
        try:
            limit = int(limit_raw)
        except ValueError:
            limit = 20

        results = json_search(query, limit=limit)

        # Find similar games based on the top results.
        top_ids = [r["app_id"] for r in results[:5]]
        exclude = {r["app_id"] for r in results}
        similar = SEARCH_ENGINE.find_similar(top_ids, exclude)

        return jsonify({"results": results, "similar_games": similar})

    if USE_LLM:
        from llm_routes import register_chat_route

        register_chat_route(app, json_search)
