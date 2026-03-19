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
  score?: number;
}
