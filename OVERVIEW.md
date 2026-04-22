# GameScope — How It Works

## What is it?

A game discovery search engine that lets you search by vibe, not just by title or genre. Searches across 5,000+ games from Steam and Amazon using natural language — so you can type things like "chill puzzle no combat" or "cozy multiplayer with friends" and get results that match.

## Data

- 5,000 games sampled from Steam and Amazon
- Each game has: title, description, tags, genres, user reviews, ratings, sentiment scores
- Balanced by source and genre so no single category dominates the dataset

## Search

We use **TF-IDF with cosine similarity**.

For each game, we combine its title, description, tags, genres, and player reviews into one document. Each field is weighted — title matches count 3x more than a review mention, tags/genres count 2x, descriptions 1.5x. This gives us a TF-IDF vector per game.

When you search, we:
1. Tokenize your query (lowercase, stem, remove stopwords)
2. Generate bigrams (e.g. "open world" becomes a single token)
3. Compute cosine similarity between your query and all 5,000 game vectors
4. Return the top results

## Ranking

Results are ranked by cosine similarity with a small **social boost** on top — games with more positive reviews and higher popularity get a slight edge (~7.5% max). This prevents obscure, barely-reviewed games from outranking well-known titles at the same relevance.

## Why reviews matter

Most storefronts only let you search titles and tags. We index real player reviews, so when someone writes "this game is super relaxing" in a review, that language becomes searchable. That's what makes vibe-based queries work.

## Frontend

- Search page with results displayed as cards
- 3D arcade view (Three.js) where you can walk around and explore top results in an interactive space

## Stack

- **Backend**: Python, Flask, SQLite
- **Search**: Custom TF-IDF engine (NLTK for tokenization/stemming)
- **Frontend**: React, TypeScript, Three.js
