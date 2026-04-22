import argparse
import json
import math
import os
import pickle
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

_text_utils_loaded = False
_bigrams = None
_clean_text = None
_tokenize = None


def ensure_text_utils():
    global _text_utils_loaded, _bigrams, _clean_text, _tokenize
    if _text_utils_loaded:
        return
    from src.text_utils import bigrams as _bg, clean_text as _ct, tokenize as _tk
    _bigrams = _bg
    _clean_text = _ct
    _tokenize = _tk
    _text_utils_loaded = True


NAME_WEIGHT = 3.0
TAG_GENRE_WEIGHT = 2.0
DESC_WEIGHT = 1.5
REVIEW_WEIGHT = 1.0
BIGRAM_WEIGHT = 1.5
SOCIAL_BOOST_FACTOR = 0.15
MIN_DF = 2


def load_games(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT idx, data FROM games ORDER BY idx").fetchall()
    return [json.loads(row[1]) for row in rows]


def tokens_from_text(value: str) -> list[str]:
    ensure_text_utils()
    return _tokenize(_clean_text(value))


def update_counter(counter: Counter, tokens: list[str], weight: float) -> None:
    if not tokens:
        return
    for t in tokens:
        counter[t] += weight
    ensure_text_utils()
    for bg in _bigrams(tokens):
        counter[bg] += BIGRAM_WEIGHT


def extract_reviews(game: dict) -> list[str]:
    reviews = []
    for r in game.get("steam_reviews") or []:
        ensure_text_utils()
        text = _clean_text(r.get("review", ""))
        if text:
            reviews.append(text)
    for r in game.get("amazon_reviews") or []:
        ensure_text_utils()
        text = _clean_text(r.get("review", ""))
        if text:
            reviews.append(text)
    return reviews


def social_boost_for_game(game: dict) -> float:
    steam_reviews = game.get("steam_reviews") or []
    amazon_reviews = game.get("amazon_reviews") or []
    total_reviews = len(steam_reviews) + len(amazon_reviews)
    sentiment = game.get("computed_sentiment")
    if sentiment is None:
        positive = game.get("positive") or 0
        negative = game.get("negative") or 0
        sentiment = positive / max(1, positive + negative)
    popularity = min(math.log(1 + total_reviews) / math.log(1 + 100000), 1.0)
    raw = 0.7 * float(sentiment) + 0.3 * popularity
    return 1.0 + SOCIAL_BOOST_FACTOR * (raw - 0.5)


def build_tfidf(games: list[dict], min_df: int) -> tuple:
    import numpy as np
    from scipy.sparse import csr_matrix

    doc_counters: list[Counter] = []
    review_texts: list[list[str]] = []
    social_boost: list[float] = []
    df = Counter()

    for game in games:
        counter = Counter()
        update_counter(counter, tokens_from_text(game.get("name", "")), NAME_WEIGHT)
        update_counter(counter, tokens_from_text(game.get("description", "")), DESC_WEIGHT)
        update_counter(counter, [t.lower() for t in (game.get("genres") or [])], TAG_GENRE_WEIGHT)
        update_counter(counter, [t.lower() for t in (game.get("tags") or {}).keys()], TAG_GENRE_WEIGHT)

        game_reviews = extract_reviews(game)
        review_texts.append(game_reviews)
        for review in game_reviews:
            update_counter(counter, tokens_from_text(review), REVIEW_WEIGHT)

        for term in counter.keys():
            df[term] += 1
        doc_counters.append(counter)
        social_boost.append(social_boost_for_game(game))

    vocab_terms = sorted([term for term, term_df in df.items() if term_df >= min_df])
    vocab_index = {term: i for i, term in enumerate(vocab_terms)}

    N = len(games)
    idf = {
        term: math.log((1 + N) / (1 + df[term])) + 1.0
        for term in vocab_terms
    }

    postings = defaultdict(list)
    doc_norms = []
    data = []
    rows = []
    cols = []

    for doc_idx, counter in enumerate(doc_counters):
        norm_sq = 0.0
        for term, weighted_count in counter.items():
            if term not in idf:
                continue
            weight = (1.0 + math.log(weighted_count)) * idf[term]
            postings[term].append((doc_idx, weight))
            norm_sq += weight * weight
            rows.append(doc_idx)
            cols.append(vocab_index[term])
            data.append(weight)
        doc_norms.append(math.sqrt(norm_sq) if norm_sq > 0 else 1.0)

    matrix = csr_matrix((np.array(data), (np.array(rows), np.array(cols))), shape=(len(games), len(vocab_terms)))
    return idf, dict(postings), doc_norms, social_boost, review_texts, vocab_terms, matrix


def build_svd(matrix, k: int):
    import numpy as np
    from scipy.sparse.linalg import svds

    n_docs, n_terms = matrix.shape
    max_k = max(2, min(n_docs - 1, n_terms - 1))
    k = min(k, max_k)
    u, s, vt = svds(matrix, k=k, which="LM")
    order = np.argsort(-s)
    s = s[order]
    u = u[:, order]
    vt = vt[order, :]
    doc_vecs = u * s
    doc_norms = np.linalg.norm(doc_vecs, axis=1)
    doc_norms[doc_norms == 0] = 1.0
    term_components = vt.T
    return doc_vecs.astype(np.float32), term_components.astype(np.float32), s.astype(np.float32), doc_norms.astype(np.float32)


def write_blob(conn: sqlite3.Connection, key: str, value) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO search_index(key, value) VALUES(?, ?)",
        (key, pickle.dumps(value, protocol=pickle.HIGHEST_PROTOCOL)),
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=os.path.join("src", "db", "gamescope.db"))
    parser.add_argument("--svd-k", type=int, default=96)
    parser.add_argument("--min-df", type=int, default=MIN_DF)
    args = parser.parse_args()

    db_dir = os.path.dirname(args.db)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(args.db)
    games = load_games(conn)
    if not games:
        raise RuntimeError("No games found in database.")

    idf, postings, doc_norms, social_boost, review_texts, vocab_terms, matrix = build_tfidf(games, args.min_df)
    doc_vecs, term_components, singular_values, svd_doc_norms = build_svd(matrix, args.svd_k)

    write_blob(conn, "idf", idf)
    write_blob(conn, "postings", postings)
    write_blob(conn, "doc_norms", doc_norms)
    write_blob(conn, "social_boost", social_boost)
    write_blob(conn, "review_texts", review_texts)

    write_blob(conn, "svd_doc_vecs_v1", doc_vecs)
    write_blob(conn, "svd_term_components_v1", term_components)
    write_blob(conn, "svd_singular_values_v1", singular_values)
    write_blob(conn, "svd_vocab_v1", vocab_terms)
    write_blob(conn, "svd_doc_norms_v1", svd_doc_norms)
    write_blob(
        conn,
        "svd_meta_v1",
        {
            "k": int(len(singular_values)),
            "min_df": args.min_df,
            "built_at": datetime.now(timezone.utc).isoformat(),
            "weights": {
                "name": NAME_WEIGHT,
                "tag_genre": TAG_GENRE_WEIGHT,
                "description": DESC_WEIGHT,
                "review": REVIEW_WEIGHT,
                "bigram": BIGRAM_WEIGHT,
            },
        },
    )
    conn.commit()
    conn.close()
    print(f"Built TF-IDF + SVD index for {len(games)} games with k={len(singular_values)}")


if __name__ == "__main__":
    main()
