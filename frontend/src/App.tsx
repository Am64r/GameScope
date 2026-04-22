import { useState, useEffect, useRef } from 'react'
import './App.css'
import { Game, SearchProcessMeta, SearchResponse } from './types'
import GameDetailModal from './components/GameDetailModal'

interface AiState {
  modifiedQuery: string | null
  summary: string
  streaming: boolean
  error: string | null
}

const EMPTY_AI: AiState = { modifiedQuery: null, summary: '', streaming: false, error: null }

function App(): JSX.Element {
  const [useLlm, setUseLlm] = useState<boolean | null>(null)
  const [includeProcessMeta, setIncludeProcessMeta] = useState<boolean>(true)
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [games, setGames] = useState<Game[]>([])
  const [processMeta, setProcessMeta] = useState<SearchProcessMeta | null>(null)
  const [selectedGame, setSelectedGame] = useState<Game | null>(null)
  const [filterNsfw, setFilterNsfw] = useState<boolean>(true)
  const [loading, setLoading] = useState(false)
  const [ai, setAi] = useState<AiState>(EMPTY_AI)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(data => {
      setUseLlm(data.use_llm)
      setIncludeProcessMeta(data.include_process_meta ?? true)
    })
  }, [])

  const cancelInflight = () => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
  }

  const runIrSearch = async (value: string, nsfw: boolean): Promise<void> => {
    setLoading(true)
    try {
      const response = await fetch(
        `/api/games?q=${encodeURIComponent(value)}&include_process=${includeProcessMeta ? '1' : '0'}&nsfw=${nsfw ? '0' : '1'}`,
      )
      const data = await response.json()
      if (Array.isArray(data)) {
        setGames(data as Game[])
        setProcessMeta(null)
      } else {
        const payload = data as SearchResponse
        setGames(payload.results ?? [])
        setProcessMeta(payload.process ?? null)
      }
    } finally {
      setLoading(false)
    }
  }

  const runRagSearch = async (value: string, nsfw: boolean): Promise<void> => {
    cancelInflight()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setAi({ modifiedQuery: null, summary: '', streaming: true, error: null })

    try {
      const response = await fetch('/api/rag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: value,
          filter_nsfw: nsfw,
          include_process: includeProcessMeta,
          limit: 60,
        }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        const msg = await response.text().catch(() => '')
        throw new Error(`RAG request failed (${response.status}) ${msg}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let summary = ''
      let receivedResults = false

      while (true) {
        const { done, value: chunk } = await reader.read()
        if (done) break
        buffer += decoder.decode(chunk, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let event: any
          try { event = JSON.parse(line.slice(6)) } catch { continue }

          if (event.type === 'modified_query') {
            setAi(prev => ({ ...prev, modifiedQuery: event.modified ?? null }))
          } else if (event.type === 'search_response') {
            const payload = event.value as SearchResponse
            setGames(payload.results ?? [])
            setProcessMeta(payload.process ?? null)
            receivedResults = true
            setLoading(false)
          } else if (event.type === 'content') {
            summary += event.value ?? ''
            setAi(prev => ({ ...prev, summary }))
          } else if (event.type === 'error') {
            setAi(prev => ({ ...prev, error: event.value || 'AI summary failed', streaming: false }))
          } else if (event.type === 'done') {
            setAi(prev => ({ ...prev, streaming: false }))
          }
        }
      }

      if (!receivedResults) setLoading(false)
      setAi(prev => ({ ...prev, streaming: false }))
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      console.error(err)
      setAi(prev => ({ ...prev, error: 'AI is unavailable. Showing IR results only.', streaming: false }))
      // Fall back to plain IR so the user still sees results
      await runIrSearch(value, nsfw)
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const doSearch = async (value: string, nsfw?: boolean): Promise<void> => {
    setSelectedGame(null)
    if (value.trim() === '') {
      cancelInflight()
      setGames([])
      setProcessMeta(null)
      setAi(EMPTY_AI)
      return
    }
    const nsfwFlag = nsfw ?? filterNsfw
    if (useLlm) {
      await runRagSearch(value, nsfwFlag)
    } else {
      setAi(EMPTY_AI)
      await runIrSearch(value, nsfwFlag)
    }
  }

  const handleSubmit = () => { doSearch(searchTerm) }
  const handlePill = (q: string) => { setSearchTerm(q); doSearch(q) }
  const handleNsfwToggle = (checked: boolean) => {
    setFilterNsfw(checked)
    if (searchTerm.trim()) doSearch(searchTerm, checked)
  }

  if (useLlm === null) return <></>

  const hasResults = games.length > 0
  const hasAi = ai.modifiedQuery !== null || ai.summary.length > 0 || ai.streaming || ai.error !== null

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
          <p className="tagline">Explore 5000+ games in 3D space</p>
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
              onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
              autoFocus
            />
            <button className="search-btn" onClick={handleSubmit} disabled={loading}>
              {loading ? <div className="spinner" /> : 'Search'}
            </button>
          </div>
        </div>
        <label className="nsfw-toggle">
          <input type="checkbox" checked={filterNsfw} onChange={e => handleNsfwToggle(e.target.checked)} />
          <span>Hide NSFW</span>
        </label>

        {!hasResults && (
          <div className="pill-row">
            {['chill puzzle no combat', 'open world fantasy RPG', 'cozy multiplayer with friends', 'spooky atmospheric horror', 'rainy day relaxing'].map(q => (
              <button key={q} className="pill" onClick={() => handlePill(q)}>{q}</button>
            ))}
          </div>
        )}
      </div>

      {/* AI Summary panel — sits between search and cards (per RAG diagram) */}
      {hasAi && (
        <div className="ai-panel">
          <div className="ai-panel-header">
            <span className="ai-badge">AI Overview</span>
            {ai.modifiedQuery && (
              <span className="ai-modified-query">
                searched for <em>“{ai.modifiedQuery}”</em>
              </span>
            )}
          </div>
          {ai.error ? (
            <p className="ai-error">{ai.error}</p>
          ) : (
            <p className="ai-summary">
              {ai.summary || (ai.streaming ? 'Thinking…' : '')}
              {ai.streaming && <span className="ai-cursor">▍</span>}
            </p>
          )}
        </div>
      )}

      {/* Results */}
      {hasResults && (
        <div className="results">
          <div className="results-header">
            <span className="results-count">{games.length} results for <em>"{searchTerm}"</em></span>
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
                <div key={game.id || `${game.name}-${i}`} className="card" style={{ '--accent': accent } as React.CSSProperties} onClick={() => setSelectedGame(game)} onKeyDown={(e) => { if (e.key === 'Enter') setSelectedGame(game) }} role="button" tabIndex={0}>
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
                    <p className="card-more">Click for details</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {selectedGame && (
        <GameDetailModal
          game={selectedGame}
          query={searchTerm}
          onClose={() => setSelectedGame(null)}
          processMeta={processMeta}
        />
      )}
    </div>
  )
}

export default App
