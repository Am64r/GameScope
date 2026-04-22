"""
Routes: Thin Flask API delegating to search_engine.py and llm_routes.py.

Endpoints:
- GET  /api/games?q=...  — pure IR search (TF-IDF + SVD)
- POST /api/rag          — RAG: LLM rewrites query, IR runs, LLM streams grounded answer (SSE)
- GET  /api/config       — frontend config
- GET  /*                — serve React SPA
"""

import logging
import os

from flask import jsonify, request, send_from_directory

from llm_routes import LLM_API_KEY_ENV, register_rag_route
from search_engine import GameSearchEngine

USE_LLM = os.environ.get(LLM_API_KEY_ENV) is not None
INCLUDE_PROCESS_META = os.environ.get("INCLUDE_PROCESS_META", "1").lower() not in {"0", "false", "no"}

logger = logging.getLogger(__name__)

# Build engine at import time (cached after first run)
SEARCH_ENGINE = GameSearchEngine()


def register_routes(app):
    # ── API routes FIRST (before catch-all) ──

    @app.route("/api/config")
    def config():
        return jsonify({"use_llm": USE_LLM, "include_process_meta": INCLUDE_PROCESS_META})

    @app.route("/api/games")
    def games_search():
        query = request.args.get("q", "")
        limit_raw = request.args.get("limit", "60")
        try:
            limit = int(limit_raw)
        except ValueError:
            limit = 60

        limit = max(1, min(limit, 100))
        filter_nsfw = request.args.get("nsfw", "0").lower() not in {"1", "true", "yes"}
        search_data = SEARCH_ENGINE.search(query, limit=limit, filter_nsfw=filter_nsfw)
        include_process_raw = request.args.get("include_process")
        include_process = INCLUDE_PROCESS_META
        if include_process_raw is not None:
            include_process = include_process_raw.lower() in {"1", "true", "yes"}
        if include_process:
            return jsonify(search_data)
        return jsonify(search_data["results"])

    if USE_LLM:
        register_rag_route(app, SEARCH_ENGINE)
    else:
        logger.warning(
            "%s not set; /api/rag disabled. Front-end will fall back to /api/games.",
            LLM_API_KEY_ENV,
        )

    # ── SPA catch-all LAST ──

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve(path):
        if path != "" and os.path.exists(os.path.join(app.static_folder, path)):
            return send_from_directory(app.static_folder, path)
        return send_from_directory(app.static_folder, "index.html")
