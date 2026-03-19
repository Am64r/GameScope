export interface GameResult {
  app_id: string
  name: string
  short_description: string
  genres: string[]
  tags: string[]
  price: number | null
  positive: number | null
  negative: number | null
  review_snippets: string[]
  score: number
}

export interface SearchResponse {
  results: GameResult[]
  similar_games: GameResult[]
}
