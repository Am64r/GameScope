import argparse
import importlib
import os
import sys
from typing import List

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)


DEFAULT_QUERIES = [
    "open world rpg",
    "cozy puzzle",
    "multiplayer shooter",
    "indie platformer",
    "story rich adventure",
    "no violence",
]


def top_ids(engine: GameSearchEngine, query: str, limit: int) -> List[str]:
    data = engine.search(query, limit=limit)
    return [r.get("id", "") for r in data.get("results", [])]


def overlap(a: List[str], b: List[str]) -> float:
    if not a:
        return 0.0
    return len(set(a).intersection(set(b))) / len(set(a))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--k", type=int, default=10)
    parser.add_argument("--queries", nargs="*", default=DEFAULT_QUERIES)
    args = parser.parse_args()

    from src import search_engine
    os.environ["ENABLE_SVD_SEARCH"] = "0"
    importlib.reload(search_engine)
    baseline_engine = search_engine.GameSearchEngine()
    os.environ["ENABLE_SVD_SEARCH"] = "1"
    importlib.reload(search_engine)
    hybrid_engine = search_engine.GameSearchEngine()

    print(f"{'Query':40} {'Overlap@k':>10} {'BaselineTop1':30} {'HybridTop1':30}")
    print("-" * 120)
    for q in args.queries:
        baseline = baseline_engine.search(q, limit=args.k).get("results", [])
        hybrid = hybrid_engine.search(q, limit=args.k).get("results", [])
        overlap_val = overlap([r.get("id", "") for r in baseline], [r.get("id", "") for r in hybrid])
        baseline_top = baseline[0]["name"][:28] if baseline else "-"
        hybrid_top = hybrid[0]["name"][:28] if hybrid else "-"
        print(f"{q[:40]:40} {overlap_val:10.2f} {baseline_top:30} {hybrid_top:30}")


if __name__ == "__main__":
    main()
