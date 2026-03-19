import { FormEvent, useState, useCallback, useRef, useEffect, type JSX } from 'react'
import './App.css'
import { GameResult, SearchResponse } from './types'
import ScoreMeter from './components/ScoreMeter'
import EmptyState from './components/EmptyState'
import LoadingState from './components/LoadingState'
import ReviewCarousel from './components/ReviewCarousel'
import MouseField from './components/MouseField'
import SoundToggle from './components/SoundToggle'
import { useIntersection } from './hooks/useIntersection'
import { useSound } from './hooks/useSound'
import { useKeyboardNav } from './hooks/useKeyboardNav'

const STEAM_IMG = (appId: string) =>
  `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`

function SteamImage({
  appId,
  className,
  fallbackClass,
}: {
  appId: string
  className: string
  fallbackClass: string
}): JSX.Element {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return <div className={fallbackClass}>&#x1F3AE;</div>
  }

  return (
    <div className={className}>
      <img
        src={STEAM_IMG(appId)}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </div>
  )
}

function AnimatedCard({
  index,
  children,
  className,
  onClick,
  focused,
}: {
  index: number
  children: React.ReactNode
  className: string
  onClick: () => void
  focused: boolean
}): JSX.Element {
  const [intersectionRef, visible] = useIntersection(0.1)
  const delay = Math.min(index * 60, 400)
  const divRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (focused && divRef.current) {
      divRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [focused])

  const setRef = useCallback((el: HTMLDivElement | null) => {
    divRef.current = el
    ;(intersectionRef as React.MutableRefObject<HTMLDivElement | null>).current = el
  }, [intersectionRef])

  return (
    <div
      ref={setRef}
      className={`card-enter${visible ? ' visible' : ''} ${className}${focused ? ' card-focused' : ''}`}
      style={{ transitionDelay: `${delay}ms` }}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

function HeroCard({
  game,
  maxScore,
  expanded,
  onClick,
  onTagClick,
  focused,
}: {
  game: GameResult
  maxScore: number
  expanded: boolean
  onClick: () => void
  onTagClick: (tag: string) => void
  focused: boolean
}): JSX.Element {
  const positive = game.positive ?? 0
  const negative = game.negative ?? 0
  const total = positive + negative
  const sentiment = total > 0 ? Math.round((positive / total) * 100) : null

  return (
    <AnimatedCard index={0} className="hero-card" onClick={onClick} focused={focused}>
      <SteamImage
        appId={game.app_id}
        className="hero-card-image-wrap"
        fallbackClass="hero-card-image-fallback"
      />
      <div className="hero-card-image-wrap hero-scrim" style={{ position: 'absolute', top: 0 }} />

      <div className="hero-card-body">
        <div className="result-header">
          <h2>{game.name}</h2>
          {sentiment !== null && (
            <span className={`sentiment ${sentiment >= 70 ? 'positive' : sentiment >= 40 ? 'mixed' : 'negative'}`}>
              {sentiment}%
            </span>
          )}
        </div>

        <ScoreMeter score={game.score} maxScore={maxScore} />

        <p className={`description${expanded ? '' : ' description-clamped'}`}>
          {game.short_description || 'No description available.'}
        </p>

        {game.tags && game.tags.length > 0 && (
          <div className="tags">
            {game.tags.slice(0, expanded ? undefined : 4).map((tag) => (
              <span
                key={tag}
                className="tag"
                onClick={(e) => { e.stopPropagation(); onTagClick(tag) }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {game.review_snippets && game.review_snippets.length > 0 && !expanded && (
          <p className="hero-snippet">"{game.review_snippets[0]}"</p>
        )}

        <div className={`card-expandable${expanded ? ' expanded' : ''}`}>
          <div className="card-expandable-inner">
            {game.review_snippets && game.review_snippets.length > 0 && (
              <ReviewCarousel snippets={game.review_snippets} />
            )}

            <div className="result-meta">
              <span>{game.genres.length > 0 ? game.genres.join(' / ') : 'N/A'}</span>
              <span>{game.price != null && game.price > 0 ? `$${game.price.toFixed(2)}` : 'Free'}</span>
              <span>{total.toLocaleString()} reviews</span>
              <a
                className="steam-link"
                href={`https://store.steampowered.com/app/${game.app_id}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                View on Steam &rarr;
              </a>
            </div>
          </div>
        </div>

        <p className="card-expand-indicator">
          {expanded ? '[ collapse ]' : '[ click to expand ]'}
        </p>
      </div>
    </AnimatedCard>
  )
}

function GameCard({
  game,
  index,
  maxScore,
  expanded,
  onClick,
  onTagClick,
  focused,
}: {
  game: GameResult
  index: number
  maxScore: number
  expanded: boolean
  onClick: () => void
  onTagClick: (tag: string) => void
  focused: boolean
}): JSX.Element {
  const positive = game.positive ?? 0
  const negative = game.negative ?? 0
  const total = positive + negative
  const sentiment = total > 0 ? Math.round((positive / total) * 100) : null

  return (
    <AnimatedCard index={index} className="game-card" onClick={onClick} focused={focused}>
      <SteamImage
        appId={game.app_id}
        className="game-card-image-wrap"
        fallbackClass="game-card-image-fallback"
      />

      <div className="game-card-body">
        <div className="result-header">
          <h2>{game.name}</h2>
          {sentiment !== null && (
            <span className={`sentiment ${sentiment >= 70 ? 'positive' : sentiment >= 40 ? 'mixed' : 'negative'}`}>
              {sentiment}%
            </span>
          )}
        </div>

        <ScoreMeter score={game.score} maxScore={maxScore} />

        <p className={`description${expanded ? '' : ' description-clamped'}`}>
          {game.short_description || 'No description available.'}
        </p>

        {game.tags && game.tags.length > 0 && (
          <div className="tags">
            {game.tags.slice(0, expanded ? undefined : 4).map((tag) => (
              <span
                key={tag}
                className="tag"
                onClick={(e) => { e.stopPropagation(); onTagClick(tag) }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className={`card-expandable${expanded ? ' expanded' : ''}`}>
          <div className="card-expandable-inner">
            {game.review_snippets && game.review_snippets.length > 0 && (
              <ReviewCarousel snippets={game.review_snippets} />
            )}

            <div className="result-meta">
              <span>{game.genres.length > 0 ? game.genres.join(' / ') : 'N/A'}</span>
              <span>{game.price != null && game.price > 0 ? `$${game.price.toFixed(2)}` : 'Free'}</span>
              <span>{total.toLocaleString()} reviews</span>
              <a
                className="steam-link"
                href={`https://store.steampowered.com/app/${game.app_id}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                View on Steam &rarr;
              </a>
            </div>
          </div>
        </div>

        <p className="card-expand-indicator">
          {expanded ? '[ collapse ]' : '[ click to expand ]'}
        </p>
      </div>
    </AnimatedCard>
  )
}

function SimilarRail({ games }: { games: GameResult[] }): JSX.Element {
  const railRef = useRef<HTMLDivElement>(null)

  const scroll = (dir: number) => {
    if (railRef.current) {
      railRef.current.scrollBy({ left: dir * 220, behavior: 'smooth' })
    }
  }

  return (
    <div className="similar-rail-wrap">
      <button className="similar-rail-arrow left" onClick={() => scroll(-1)}>&lt;</button>
      <div className="similar-rail" ref={railRef}>
        {games.map((game) => (
          <a
            key={game.app_id}
            className="similar-rail-card"
            href={`https://store.steampowered.com/app/${game.app_id}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <SteamImage
              appId={game.app_id}
              className="game-card-image-wrap"
              fallbackClass="game-card-image-fallback"
            />
            <div className="similar-rail-card-body">
              <h4>{game.name}</h4>
              <div className="similar-rail-card-meta">
                <span>{game.genres.length > 0 ? game.genres[0] : ''}</span>
                <span>{game.price != null && game.price > 0 ? `$${game.price.toFixed(2)}` : 'Free'}</span>
              </div>
            </div>
          </a>
        ))}
      </div>
      <button className="similar-rail-arrow right" onClick={() => scroll(1)}>&gt;</button>
    </div>
  )
}

function App(): JSX.Element {
  const [query, setQuery] = useState<string>('')
  const [results, setResults] = useState<GameResult[]>([])
  const [similarGames, setSimilarGames] = useState<GameResult[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>('')
  const [searched, setSearched] = useState<boolean>(false)
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const sound = useSound()

  const maxScore = results.length > 0 ? results[0].score : 1

  const doSearch = useCallback(async (text: string) => {
    if (!text.trim()) return

    setLoading(true)
    setError('')
    setSearched(true)
    setExpandedCards(new Set())
    setFocusedIndex(-1)
    sound.playSearch()

    try {
      const response = await fetch(`/api/search?title=${encodeURIComponent(text.trim())}&limit=20`)
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`)
      }
      const data: SearchResponse = await response.json()
      setResults(data.results)
      setSimilarGames(data.similar_games)
      if (data.results.length > 0) sound.playResult()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Search failed'
      setError(message)
      setResults([])
      setSimilarGames([])
    } finally {
      setLoading(false)
    }
  }, [sound])

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault()
    doSearch(query)
  }

  const handleQueryClick = useCallback((q: string) => {
    setQuery(q)
    doSearch(q)
  }, [doSearch])

  const toggleCard = useCallback((appId: string) => {
    sound.playExpand()
    setExpandedCards((prev) => {
      const next = new Set(prev)
      if (next.has(appId)) {
        next.delete(appId)
      } else {
        next.add(appId)
      }
      return next
    })
  }, [sound])

  const handleTagClick = useCallback((tag: string) => {
    sound.playTag()
    const newQuery = `${query} ${tag}`.trim()
    setQuery(newQuery)
    doSearch(newQuery)
  }, [query, doSearch, sound])

  const handleExpand = useCallback((i: number) => {
    const game = results[i]
    if (game) toggleCard(game.app_id)
  }, [results, toggleCard])

  const handleClearFocus = useCallback(() => {
    setFocusedIndex(-1)
    inputRef.current?.focus()
  }, [])

  useKeyboardNav(results.length, focusedIndex, setFocusedIndex, handleExpand, handleClearFocus)

  return (
    <>
      <MouseField />
      <div className="crt-overlay" />

      <main className="app">
        <header className="header">
          <h1>
            <span className="invader-icon">{'\u{1F47E}'}</span>
            GameScope
          </h1>
          <p className="subtitle">Describe the experience. Find the game.</p>
        </header>

        <form onSubmit={handleSearch}>
          <div className="search-row">
            <input
              ref={inputRef}
              type="text"
              placeholder='a cozy game with no combat...'
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
            />
            <button type="submit" disabled={loading}>
              SEARCH
            </button>
          </div>
        </form>

        {loading && <LoadingState />}
        {!loading && error && <p className="status error">{error}</p>}
        {!loading && searched && !error && results.length === 0 && (
          <p className="status">No matches. Try different keywords.</p>
        )}

        {!loading && !searched && <EmptyState onQueryClick={handleQueryClick} />}

        {results.length > 0 && (
          <section className="results">
            <h3 className="section-title">TOP MATCHES</h3>

            {/* Hero card for #1 result */}
            <HeroCard
              game={results[0]}
              maxScore={maxScore}
              expanded={expandedCards.has(results[0].app_id)}
              onClick={() => toggleCard(results[0].app_id)}
              onTagClick={handleTagClick}
              focused={focusedIndex === 0}
            />

            {/* Two-column grid for remaining results */}
            {results.length > 1 && (
              <div className="results-grid">
                {results.slice(1).map((game, i) => (
                  <GameCard
                    key={game.app_id}
                    game={game}
                    index={i + 1}
                    maxScore={maxScore}
                    expanded={expandedCards.has(game.app_id)}
                    onClick={() => toggleCard(game.app_id)}
                    onTagClick={handleTagClick}
                    focused={focusedIndex === i + 1}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {similarGames.length > 0 && (
          <section className="results similar-section">
            <h3 className="section-title">YOU MIGHT ALSO LIKE</h3>
            <p className="section-subtitle">Similar games based on shared genres and tags</p>
            <SimilarRail games={similarGames} />
          </section>
        )}
      </main>

      <SoundToggle enabled={sound.enabled} onToggle={sound.toggle} />
    </>
  )
}

export default App
