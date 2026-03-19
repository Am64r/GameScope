import { useState, useEffect, useRef } from 'react'
import './App.css'
import { Game } from './types'
import ArcadeWorld from './ArcadeWorld'

function App(): JSX.Element {
  const [useLlm, setUseLlm] = useState<boolean | null>(null)
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [games, setGames] = useState<Game[]>([])
  const [arcadeOpen, setArcadeOpen] = useState<boolean>(false)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(data => setUseLlm(data.use_llm))
  }, [])

  const handleSearch = async (value: string): Promise<void> => {
    setSearchTerm(value)
    setArcadeOpen(false)
    if (value.trim() === '') { setGames([]); return }
    setLoading(true)
    const response = await fetch(`/api/games?q=${encodeURIComponent(value)}`)
    const data: Game[] = await response.json()
    setGames(data)
    setLoading(false)
  }

  if (useLlm === null) return <></>

  if (arcadeOpen && games.length > 0) {
    return <ArcadeWorld games={games} query={searchTerm} onSearch={handleSearch} onExit={() => setArcadeOpen(false)} />
  }

  const hasResults = games.length > 0

  return (
    <div className="landing">
      {/* Hero */}
      <div className={`hero ${hasResults ? 'hero--compact' : ''}`}>
        <div className="brand" onClick={() => inputRef.current?.focus()}>
          <span className="brand-g">G</span>
          <span className="brand-a">a</span>
          <span className="brand-m">m</span>
          <span className="brand-e">e</span>
          <span className="brand-s">S</span>
          <span className="brand-c">c</span>
          <span className="brand-o">o</span>
          <span className="brand-p">p</span>
          <span className="brand-e2">e</span>
        </div>
        {!hasResults && (
          <p className="tagline">Explore 32,000+ games in 3D space</p>
        )}
        <div className="search-wrap">
          <div className="search-box">
            <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              ref={inputRef}
              placeholder="Search games, genres, vibes…"
              value={searchTerm}
              onChange={e => handleSearch(e.target.value)}
              autoFocus
            />
            {loading && <div className="spinner" />}
          </div>
        </div>

        {!hasResults && (
          <div className="pill-row">
            {['open world RPG', 'cozy puzzle', 'multiplayer shooter', 'indie platformer', 'horror survival'].map(q => (
              <button key={q} className="pill" onClick={() => handleSearch(q)}>{q}</button>
            ))}
          </div>
        )}
      </div>

      {/* Results */}
      {hasResults && (
        <div className="results">
          <div className="results-header">
            <span className="results-count">{games.length} results for <em>"{searchTerm}"</em></span>
            <button className="arcade-btn" onClick={() => setArcadeOpen(true)}>
              🕹 Explore in 3D Arcade
            </button>
          </div>

          <div className="cards">
            {games.map((game, i) => {
              const zone = game.genres[0] ?? 'Other'
              const zoneColors: Record<string, string> = {
                Action: '#ef4444', RPG: '#8b5cf6', Simulation: '#22c55e',
                Puzzle: '#14b8a6', Strategy: '#3b82f6', Adventure: '#f97316',
                Sports: '#eab308', Racing: '#ec4899',
              }
              const accent = zoneColors[zone] ?? '#9ca3af'
              const price = game.price_usd == null ? null : game.price_usd === 0 ? 'Free' : `$${game.price_usd.toFixed(2)}`
              const year = game.release_date?.match(/\b(19|20)\d{2}\b/)?.[0]
              return (
                <div key={i} className="card" style={{ '--accent': accent } as React.CSSProperties}>
                  <div className="card-thumb">
                    {game.image_url
                      ? <img src={game.image_url} alt={game.name} />
                      : <div className="card-thumb-empty" style={{ background: accent + '22' }}><span style={{ color: accent, fontSize: 28 }}>🎮</span></div>
                    }
                    <div className="card-score">{game.score != null ? `${Math.round(game.score * 100)}%` : ''}</div>
                  </div>

                  <div className="card-body">
                    <div className="card-top">
                      <span className="card-zone" style={{ color: accent }}>{zone}</span>
                      <span className={`card-source source-${game.source}`}>{game.source}</span>
                    </div>
                    <h3 className="card-name">{game.name}</h3>
                    <div className="card-meta">
                      {game.avg_rating != null && <span className="card-rating">★ {game.avg_rating.toFixed(1)}</span>}
                      {price && <span className="card-price">{price}</span>}
                      {year && <span className="card-year">{year}</span>}
                      {game.sentiment != null && (
                        <span className="card-sentiment">
                          <span className="sentiment-bar" style={{ width: `${Math.round(game.sentiment * 100)}%` }} />
                          {Math.round(game.sentiment * 100)}% pos
                        </span>
                      )}
                    </div>
                    <p className="card-desc">{game.description}</p>
                    {(game.top_tags ?? []).length > 0 && (
                      <div className="card-tags">
                        {(game.top_tags ?? []).slice(0, 4).map(t => <span key={t} className="tag">{t}</span>)}
                      </div>
                    )}
                    {game.top_reviews.length > 0 && (
                      <p className="card-review">
                        "{game.top_reviews[0].summary || game.top_reviews[0].text.slice(0, 100)}"
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
