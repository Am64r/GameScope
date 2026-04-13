export interface Review {
  reviewer: string;
  rating: number | null;
  summary: string;
  text: string;
}

export interface Game {
  id: string;
  name: string;
  description: string;
  avg_rating: number | null;
  image_url: string;
  source: 'amazon' | 'steam' | string;
  genres: string[];
  top_reviews: Review[];
  price_usd: number | null;
  release_date: string | null;
  platform: string[];
  sentiment: number | null;
  top_tags: string[];
  similar_ids: string[];
  steam_app_id?: number | string | null;
  steam_url?: string | null;
  score?: number;
  explain?: {
    tfidf_score: number;
    svd_score: number | null;
    hybrid_score: number;
    negation_hits: string[];
  };
}

export interface SearchProcessMeta {
  tokens: Array<{ token: string; idf: number; df: number; in_vocab: boolean }>;
  total_docs: number;
  docs_matched: number;
  docs_scored: number;
  top_genres: Array<{ name: string; count: number }>;
  top_tags: Array<{ name: string; count: number }>;
  svd: null | {
    enabled: boolean;
    alpha: number;
    components: Array<{ component: number; weight: number; top_terms: string[] }>;
  };
  negation: {
    enabled: boolean;
    mode: string;
    terms: string[];
  };
}

export interface SearchResponse {
  results: Game[];
  process: SearchProcessMeta | null;
}
