"""
RAG endpoint for GameScope.

Pipeline (matches the lecture diagram exactly):
    user query
        -> LLM call #1: rewrite into IR-friendly keywords
        -> IR (TF-IDF + SVD) returns top-K games
        -> LLM call #2: stream a grounded recommendation that cites games by name

SSE events emitted by /api/rag:
    {"type": "modified_query", "original": "...", "modified": "..."}
    {"type": "search_response", "value": <SearchResponse>}
    {"type": "content", "value": "<delta>"}     # repeated
    {"type": "done"}
    {"type": "error", "value": "..."}
"""

import json
import logging
import os

from flask import Response, jsonify, request, stream_with_context

from infosci_spark_client import LLMClient

logger = logging.getLogger(__name__)

LLM_API_KEY_ENV = "SPARK_API_KEY"
RAG_CONTEXT_LIMIT = 10  # how many games to feed into the summary LLM

REWRITE_SYSTEM_PROMPT = (
    "You rewrite natural-language video-game search requests into a short keyword query "
    "for a TF-IDF + SVD search engine over a catalogue of 5000 games (Steam + Amazon).\n"
    "Rules:\n"
    "- Output 3 to 10 lowercase keywords or short phrases separated by spaces.\n"
    "- Capture genre, mechanics, mood/vibe, themes, and platform when implied.\n"
    "- Preserve negations using the literal form 'no X' (e.g. 'no combat', 'no horror'). "
    "The search engine has a negation handler that depends on this format.\n"
    "- Do NOT invent constraints the user didn't imply.\n"
    "- Do NOT add commentary, quotes, punctuation, or explanation. Output only the keywords on one line."
)

ANSWER_SYSTEM_PROMPT = (
    "You are GameScope's recommendation assistant. Using ONLY the games in the provided context, "
    "write a concise recommendation (2 to 4 sentences) that answers the user's request. "
    "Cite specific games by their exact name. Pick 2 to 3 of the most relevant ones and briefly "
    "say why each fits. If the results clearly don't match the request, say so honestly. "
    "Do not invent games, ratings, or facts not present in the context."
)


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


def _build_context_block(results: list, limit: int = RAG_CONTEXT_LIMIT) -> str:
    """Compact game cards into a context block the LLM can read."""
    if not results:
        return "No games matched the search."
    lines = []
    for i, g in enumerate(results[:limit], start=1):
        name = g.get("name") or "Unknown"
        genres = ", ".join(g.get("genres") or []) or "n/a"
        tags = ", ".join((g.get("top_tags") or [])[:5]) or "n/a"
        sentiment = g.get("sentiment")
        sentiment_str = f"{round(sentiment * 100)}%" if isinstance(sentiment, (int, float)) else "n/a"
        rating = g.get("avg_rating")
        rating_str = f"{rating:.1f}/5" if isinstance(rating, (int, float)) else "n/a"
        desc = (g.get("description") or "").strip().replace("\n", " ")
        if len(desc) > 280:
            desc = desc[:280].rstrip() + "..."
        snippet = ""
        snippets = g.get("review_snippets") or []
        top_reviews = g.get("top_reviews") or []
        if snippets:
            snippet = snippets[0]
        elif top_reviews:
            snippet = (top_reviews[0].get("text") or "").strip()
        if snippet and len(snippet) > 200:
            snippet = snippet[:200].rstrip() + "..."

        block = (
            f"[{i}] {name}\n"
            f"    Genres: {genres}\n"
            f"    Tags: {tags}\n"
            f"    Rating: {rating_str} | Positive sentiment: {sentiment_str}\n"
            f"    Description: {desc or 'n/a'}"
        )
        if snippet:
            block += f"\n    Review: \"{snippet}\""
        lines.append(block)
    return "\n\n".join(lines)


def _rewrite_query(client: LLMClient, user_query: str) -> str:
    """LLM call #1: turn natural language into keywords for the IR engine."""
    messages = [
        {"role": "system", "content": REWRITE_SYSTEM_PROMPT},
        {"role": "user", "content": user_query},
    ]
    try:
        response = client.chat(messages, stream=False)
        text = (response.get("content") or "").strip()
        # Strip wrapping quotes / leading "Query:" if model adds them
        text = text.strip("\"'`")
        if ":" in text and len(text.split(":", 1)[0]) < 20:
            text = text.split(":", 1)[1].strip()
        # Collapse to one line
        text = " ".join(text.split())
        if not text:
            return user_query
        return text
    except Exception as exc:
        logger.warning("Query rewrite failed (%s); falling back to original query", exc)
        return user_query


def register_rag_route(app, search_engine):
    """Register POST /api/rag. Called from routes.py."""

    @app.route("/api/rag", methods=["POST"])
    def rag():
        data = request.get_json(silent=True) or {}
        user_query = (data.get("query") or "").strip()
        if not user_query:
            return jsonify({"error": "query is required"}), 400

        try:
            limit = int(data.get("limit") or 60)
        except (TypeError, ValueError):
            limit = 60
        limit = max(1, min(limit, 100))

        filter_nsfw = bool(data.get("filter_nsfw", True))
        include_process = bool(data.get("include_process", True))

        api_key = os.getenv(LLM_API_KEY_ENV)
        if not api_key:
            return jsonify({"error": f"{LLM_API_KEY_ENV} not set on server"}), 500

        client = LLMClient(api_key=api_key)

        def generate():
            # Step 1 — LLM rewrites the query
            modified_query = _rewrite_query(client, user_query)
            yield _sse({
                "type": "modified_query",
                "original": user_query,
                "modified": modified_query,
            })

            # Step 2 — IR runs on the modified query
            try:
                search_data = search_engine.search(
                    modified_query, limit=limit, filter_nsfw=filter_nsfw
                )
            except Exception as exc:
                logger.exception("IR search failed: %s", exc)
                yield _sse({"type": "error", "value": "Search failed."})
                return

            payload = {"results": search_data.get("results", [])}
            if include_process:
                payload["process"] = search_data.get("process")
            yield _sse({"type": "search_response", "value": payload})

            # Step 3 — LLM streams a grounded recommendation
            context_block = _build_context_block(search_data.get("results", []))
            answer_messages = [
                {"role": "system", "content": ANSWER_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"User's original request: {user_query}\n\n"
                        f"Search keywords used: {modified_query}\n\n"
                        f"Top retrieved games:\n\n{context_block}\n\n"
                        "Write the recommendation now."
                    ),
                },
            ]

            try:
                for chunk in client.chat(answer_messages, stream=True):
                    delta = chunk.get("content") or ""
                    if delta:
                        yield _sse({"type": "content", "value": delta})
            except Exception as exc:
                logger.exception("Answer streaming failed: %s", exc)
                yield _sse({"type": "error", "value": "AI summary failed."})
                return

            yield _sse({"type": "done"})

        return Response(
            stream_with_context(generate()),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )
