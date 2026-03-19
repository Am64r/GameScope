"""
Routes: React app serving + TF-IDF IR over final_dataset.json.
"""
import json
import math
import os
import re
from collections import defaultdict
from flask import send_from_directory, request, jsonify

USE_LLM = False

# ── Load & index dataset ──────────────────────────────────────────────────────

_DATA_PATH = os.path.join(os.path.dirname(__file__), 'dataset', 'final_dataset.json')

_games = {}          # id -> raw game dict
_tfidf = {}          # term -> {id: tfidf score}
_doc_norms = {}      # id -> L2 norm of tfidf vector


def _strip_html(text: str) -> str:
    return re.sub(r'<[^>]+>', ' ', text)


def _tokenize(text: str) -> list[str]:
    return re.findall(r'[a-z0-9]+', text.lower())


def _build_index():
    global _games, _tfidf, _doc_norms
    print("Building TF-IDF index…", flush=True)
    with open(_DATA_PATH) as f:
        _games = json.load(f)

    N = len(_games)
    tf_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    df: dict[str, int] = defaultdict(int)

    for gid, g in _games.items():
        doc = ' '.join([
            g.get('name') or '',
            _strip_html(g.get('description') or ''),
            ' '.join(g.get('genres') or []),
            ' '.join((g.get('tags') or {}).keys()),
        ])
        tokens = _tokenize(doc)
        seen: set[str] = set()
        for tok in tokens:
            tf_counts[gid][tok] += 1
            if tok not in seen:
                df[tok] += 1
                seen.add(tok)

    tfidf: dict[str, dict[str, float]] = defaultdict(dict)
    norms: dict[str, float] = defaultdict(float)

    for gid, term_counts in tf_counts.items():
        total = sum(term_counts.values())
        for term, cnt in term_counts.items():
            score = (cnt / total) * math.log(N / (df[term] + 1))
            if score > 0:
                tfidf[term][gid] = score
                norms[gid] += score * score

    _tfidf = tfidf
    _doc_norms = {gid: math.sqrt(v) for gid, v in norms.items()}
    print(f"Index ready: {N} games, {len(_tfidf)} terms.", flush=True)


_build_index()


# ── Search ────────────────────────────────────────────────────────────────────

def _fmt_reviews(g: dict) -> list[dict]:
    source = g.get('source', '')
    if source == 'amazon':
        raw = sorted(
            g.get('amazon_reviews') or [],
            key=lambda r: r.get('helpful_votes', 0),
            reverse=True,
        )[:3]
        return [
            {
                'reviewer': r.get('reviewer_name', 'Anonymous'),
                'rating': r.get('rating'),
                'summary': r.get('summary', ''),
                'text': (r.get('review') or '')[:300],
            }
            for r in raw
        ]
    else:
        raw = sorted(
            g.get('steam_reviews') or [],
            key=lambda r: r.get('helpfulness', 0),
            reverse=True,
        )[:3]
        return [
            {
                'reviewer': r.get('user', 'Anonymous'),
                'rating': None,
                'summary': '',
                'text': (r.get('review') or '')[:300],
            }
            for r in raw
        ]


_TEST_IMAGE = 'https://placehold.co/200x280/2a475e/c7d5e0?text=Game'


def _sentiment(g: dict):
    pos = g.get('positive') or 0
    neg = g.get('negative') or 0
    total = pos + neg
    return round(pos / total, 2) if total > 0 else None


def _tag_overlap(a: dict, b: dict) -> int:
    ta = set((a.get('tags') or {}).keys())
    tb = set((b.get('tags') or {}).keys())
    return len(ta & tb)


def ir_search(query: str, k: int = 60) -> list[dict]:
    tokens = _tokenize(query)
    if not tokens:
        return []

    scores: dict[str, float] = defaultdict(float)
    for tok in tokens:
        for gid, score in _tfidf.get(tok, {}).items():
            scores[gid] += score

    for gid in list(scores):
        norm = _doc_norms.get(gid, 0)
        if norm > 0:
            scores[gid] /= norm
        else:
            del scores[gid]

    top_ids = sorted(scores, key=lambda x: scores[x], reverse=True)[:k]
    max_score = scores[top_ids[0]] if top_ids else 1

    results = []
    raw_result_games = []
    for gid in top_ids:
        g = _games[gid]
        imgs = g.get('image_url') or []
        results.append({
            'id': gid,
            'name': g.get('name') or '',
            'description': _strip_html(g.get('description') or '')[:400].strip(),
            'avg_rating': g.get('avg_rating'),
            'image_url': imgs[0] if imgs else _TEST_IMAGE,
            'source': g.get('source') or '',
            'genres': g.get('genres') or [],
            'top_reviews': _fmt_reviews(g),
            'score': round(scores[gid] / max_score, 3),
            'price_usd': g.get('price_usd'),
            'release_date': g.get('release_date'),
            'platform': (g.get('platform') or [])[:3],
            'sentiment': _sentiment(g),
            'top_tags': list((g.get('tags') or {}).keys())[:5],
        })
        raw_result_games.append(g)

    for i, result in enumerate(results):
        overlaps = [
            (_tag_overlap(raw_result_games[i], raw_result_games[j]), results[j]['id'])
            for j in range(len(results)) if j != i
        ]
        overlaps.sort(reverse=True)
        result['similar_ids'] = [oid for _, oid in overlaps[:3]]

    return results


# ── Flask routes ──────────────────────────────────────────────────────────────

def register_routes(app):
    @app.route('/', defaults={'path': ''})
    @app.route('/<path:path>')
    def serve(path):
        if path and os.path.exists(os.path.join(app.static_folder, path)):
            return send_from_directory(app.static_folder, path)
        return send_from_directory(app.static_folder, 'index.html')

    @app.route('/api/config')
    def config():
        return jsonify({'use_llm': USE_LLM})

    @app.route('/api/games')
    def games_search():
        query = request.args.get('q', '')
        return jsonify(ir_search(query))

    @app.route('/api/ai/take')
    def ai_take():
        game_id = request.args.get('game_id', '')
        query   = request.args.get('q', '')
        if game_id not in _games:
            return jsonify({'verdict': None}), 200
        api_key = os.getenv('ANTHROPIC_API_KEY')
        if not api_key:
            return jsonify({'verdict': None}), 200
        g      = _games[game_id]
        name   = g.get('name', '')
        desc   = _strip_html(g.get('description') or '')[:400]
        genres = ', '.join(g.get('genres') or [])
        rating = g.get('avg_rating')
        source = g.get('source', '')
        snippets: list[str] = []
        if source == 'amazon':
            for r in (g.get('amazon_reviews') or [])[:3]:
                t = (r.get('summary') or r.get('review') or '')[:100]
                if t: snippets.append(t)
        else:
            for r in (g.get('steam_reviews') or [])[:3]:
                t = (r.get('review') or '')[:100]
                if t: snippets.append(t)
        try:
            import anthropic as _anthropic
            client = _anthropic.Anthropic(api_key=api_key)
            rating_str   = f'{rating:.1f}/5' if rating is not None else 'N/A'
            reviews_str  = ' | '.join(snippets) if snippets else 'No reviews available'
            prompt = (
                f'A user searched for "{query}" and found this game. '
                f'Write a punchy 2-sentence verdict: does it match the search intent, '
                f'and is it actually worth their time? Be direct and opinionated — no hedging.\n\n'
                f'Game: {name}\nRating: {rating_str}\nGenres: {genres}\n'
                f'Description: {desc}\nReview highlights: {reviews_str}\n\n'
                f'Respond with just the verdict. No labels, no preamble.'
            )
            msg     = client.messages.create(
                model='claude-sonnet-4-6',
                max_tokens=180,
                messages=[{'role': 'user', 'content': prompt}],
            )
            return jsonify({'verdict': msg.content[0].text})
        except Exception as e:
            return jsonify({'verdict': None, 'error': str(e)}), 200

    if USE_LLM:
        from llm_routes import register_chat_route
        register_chat_route(app, ir_search)
