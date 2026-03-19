"""
Data reduction script for GameScope.
Reduces ~65K Steam games to a curated 5K subset with 25 top reviews each.
Uses hybrid genre sampling for diversity across categories.
"""

import json
import csv
import os
import math
from collections import Counter

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAMES_JSON = os.path.join(BASE_DIR, "data", "games.json")
REVIEWS_DIR = os.path.join(BASE_DIR, "data", "Game Reviews")
OUTPUT_GAMES = os.path.join(BASE_DIR, "data", "curated_games.json")
OUTPUT_REVIEWS = os.path.join(BASE_DIR, "data", "curated_reviews.json")

TARGET_GAMES = 5000
REVIEWS_PER_GAME = 25
MIN_POSITIVE_REVIEWS = 10
SMALL_GENRE_THRESHOLD = 50
ENGLISH_RATIO_THRESHOLD = 0.90
MIN_REVIEW_LENGTH = 20


def is_english(text):
    """
    Check if text is English by verifying that 90%+ of characters
    are basic Latin (ASCII letters, digits, punctuation, whitespace).
    Filters out Chinese, Korean, Japanese, Arabic, Cyrillic, etc.
    """
    if not text or len(text.strip()) < MIN_REVIEW_LENGTH:
        return False
    ascii_count = sum(1 for c in text if ord(c) < 128)
    return (ascii_count / len(text)) >= ENGLISH_RATIO_THRESHOLD


def load_games():
    """Load all game metadata from games.json."""
    print(f"Loading games from {GAMES_JSON}...")
    with open(GAMES_JSON, "r", encoding="utf-8") as f:
        games = json.load(f)
    print(f"  Loaded {len(games)} games")
    return games


def get_review_app_ids():
    """Scan Game Reviews directory to find which App IDs have review CSVs."""
    print(f"Scanning review files in {REVIEWS_DIR}...")
    app_ids = set()
    for filename in os.listdir(REVIEWS_DIR):
        if filename.endswith(".csv"):
            app_id = filename.split("_")[0]
            app_ids.add(app_id)
    print(f"  Found {len(app_ids)} games with review files")
    return app_ids


def filter_eligible_games(games, review_app_ids):
    """
    Filter to games that:
    - Have a review CSV file
    - Have at least one genre
    - Have >= MIN_POSITIVE_REVIEWS positive reviews
    Returns dict of {app_id: game_data}.
    """
    print("Filtering eligible games...")
    eligible = {}
    for app_id, game in games.items():
        if app_id not in review_app_ids:
            continue
        if not game.get("genres"):
            continue
        if game.get("positive", 0) < MIN_POSITIVE_REVIEWS:
            continue
        eligible[app_id] = game
    print(f"  {len(eligible)} eligible games after filtering")
    return eligible


def hybrid_genre_sample(eligible):
    """
    Select TARGET_GAMES using hybrid genre sampling.
    Small genres: take all. Large genres: proportional allocation, sorted by popularity.
    Returns list of selected app IDs.
    """
    print("Performing hybrid genre sampling...")

    # Group by primary genre
    genre_groups = {}
    for app_id, game in eligible.items():
        primary_genre = game["genres"][0]
        if primary_genre not in genre_groups:
            genre_groups[primary_genre] = []
        genre_groups[primary_genre].append((app_id, game))

    print(f"  {len(genre_groups)} genres found")

    # Separate small and large genres
    small_genres = {}
    large_genres = {}
    for genre, games_list in genre_groups.items():
        if len(games_list) <= SMALL_GENRE_THRESHOLD:
            small_genres[genre] = games_list
        else:
            large_genres[genre] = games_list

    # Take all games from small genres
    selected = []
    small_total = 0
    for genre, games_list in small_genres.items():
        games_list.sort(key=lambda x: x[1].get("positive", 0), reverse=True)
        selected.extend([app_id for app_id, _ in games_list])
        small_total += len(games_list)
        print(f"  {genre}: taking all {len(games_list)} games (small genre)")

    # Remaining slots for large genres
    remaining_slots = TARGET_GAMES - small_total
    large_total = sum(len(g) for g in large_genres.values())

    print(f"  {small_total} games from small genres, {remaining_slots} slots remaining")

    # Proportional allocation across large genres
    for genre, games_list in large_genres.items():
        proportion = len(games_list) / large_total
        n_select = math.floor(proportion * remaining_slots)

        games_list.sort(key=lambda x: x[1].get("positive", 0), reverse=True)
        genre_selected = [app_id for app_id, _ in games_list[:n_select]]
        selected.extend(genre_selected)
        print(f"  {genre}: {n_select} / {len(games_list)} games (proportional)")

    # If rounding left us short, fill from largest genres
    if len(selected) < TARGET_GAMES:
        deficit = TARGET_GAMES - len(selected)
        selected_set = set(selected)
        remaining = []
        for genre, games_list in large_genres.items():
            for app_id, game in games_list:
                if app_id not in selected_set:
                    remaining.append((app_id, game))
        remaining.sort(key=lambda x: x[1].get("positive", 0), reverse=True)
        selected.extend([app_id for app_id, _ in remaining[:deficit]])

    print(f"  Total selected: {len(selected)} games")
    return selected


def extract_curated_data(games, selected_ids):
    """
    For each selected game:
    - Extract metadata from games dict
    - Read review CSV, sort by helpfulness, take top REVIEWS_PER_GAME
    Returns (curated_games dict, curated_reviews dict), both keyed by app_id.
    """
    print(f"Extracting metadata and top {REVIEWS_PER_GAME} reviews per game...")

    curated_games = {}
    curated_reviews = {}
    selected_set = set(selected_ids)

    # Build a map of app_id -> review filename
    review_files = {}
    for filename in os.listdir(REVIEWS_DIR):
        if filename.endswith(".csv"):
            app_id = filename.split("_")[0]
            if app_id in selected_set:
                review_files[app_id] = filename

    processed = 0
    skipped = 0

    for app_id in selected_ids:
        curated_games[app_id] = games[app_id]

        if app_id not in review_files:
            curated_reviews[app_id] = []
            skipped += 1
            continue

        filepath = os.path.join(REVIEWS_DIR, review_files[app_id])
        reviews = []
        try:
            with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    try:
                        helpfulness = int(row.get("helpfulness", 0))
                    except (ValueError, TypeError):
                        helpfulness = 0
                    review_text = row.get("review", "")
                    if not is_english(review_text):
                        continue
                    reviews.append({
                        "user": row.get("user", ""),
                        "playtime": row.get("playtime", "0"),
                        "post_date": row.get("post_date", ""),
                        "helpfulness": helpfulness,
                        "review": review_text,
                        "recommend": row.get("recommend", ""),
                        "early_access_review": row.get("early_access_review", ""),
                    })
        except Exception as e:
            print(f"  Warning: failed to read {filepath}: {e}")
            curated_reviews[app_id] = []
            skipped += 1
            continue

        reviews.sort(key=lambda r: r["helpfulness"], reverse=True)
        curated_reviews[app_id] = reviews[:REVIEWS_PER_GAME]

        processed += 1
        if processed % 500 == 0:
            print(f"  Processed {processed} / {len(selected_ids)} games...")

    print(f"  Done. {processed} processed, {skipped} skipped.")
    return curated_games, curated_reviews


def save_output(curated_games, curated_reviews):
    """Save curated data to JSON files."""
    print(f"Saving {len(curated_games)} games to {OUTPUT_GAMES}...")
    with open(OUTPUT_GAMES, "w", encoding="utf-8") as f:
        json.dump(curated_games, f, ensure_ascii=False)
    file_size = os.path.getsize(OUTPUT_GAMES) / (1024 * 1024)
    print(f"  Saved ({file_size:.1f} MB)")

    print(f"Saving reviews to {OUTPUT_REVIEWS}...")
    with open(OUTPUT_REVIEWS, "w", encoding="utf-8") as f:
        json.dump(curated_reviews, f, ensure_ascii=False)
    file_size = os.path.getsize(OUTPUT_REVIEWS) / (1024 * 1024)
    print(f"  Saved ({file_size:.1f} MB)")

    total_reviews = sum(len(r) for r in curated_reviews.values())
    print(f"\n  Summary:")
    print(f"    Games: {len(curated_games)}")
    print(f"    Total reviews: {total_reviews}")
    print(f"    Avg reviews/game: {total_reviews / len(curated_games):.1f}")


def main():
    print("=== GameScope Data Reduction Pipeline ===")
    print()

    games = load_games()
    review_app_ids = get_review_app_ids()
    eligible = filter_eligible_games(games, review_app_ids)
    selected_ids = hybrid_genre_sample(eligible)
    curated_games, curated_reviews = extract_curated_data(games, selected_ids)
    save_output(curated_games, curated_reviews)

    print("\n=== Done ===")


if __name__ == "__main__":
    main()
