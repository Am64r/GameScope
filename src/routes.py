"""
Routes: Thin Flask API delegating to search_engine.py.

Endpoints:
- GET /api/games?q=...       — search games
- GET /api/ai/take?game_id=...&q=... — Claude verdict on a game
- GET /api/config             — frontend config
- GET /* — serve React SPA
"""

import logging
import os

from flask import jsonify, request, send_from_directory

from search_engine import GameSearchEngine

USE_LLM = os.environ.get("ANTHROPIC_API_KEY") is not None

logger = logging.getLogger(__name__)

# Build engine at import time (cached after first run)
SEARCH_ENGINE = GameSearchEngine()


def register_routes(app):
    # ── API routes FIRST (before catch-all) ──

    @app.route("/api/config")
    def config():
        return jsonify({"use_llm": USE_LLM})

    @app.route("/api/games")
    def games_search():
        query = request.args.get("q", "")
        limit_raw = request.args.get("limit", "60")
        try:
            limit = int(limit_raw)
        except ValueError:
            limit = 60

        limit = max(1, min(limit, 100))
        search_data = SEARCH_ENGINE.search(query, limit=limit)
        return jsonify(search_data["results"])

    @app.route("/api/ai/take")
    def ai_take():
        if not USE_LLM:
            return jsonify({"verdict": None})

        game_id = request.args.get("game_id", "")
        query = request.args.get("q", "")
        game = SEARCH_ENGINE.get_game_by_id(game_id)

        if not game:
            return jsonify({"verdict": "Game not found."})

        try:
            import anthropic

            client = anthropic.Anthropic()
            reviews_text = ""
            for r in (game.get("steam_reviews") or [])[:5]:
                reviews_text += f"- {r.get('review', '')}\n"
            for r in (game.get("amazon_reviews") or [])[:3]:
                reviews_text += f"- {r.get('review', '')}\n"

            prompt = (
                f'The user searched for "{query}" and found "{game["name"]}".\n'
                f'Description: {game.get("description", "N/A")}\n'
                f'Genres: {", ".join(game.get("genres") or [])}\n'
                f'Rating: {game.get("avg_rating", "N/A")}\n'
                f'Sample reviews:\n{reviews_text}\n'
                f"Give a concise 2-3 sentence verdict on whether this game matches "
                f'what the user is looking for ("{query}"). Be specific about why.'
            )

            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=200,
                messages=[{"role": "user", "content": prompt}],
            )
            verdict = response.content[0].text
            return jsonify({"verdict": verdict})
        except Exception as e:
            logger.error("AI verdict failed: %s", e)
            return jsonify({"verdict": None})

    # ── SPA catch-all LAST ──

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve(path):
        if path != "" and os.path.exists(os.path.join(app.static_folder, path)):
            return send_from_directory(app.static_folder, path)
        return send_from_directory(app.static_folder, "index.html")
