"""
Routes: Thin Flask API delegating to search_engine.py.

Endpoints:
- GET /api/games?q=...       — search games
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

    # ── SPA catch-all LAST ──

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve(path):
        if path != "" and os.path.exists(os.path.join(app.static_folder, path)):
            return send_from_directory(app.static_folder, path)
        return send_from_directory(app.static_folder, "index.html")
