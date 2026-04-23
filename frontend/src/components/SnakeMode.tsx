import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Game } from '../types'
import './SnakeMode.css'

interface Props {
  games: Game[]
  query: string
  onClose: () => void
  onPickGame?: (game: Game) => void
}

interface Cell { x: number; y: number }
interface Food extends Cell { game: Game; rank: number }

const COLS = 24
const ROWS = 15
const TICK_MS = 130
const MIN_TICK_MS = 70
const FOOD_COUNT = 15

type Direction = 'up' | 'down' | 'left' | 'right'

const OPPOSITE: Record<Direction, Direction> = {
  up: 'down', down: 'up', left: 'right', right: 'left',
}

function randomEmptyCell(taken: Set<string>): Cell | null {
  const free: Cell[] = []
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!taken.has(`${x},${y}`)) free.push({ x, y })
    }
  }
  if (free.length === 0) return null
  return free[Math.floor(Math.random() * free.length)]
}

function SnakeMode({ games, query, onClose, onPickGame }: Props): JSX.Element {
  const topGames = useMemo(() => games.slice(0, FOOD_COUNT), [games])

  const initialSnake: Cell[] = useMemo(() => [
    { x: Math.floor(COLS / 2) - 1, y: Math.floor(ROWS / 2) },
    { x: Math.floor(COLS / 2) - 2, y: Math.floor(ROWS / 2) },
    { x: Math.floor(COLS / 2) - 3, y: Math.floor(ROWS / 2) },
  ], [])

  const [snake, setSnake] = useState<Cell[]>(initialSnake)
  const [food, setFood] = useState<Food | null>(null)
  const [nextRank, setNextRank] = useState<number>(0)
  const [collected, setCollected] = useState<Game[]>([])
  const [status, setStatus] = useState<'idle' | 'playing' | 'over' | 'won'>('idle')
  const [tickMs, setTickMs] = useState<number>(TICK_MS)

  const directionRef = useRef<Direction>('right')
  const queuedDirection = useRef<Direction | null>(null)

  const placeFoodForRank = useCallback((rank: number, snakeCells: Cell[]) => {
    if (rank >= topGames.length) {
      setFood(null)
      return
    }
    const taken = new Set<string>(snakeCells.map(c => `${c.x},${c.y}`))
    const cell = randomEmptyCell(taken)
    if (!cell) { setFood(null); return }
    setFood({ ...cell, game: topGames[rank], rank })
  }, [topGames])

  const reset = useCallback(() => {
    setSnake(initialSnake)
    directionRef.current = 'right'
    queuedDirection.current = null
    setCollected([])
    setTickMs(TICK_MS)
    setNextRank(0)
    placeFoodForRank(0, initialSnake)
    setStatus('idle')
  }, [initialSnake, placeFoodForRank])

  useEffect(() => { reset() }, [reset])

  const start = useCallback(() => {
    if (topGames.length === 0) return
    setStatus('playing')
  }, [topGames.length])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      const map: Record<string, Direction> = {
        ArrowUp: 'up', w: 'up', W: 'up',
        ArrowDown: 'down', s: 'down', S: 'down',
        ArrowLeft: 'left', a: 'left', A: 'left',
        ArrowRight: 'right', d: 'right', D: 'right',
      }
      const next = map[e.key]
      if (next) {
        e.preventDefault()
        if (status === 'idle') setStatus('playing')
        if (next !== OPPOSITE[directionRef.current]) {
          queuedDirection.current = next
        }
      } else if ((e.key === ' ' || e.key === 'Enter') && (status === 'over' || status === 'won')) {
        e.preventDefault()
        reset()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, reset, status])

  // Game loop
  useEffect(() => {
    if (status !== 'playing') return
    const id = window.setInterval(() => {
      setSnake(prev => {
        const nextDir = queuedDirection.current ?? directionRef.current
        directionRef.current = nextDir
        queuedDirection.current = null

        const head = prev[0]
        const delta = nextDir === 'up' ? { x: 0, y: -1 }
          : nextDir === 'down' ? { x: 0, y: 1 }
          : nextDir === 'left' ? { x: -1, y: 0 }
          : { x: 1, y: 0 }
        const newHead = { x: head.x + delta.x, y: head.y + delta.y }

        // wall collision
        if (newHead.x < 0 || newHead.x >= COLS || newHead.y < 0 || newHead.y >= ROWS) {
          setStatus('over')
          return prev
        }

        // self collision (skip last tail segment since it will move)
        const body = prev.slice(0, -1)
        if (body.some(c => c.x === newHead.x && c.y === newHead.y)) {
          setStatus('over')
          return prev
        }

        const onFood = food && food.x === newHead.x && food.y === newHead.y
        if (onFood && food) {
          const eatenGame = food.game
          const nextSnake = [newHead, ...prev]
          setCollected(c => [...c, eatenGame])
          setTickMs(ms => Math.max(MIN_TICK_MS, ms - 4))
          const newRank = food.rank + 1
          setNextRank(newRank)
          if (newRank >= topGames.length) {
            setFood(null)
            setStatus('won')
          } else {
            placeFoodForRank(newRank, nextSnake)
          }
          return nextSnake
        }

        return [newHead, ...prev.slice(0, -1)]
      })
    }, tickMs)
    return () => window.clearInterval(id)
  }, [status, food, tickMs, topGames.length, placeFoodForRank])

  // Touch / swipe controls
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    touchStartRef.current = { x: t.clientX, y: t.clientY }
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current
    if (!start) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return
    const next: Direction = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up')
    if (next !== OPPOSITE[directionRef.current]) queuedDirection.current = next
    if (status === 'idle') setStatus('playing')
    touchStartRef.current = null
  }

  const head = snake[0]
  const currentTarget = food?.game ?? null
  // flip the label below the food when near the top edge so it doesn't clip
  const labelBelow = food ? food.y < 2 : false

  return (
    <div className="snake-backdrop" onClick={onClose}>
      <div
        className="snake-modal"
        onClick={e => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="snake-header">
          <div className="snake-title">
            <span className="snake-emoji">🐍</span>
            <span>SNAKE MODE</span>
            {query && <span className="snake-query">— hunting results for <em>"{query}"</em></span>}
          </div>
          <div className="snake-hud">
            {currentTarget && status === 'playing' && (
              <span className="snake-next">
                NEXT <b>#{(food?.rank ?? 0) + 1}</b> · {currentTarget.name}
              </span>
            )}
            <span className="snake-stat">SCORE <b>{collected.length}</b>/{topGames.length}</span>
            <button className="snake-close" onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>

        <div className="snake-layout">
          <div
            className="snake-board"
            style={{
              gridTemplateColumns: `repeat(${COLS}, 1fr)`,
              gridTemplateRows: `repeat(${ROWS}, 1fr)`,
              aspectRatio: `${COLS} / ${ROWS}`,
            }}
          >
            {food && (
              <div
                key={`f-${food.game.id}-${food.rank}`}
                className="snake-food"
                style={{ gridColumn: food.x + 1, gridRow: food.y + 1 }}
                title={food.game.name}
              >
                {food.game.image_url
                  ? <img src={food.game.image_url} alt={food.game.name} />
                  : <span className="snake-food-fallback">🎮</span>}
                <span className="snake-food-ring" />
                <span className={`snake-food-label${labelBelow ? ' snake-food-label--below' : ''}`}>
                  <span className="snake-food-rank">#{food.rank + 1}</span>
                  <span className="snake-food-name">{food.game.name}</span>
                </span>
              </div>
            )}

            {snake.map((c, i) => {
              const isHead = i === 0
              return (
                <div
                  key={`s-${i}`}
                  className={`snake-cell${isHead ? ' snake-head' : ''}`}
                  style={{ gridColumn: c.x + 1, gridRow: c.y + 1 }}
                />
              )
            })}

            {/* Overlays */}
            {status === 'idle' && (
              <div className="snake-overlay">
                <div>
                  <div className="snake-overlay-title">READY</div>
                  <p>Eat the top {topGames.length} games. Don't bite yourself.</p>
                  <p className="snake-hint">Arrow keys / WASD · swipe on mobile</p>
                  <button className="snake-btn" onClick={start}>START</button>
                </div>
              </div>
            )}
            {status === 'over' && (
              <div className="snake-overlay">
                <div>
                  <div className="snake-overlay-title">GAME OVER</div>
                  <p>You collected {collected.length} of {topGames.length}.</p>
                  <div className="snake-overlay-actions">
                    <button className="snake-btn" onClick={reset}>TRY AGAIN</button>
                    <button className="snake-btn snake-btn-ghost" onClick={onClose}>EXIT</button>
                  </div>
                </div>
              </div>
            )}
            {status === 'won' && (
              <div className="snake-overlay snake-overlay-won">
                <div>
                  <div className="snake-overlay-title">PERFECT RUN</div>
                  <p>You caught all {topGames.length} games.</p>
                  <div className="snake-overlay-actions">
                    <button className="snake-btn" onClick={reset}>PLAY AGAIN</button>
                    <button className="snake-btn snake-btn-ghost" onClick={onClose}>BACK TO RESULTS</button>
                  </div>
                </div>
              </div>
            )}

            {/* subtle grid/scanline overlay */}
            <div className="snake-scan" />
          </div>

          <aside className="snake-side">
            <h4>Collected</h4>
            <ul className="snake-collected">
              {topGames.map(g => {
                const got = collected.some(c => c.id === g.id)
                return (
                  <li
                    key={g.id}
                    className={got ? 'got' : ''}
                    onClick={() => { if (got && onPickGame) { onPickGame(g); onClose() } }}
                  >
                    <span className="snake-dot" />
                    <span className="snake-name">{g.name}</span>
                  </li>
                )
              })}
            </ul>
            <p className="snake-foot">
              Head at ({head?.x ?? 0}, {head?.y ?? 0}) · Speed {Math.round(1000 / tickMs)} fps
            </p>
          </aside>
        </div>
      </div>
    </div>
  )
}

export default SnakeMode
