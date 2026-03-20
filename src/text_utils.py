"""
Shared text processing pipeline for GameScope search.
Used by both build_db.py (index time) and search_engine.py (query time).
"""

import html
import re
from typing import List

from nltk.corpus import stopwords
from nltk.stem import SnowballStemmer

TOKEN_RE = re.compile(r"[a-z0-9]+")
HTML_TAG_RE = re.compile(r"<[^>]+>")

STOP_WORDS = frozenset(stopwords.words("english"))
_stemmer = SnowballStemmer("english")


def stem(word: str) -> str:
    return _stemmer.stem(word)


def clean_text(value) -> str:
    if not value:
        return ""
    text = html.unescape(str(value))
    return HTML_TAG_RE.sub(" ", text)


def tokenize(text: str) -> List[str]:
    """Lowercase, extract alphanumeric tokens, remove stopwords, stem."""
    raw = TOKEN_RE.findall(text.lower())
    return [stem(t) for t in raw if t not in STOP_WORDS]


def bigrams(tokens: List[str]) -> List[str]:
    """Generate bigram tokens from a list of stemmed tokens."""
    return [f"{tokens[i]}_{tokens[i+1]}" for i in range(len(tokens) - 1)]
