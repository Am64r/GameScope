import type { Game, SearchProcessMeta } from '../types'

interface GameDetailModalProps {
  game: Game
  onClose: () => void
  query?: string
  gameMap?: Map<string, Game>
  onNavigate?: (id: string) => void
  processMeta?: SearchProcessMeta | null
}

export default function GameDetailModal({
  game,
  onClose,
  gameMap,
  onNavigate,
  processMeta,
}: GameDetailModalProps): JSX.Element {
  const releaseYear = game.release_date?.match(/\b(19|20)\d{2}\b/)?.[0] ?? null
  const priceLabel = game.price_usd == null ? null : game.price_usd === 0 ? 'Free' : `$${game.price_usd.toFixed(2)}`
  const similarGames = gameMap ? (game.similar_ids ?? []).map(id => gameMap.get(id)).filter(Boolean) as Game[] : []
  const steamUrl = game.steam_url || (game.steam_app_id ? `https://store.steampowered.com/app/${game.steam_app_id}/` : null)

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(10,5,32,0.96)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Space Mono', monospace", zIndex: 30,
    }} onClick={onClose}>
      <div style={{
        position: 'relative',
        background: '#12082e', border: '1px solid #ff00ff44', borderRadius: 16,
        padding: '32px 40px', maxWidth: 660, width: '92%',
        maxHeight: '88vh', overflowY: 'auto',
        boxShadow: '0 0 40px rgba(255,0,255,0.15)',
      }} onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          aria-label="Close details"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 34,
            height: 34,
            borderRadius: 8,
            border: '1px solid #ff00ff66',
            background: 'linear-gradient(135deg, #2a1a5e, #12082e)',
            color: '#00ffff',
            cursor: 'pointer',
            fontSize: 18,
            fontWeight: 800,
            fontFamily: "'Press Start 2P', monospace",
            boxShadow: '0 0 14px rgba(255,0,255,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
          }}
        >
          ✕
        </button>
        <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
          {game.image_url && (
            <img
              src={game.image_url}
              alt={game.name}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
              style={{ width: 100, height: 130, objectFit: 'cover', borderRadius: 8, flexShrink: 0, border: '1px solid #ff00ff44' }}
            />
          )}
          <div style={{ flex: 1 }}>
            <p style={{ color: '#ff00ff', fontSize: 10, fontWeight: 700, letterSpacing: 3, margin: '0 0 6px', textTransform: 'uppercase' }}>
              {game.genres[0] ?? 'Other'}
            </p>
            <h2 style={{ color: '#e0d0ff', margin: '0 0 8px', fontSize: 20, lineHeight: 1.3, fontFamily: "'Press Start 2P', monospace" }}>{game.name}</h2>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              {game.avg_rating != null && <span style={{ color: '#ffdd00', fontSize: 16, fontWeight: 700 }}>★ {game.avg_rating.toFixed(1)}</span>}
              {game.score != null && <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, background: 'rgba(0,255,255,0.15)', color: '#00ffff', fontWeight: 700 }}>{Math.round(game.score * 100)}% match</span>}
              {priceLabel && <span style={{ fontSize: 13, color: '#00ff88', fontWeight: 700 }}>{priceLabel}</span>}
              {releaseYear && <span style={{ fontSize: 12, color: '#aa88cc' }}>{releaseYear}</span>}
            </div>
            {steamUrl && (
              <a
                href={steamUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-block',
                  marginBottom: 10,
                  fontSize: 11,
                  padding: '5px 10px',
                  borderRadius: 8,
                  border: '1px solid #00ffff66',
                  color: '#00ffff',
                  textDecoration: 'none',
                  background: 'rgba(0,255,255,0.08)',
                  fontWeight: 700,
                }}
              >
                View on Steam
              </a>
            )}
            {game.sentiment != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ height: 6, width: 100, background: '#2a1a4e', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.round(game.sentiment * 100)}%`, background: '#00ffff' }} />
                </div>
                <span style={{ fontSize: 11, color: '#aa88cc' }}>{Math.round(game.sentiment * 100)}% positive</span>
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(game.top_tags ?? []).slice(0, 5).map(t => (
                <span key={t} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 12, background: '#2a1a4e', color: '#aa88cc' }}>{t}</span>
              ))}
            </div>
          </div>
        </div>

        {(game.explain || processMeta?.svd) && (
          <div style={{ background: '#1a0a3e', borderRadius: 10, padding: '14px 18px', marginBottom: 16, border: '1px solid #ff00ff33' }}>
            <p style={{ color: '#aa88cc', fontSize: 11, fontWeight: 700, letterSpacing: 3, margin: '0 0 10px', textTransform: 'uppercase', fontFamily: "'Press Start 2P', monospace" }}>Why This Matched</p>
            {game.explain && (
              <div style={{ color: '#e0d0ff', fontSize: 13, lineHeight: 1.7, marginBottom: 8 }}>
                <p style={{ margin: 0 }}>Hybrid: {game.explain.hybrid_score.toFixed(3)} | TF-IDF: {game.explain.tfidf_score.toFixed(3)}{game.explain.svd_score != null ? ` | SVD: ${game.explain.svd_score.toFixed(3)}` : ''}</p>
                {(game.explain.negation_hits ?? []).length > 0 && (
                  <p style={{ margin: 0, color: '#ff9ecf' }}>Negation constraints touched: {game.explain.negation_hits.join(', ')}</p>
                )}
              </div>
            )}
            {processMeta?.svd?.components?.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {processMeta.svd.components.slice(0, 2).map(c => (
                  <p key={c.component} style={{ margin: 0, color: '#aa88cc', fontSize: 12 }}>
                    Theme {c.component}: {c.top_terms.slice(0, 4).join(', ')}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        )}

        <p style={{ color: '#aa88cc', lineHeight: 1.8, fontSize: 14, margin: '0 0 12px' }}>{game.description}</p>

        {game.platform.length > 0 && (
          <p style={{ color: '#7f68a8', lineHeight: 1.6, fontSize: 13, margin: '0 0 18px' }}>
            Platforms: {game.platform.join(', ')}
          </p>
        )}

        {game.top_reviews.length > 0 && (
          <>
            <p style={{ color: '#aa88cc', fontSize: 11, fontWeight: 700, letterSpacing: 3, margin: '0 0 12px', textTransform: 'uppercase', fontFamily: "'Press Start 2P', monospace" }}>Top Reviews</p>
            {game.top_reviews.map((r, i) => (
              <div key={i} style={{ background: '#1a0a3e', borderRadius: 10, padding: '14px 18px', marginBottom: 10, borderLeft: '3px solid #ff00ff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ color: '#aa88cc', fontSize: 12, fontWeight: 600 }}>{r.reviewer}</span>
                  {r.rating != null && <span style={{ color: '#ffdd00', fontSize: 12, fontWeight: 700 }}>★ {r.rating}</span>}
                </div>
                {r.summary && <p style={{ color: '#e0d0ff', fontSize: 13, margin: '0 0 4px', fontWeight: 600 }}>{r.summary}</p>}
                <p style={{ color: '#aa88cc', fontSize: 13, margin: 0, lineHeight: 1.6 }}>{r.text}</p>
              </div>
            ))}
          </>
        )}

        {similarGames.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <p style={{ color: '#aa88cc', fontSize: 11, fontWeight: 700, letterSpacing: 3, margin: '0 0 10px', textTransform: 'uppercase', fontFamily: "'Press Start 2P', monospace" }}>Similar</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {similarGames.map(sg => (
                <button
                  key={sg.id}
                  onClick={() => { onClose(); onNavigate?.(sg.id) }}
                  style={{ fontSize: 12, padding: '6px 14px', borderRadius: 20, border: '1px solid #ff00ff44', background: '#1a0a3e', color: '#e0d0ff', cursor: 'pointer', fontFamily: "'Space Mono', monospace" }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#2a1a5e')}
                  onMouseLeave={e => (e.currentTarget.style.background = '#1a0a3e')}
                >
                  {sg.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
