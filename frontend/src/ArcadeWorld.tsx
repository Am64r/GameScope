import {
  useRef, useState, useEffect, Suspense, useCallback, MutableRefObject, useMemo,
} from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, useTexture, Environment } from '@react-three/drei'
import * as THREE from 'three'
import type { Game } from './types'

// ── Constants ─────────────────────────────────────────────────────────────────

const PROX  = 6.5
const FORCE = 55
const DAMP  = 0.86
const MAXSPD = 22

// ── Genre zones ───────────────────────────────────────────────────────────────

const GENRE_ZONES: Record<string, { color: string; offset: [number, number] }> = {
  'Action':      { color: '#ef4444', offset: [-30, -14] },
  'RPG':         { color: '#8b5cf6', offset: [0,   -14] },
  'Simulation':  { color: '#22c55e', offset: [30,  -14] },
  'Puzzle':      { color: '#14b8a6', offset: [-30, -44] },
  'Strategy':    { color: '#3b82f6', offset: [0,   -44] },
  'Adventure':   { color: '#f97316', offset: [30,  -44] },
  'Sports':      { color: '#eab308', offset: [-15, -74] },
  'Other':       { color: '#9ca3af', offset: [15,  -74] },
}
const ZONE_NAMES = Object.keys(GENRE_ZONES)

function getZone(game: Game): string {
  for (const genre of game.genres) {
    if (GENRE_ZONES[genre]) return genre
  }
  return 'Other'
}

// ── Layout ────────────────────────────────────────────────────────────────────

interface PositionedGame extends Game {
  pos: [number, number, number]
  zone: string
}

const LOCAL_COLS    = 2
const LOCAL_SPREAD_X = 10
const LOCAL_SPREAD_Z = 13

function computeZoneLayout(games: Game[]): PositionedGame[] {
  const byZone = new Map<string, Game[]>()
  ZONE_NAMES.forEach(z => byZone.set(z, []))
  games.forEach(g => byZone.get(getZone(g))!.push(g))

  const result: PositionedGame[] = []
  byZone.forEach((zoneGames, zoneName) => {
    const { offset: [ox, oz] } = GENRE_ZONES[zoneName]
    zoneGames.forEach((g, i) => {
      const col = i % LOCAL_COLS
      const row = Math.floor(i / LOCAL_COLS)
      const x = ox + (col - (LOCAL_COLS - 1) / 2) * LOCAL_SPREAD_X
      const z = oz - row * LOCAL_SPREAD_Z
      const jx = (g.id.charCodeAt(0) % 18) / 10 - 0.9
      const jz = (g.id.charCodeAt(Math.min(2, g.id.length - 1)) % 18) / 10 - 0.9
      result.push({ ...g, pos: [x + jx, 0, z + jz], zone: zoneName })
    })
  })
  return result
}

// ── Cover image ───────────────────────────────────────────────────────────────

function CoverImage({ url }: { url: string }) {
  const tex = useTexture(url)
  return (
    <mesh position={[0, 0.46, 0.046]}>
      <planeGeometry args={[1.75, 2.1]} />
      <meshBasicMaterial map={tex} />
    </mesh>
  )
}

// ── Zone marker ───────────────────────────────────────────────────────────────

function ZoneMarker({ zoneName, posGames }: { zoneName: string; posGames: PositionedGame[] }) {
  const zoneGames = posGames.filter(g => g.zone === zoneName)
  if (zoneGames.length === 0) return null
  const { color, offset: [ox, oz] } = GENRE_ZONES[zoneName]
  const count = zoneGames.length
  const rows = Math.ceil(count / LOCAL_COLS)
  const radiusX = LOCAL_SPREAD_X * (LOCAL_COLS / 2) + 8
  const radiusZ = (rows * LOCAL_SPREAD_Z) / 2 + 8
  const cz = oz - ((rows - 1) * LOCAL_SPREAD_Z) / 2

  return (
    <group>
      {/* Floor color patch */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[ox, 0.005, cz]}>
        <planeGeometry args={[radiusX * 2, radiusZ * 2]} />
        <meshStandardMaterial color={color} transparent opacity={0.07} roughness={1} depthWrite={false} />
      </mesh>
      {/* Zone label */}
      <Html center position={[ox, 0.3, oz + 5]}>
        <div style={{
          fontFamily: 'system-ui, sans-serif',
          fontSize: 11, fontWeight: 800, letterSpacing: 3,
          color, textTransform: 'uppercase',
          pointerEvents: 'none', userSelect: 'none',
          textShadow: '0 1px 6px rgba(255,255,255,0.95)',
          opacity: 0.9,
        }}>
          {zoneName}
        </div>
      </Html>
    </group>
  )
}

// ── Game stand ────────────────────────────────────────────────────────────────

function GameStand({ game, ballPos, visited }: {
  game: PositionedGame
  ballPos: MutableRefObject<THREE.Vector3>
  visited: boolean
}) {
  const groupRef = useRef<THREE.Group>(null)
  const leanRef  = useRef(0)
  const [active, setActive] = useState(false)
  const phase    = game.id.charCodeAt(0) / 100

  useFrame(() => {
    const g = groupRef.current
    if (!g) return
    const dx   = ballPos.current.x - game.pos[0]
    const dz   = ballPos.current.z - game.pos[2]
    const near = Math.sqrt(dx * dx + dz * dz) < PROX
    if (near !== active) setActive(near)
    leanRef.current = THREE.MathUtils.lerp(leanRef.current, near ? -0.16 : 0, 0.1)
    g.rotation.x    = leanRef.current
    g.position.y    = Math.sin(Date.now() * 0.001 + phase) * 0.04
  })

  const ratingStr  = game.avg_rating != null ? `★ ${game.avg_rating.toFixed(1)}` : ''
  const matchPct   = game.score != null ? `${Math.round(game.score * 100)}%` : null
  const zoneColor  = GENRE_ZONES[game.zone]?.color ?? '#9ca3af'
  const glowColor  = visited ? '#22c55e' : zoneColor
  const badgeActive = active || visited
  const releaseYear = game.release_date?.match(/\b(19|20)\d{2}\b/)?.[0] ?? null
  const priceLabel  = game.price_usd == null ? null : game.price_usd === 0 ? 'Free' : `$${game.price_usd.toFixed(2)}`

  return (
    <group ref={groupRef} position={game.pos}>
      {/* White card */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1.9, 2.7, 0.08]} />
        <meshStandardMaterial color="#ffffff" roughness={0.04} metalness={0} envMapIntensity={0.6} />
      </mesh>

      {/* Zone color strip */}
      <mesh position={[0, 1.21, 0.046]}>
        <planeGeometry args={[1.9, 0.24]} />
        <meshStandardMaterial color={zoneColor} roughness={0.3} />
      </mesh>

      {/* Cover art */}
      {game.image_url ? (
        <Suspense fallback={null}>
          <CoverImage url={game.image_url} />
        </Suspense>
      ) : (
        <mesh position={[0, 0.46, 0.046]}>
          <planeGeometry args={[1.75, 2.1]} />
          <meshStandardMaterial color="#f0f0f0" />
        </mesh>
      )}

      {/* Rating badge */}
      <mesh position={[0.71, -0.98, 0.046]}>
        <circleGeometry args={[0.27, 24]} />
        <meshStandardMaterial
          color={badgeActive ? glowColor : '#eeeeee'}
          roughness={0.1}
          emissive={badgeActive ? glowColor : '#000000'}
          emissiveIntensity={badgeActive ? 0.4 : 0}
        />
      </mesh>

      {/* Game name label */}
      <Html center distanceFactor={9} position={[0, -0.78, 0.06]}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: '#333',
          fontFamily: 'system-ui, sans-serif', textAlign: 'center',
          maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', pointerEvents: 'none', userSelect: 'none',
        }}>
          {game.name}
        </div>
      </Html>

      {/* Post */}
      <mesh position={[0, -1.87, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.035, 0.88, 8]} />
        <meshStandardMaterial color="#cccccc" roughness={0.4} metalness={0.5} />
      </mesh>

      {/* Base */}
      <mesh position={[0, -2.33, 0]} receiveShadow>
        <cylinderGeometry args={[0.42, 0.42, 0.08, 24]} />
        <meshStandardMaterial color="#e4e4e4" roughness={0.2} metalness={0.35} />
      </mesh>

      {/* Glow ring */}
      {(active || visited) && (
        <mesh position={[0, -2.28, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.45, 0.6, 32]} />
          <meshStandardMaterial
            color={glowColor} emissive={glowColor}
            emissiveIntensity={visited ? 1.2 : 2}
            transparent opacity={visited && !active ? 0.5 : 0.7}
          />
        </mesh>
      )}

      {/* Proximity tooltip — richer */}
      {active && (
        <Html center distanceFactor={7} position={[0, 2.3, 0]}>
          <div style={{
            background: 'rgba(255,255,255,0.97)', border: '1px solid #e8e8e8',
            borderRadius: 10, padding: '8px 14px',
            fontFamily: 'system-ui, sans-serif', textAlign: 'center',
            boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
            pointerEvents: 'none', whiteSpace: 'nowrap', minWidth: 160,
          }}>
            <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700, color: '#111', maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {game.name}
            </p>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', fontSize: 11, flexWrap: 'wrap', marginBottom: 4 }}>
              {ratingStr   && <span style={{ color: '#f4b400', fontWeight: 700 }}>{ratingStr}</span>}
              {matchPct    && <span style={{ color: '#a5b4fc', fontWeight: 700 }}>{matchPct} match</span>}
              {priceLabel  && <span style={{ color: '#22c55e', fontWeight: 700 }}>{priceLabel}</span>}
              {releaseYear && <span style={{ color: '#888' }}>{releaseYear}</span>}
              {visited     && <span style={{ color: '#22c55e', fontWeight: 700 }}>✓</span>}
            </div>
            {(game.top_tags ?? []).length > 0 && (
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 4 }}>
                {(game.top_tags ?? []).slice(0, 3).map(t => (
                  <span key={t} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 6, background: '#f0f0f0', color: '#777' }}>{t}</span>
                ))}
              </div>
            )}
            {(game.sentiment ?? null) != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'center' }}>
                <div style={{ height: 4, width: 72, background: '#e8e8e8', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.round((game.sentiment ?? 0) * 100)}%`, background: '#22c55e', borderRadius: 2 }} />
                </div>
                <span style={{ fontSize: 9, color: '#888' }}>{Math.round((game.sentiment ?? 0) * 100)}% pos</span>
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  )
}

// ── Marble ────────────────────────────────────────────────────────────────────

function Marble({ ballPos, velRef, keys, camYaw }: {
  ballPos: MutableRefObject<THREE.Vector3>
  velRef: MutableRefObject<THREE.Vector3>
  keys: MutableRefObject<{ w: boolean; s: boolean; a: boolean; d: boolean }>
  camYaw: MutableRefObject<number>
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const _fwd    = new THREE.Vector3()
  const _right  = new THREE.Vector3()

  useFrame((_, dt) => {
    // Derive forward/right from camYaw so movement is always relative to camera angle
    _fwd.set(Math.sin(camYaw.current), 0, Math.cos(camYaw.current)).normalize()
    _right.set(Math.cos(camYaw.current), 0, -Math.sin(camYaw.current)).normalize()

    const { w, s, a, d } = keys.current
    if (w) velRef.current.addScaledVector(_fwd,    FORCE * dt)
    if (s) velRef.current.addScaledVector(_fwd,   -FORCE * dt)
    if (a) velRef.current.addScaledVector(_right, -FORCE * dt)
    if (d) velRef.current.addScaledVector(_right,  FORCE * dt)

    velRef.current.multiplyScalar(DAMP)
    const spd = velRef.current.length()
    if (spd > MAXSPD) velRef.current.multiplyScalar(MAXSPD / spd)

    ballPos.current.addScaledVector(velRef.current, dt)
    ballPos.current.y = 0.5

    if (meshRef.current) {
      meshRef.current.position.copy(ballPos.current)
      meshRef.current.rotation.x += velRef.current.z * dt * 2.0
      meshRef.current.rotation.z -= velRef.current.x * dt * 2.0
    }
  })

  return (
    <mesh ref={meshRef} position={[0, 0.5, 4]} castShadow>
      <sphereGeometry args={[0.5, 36, 36]} />
      <meshStandardMaterial color="#f8f8f8" metalness={0.96} roughness={0.04} envMapIntensity={1.4} />
      <pointLight intensity={0.8} color="#ffe066" distance={3} />
    </mesh>
  )
}

// ── Camera rig ────────────────────────────────────────────────────────────────

function CameraRig({ ballPos, camYaw, camPitch }: {
  ballPos: MutableRefObject<THREE.Vector3>
  camYaw: MutableRefObject<number>
  camPitch: MutableRefObject<number>
}) {
  const { camera } = useThree()
  const lookAt = useRef(new THREE.Vector3(0, 0.5, 4))

  useFrame(() => {
    const pos = ballPos.current
    const dist = 8, height = Math.max(3, 9 + camPitch.current * 8)
    const cx = pos.x - Math.sin(camYaw.current) * dist
    const cz = pos.z - Math.cos(camYaw.current) * dist
    const desired = new THREE.Vector3(cx, pos.y + height, cz)
    camera.position.lerp(desired, 0.09)
    lookAt.current.lerp(new THREE.Vector3(pos.x, pos.y + 0.8, pos.z), 0.12)
    camera.lookAt(lookAt.current)
  })
  return null
}

// ── Floor ─────────────────────────────────────────────────────────────────────

function Floor({ posGames }: { posGames: PositionedGame[] }) {
  if (posGames.length === 0) return null
  const xs   = posGames.map(g => g.pos[0])
  const zs   = posGames.map(g => g.pos[2])
  const minX = Math.min(...xs) - 20, maxX = Math.max(...xs) + 20
  const minZ = Math.min(...zs) - 20
  const w    = maxX - minX
  const h    = 14 - minZ
  const cx   = (minX + maxX) / 2
  const cz   = (minZ + 14) / 2
  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.01, cz]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color="#f2f2f2" roughness={0.06} metalness={0.12} envMapIntensity={0.5} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.002, cz]}>
        <planeGeometry args={[w, h, 60, 60]} />
        <meshBasicMaterial color="#e0e0e0" wireframe transparent opacity={0.3} />
      </mesh>
    </group>
  )
}

// ── Genre connections (proximity-based pop-up labels) ─────────────────────────

interface Connection {
  ax: number; az: number
  bx: number; bz: number
  mx: number; mz: number   // midpoint
  genre: string
  color: string
}

function GenreConnections({ posGames, ballPos }: {
  posGames: PositionedGame[]
  ballPos: MutableRefObject<THREE.Vector3>
}) {
  const matRef   = useRef<THREE.LineBasicMaterial>(null)
  const [nearConn, setNearConn] = useState<Connection | null>(null)

  const { geo, connections } = useMemo(() => {
    const byZone = new Map<string, PositionedGame[]>()
    posGames.forEach(g => {
      if (!byZone.has(g.zone)) byZone.set(g.zone, [])
      byZone.get(g.zone)!.push(g)
    })
    const pts: number[] = []
    const conns: Connection[] = []
    byZone.forEach((group, zone) => {
      const color = GENRE_ZONES[zone]?.color ?? '#aaa'
      for (let i = 0; i < group.length - 1; i++) {
        const a = group[i], b = group[i + 1]
        const dist = Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2])
        if (dist < 50) {
          pts.push(a.pos[0], 0.018, a.pos[2], b.pos[0], 0.018, b.pos[2])
          conns.push({
            ax: a.pos[0], az: a.pos[2],
            bx: b.pos[0], bz: b.pos[2],
            mx: (a.pos[0] + b.pos[0]) / 2,
            mz: (a.pos[2] + b.pos[2]) / 2,
            genre: zone, color,
          })
        }
      }
    })
    if (pts.length === 0) return { geo: null, connections: [] }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return { geo: g, connections: conns }
  }, [posGames])

  useFrame(() => {
    const bx = ballPos.current.x, bz = ballPos.current.z
    let nearest: Connection | null = null
    let nearestD = 6
    connections.forEach(c => {
      const d = Math.hypot(bx - c.mx, bz - c.mz)
      if (d < nearestD) { nearestD = d; nearest = c }
    })
    setNearConn(prev => {
      if (!prev && !nearest) return null
      if (prev && nearest && prev.mx === nearest.mx) return prev
      return nearest
    })
  })

  if (!geo) return null
  return (
    <group>
      <lineSegments geometry={geo}>
        <lineBasicMaterial ref={matRef} color="#c4b5fd" transparent opacity={0.6} />
      </lineSegments>
      {nearConn && (
        <Html center position={[nearConn.mx, 0.8, nearConn.mz]}>
          <div style={{
            background: nearConn.color, color: '#fff',
            fontSize: 10, fontWeight: 800, letterSpacing: 2,
            padding: '4px 10px', borderRadius: 20,
            textTransform: 'uppercase', pointerEvents: 'none',
            userSelect: 'none', whiteSpace: 'nowrap',
            boxShadow: `0 2px 12px ${nearConn.color}88`,
          }}>
            {nearConn.genre} zone
          </div>
        </Html>
      )}
    </group>
  )
}

// ── Scene ─────────────────────────────────────────────────────────────────────

function Scene({ posGames, ballPos, velRef, keys, visitedIds, camYaw, camPitch }: {
  posGames: PositionedGame[]
  ballPos: MutableRefObject<THREE.Vector3>
  velRef: MutableRefObject<THREE.Vector3>
  keys: MutableRefObject<{ w: boolean; s: boolean; a: boolean; d: boolean }>
  visitedIds: Set<string>
  camYaw: MutableRefObject<number>
  camPitch: MutableRefObject<number>
}) {
  return (
    <>
      <color attach="background" args={['#f5f5f5']} />
      <fog attach="fog" args={['#f5f5f5', 50, 160]} />

      <ambientLight intensity={1.0} color="#ffffff" />
      <directionalLight
        position={[10, 22, 10]} intensity={1.5} castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-100} shadow-camera-right={100}
        shadow-camera-top={100}  shadow-camera-bottom={-100}
        shadow-camera-far={200}
      />
      <directionalLight position={[-8, 14, -6]} intensity={0.45} color="#e8eeff" />

      <Environment preset="warehouse" />

      <Floor posGames={posGames} />
      <GenreConnections posGames={posGames} ballPos={ballPos} />

      {/* Zone markers */}
      {ZONE_NAMES.map(zoneName => (
        <ZoneMarker key={zoneName} zoneName={zoneName} posGames={posGames} />
      ))}

      <Marble ballPos={ballPos} velRef={velRef} keys={keys} camYaw={camYaw} />
      <CameraRig ballPos={ballPos} camYaw={camYaw} camPitch={camPitch} />

      {posGames.map(g => (
        <GameStand key={g.id} game={g} ballPos={ballPos} visited={visitedIds.has(g.id)} />
      ))}
    </>
  )
}

// ── Minimap ───────────────────────────────────────────────────────────────────

function Minimap({ posGames, ballPos, visitedIdsRef }: {
  posGames: PositionedGame[]
  ballPos: MutableRefObject<THREE.Vector3>
  visitedIdsRef: MutableRefObject<Set<string>>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const SIZE = 130

  const bounds = useMemo(() => {
    const xs = posGames.map(g => g.pos[0])
    const zs = posGames.map(g => g.pos[2])
    return {
      xMin: Math.min(...xs) - 14, xMax: Math.max(...xs) + 14,
      zMin: Math.min(...zs) - 14, zMax: 10,
    }
  }, [posGames])

  useEffect(() => {
    let raf: number
    const W = SIZE, H = SIZE, PAD = 12
    const { xMin, xMax, zMin, zMax } = bounds
    const mx = (x: number) => PAD + (x - xMin) / (xMax - xMin) * (W - 2 * PAD)
    const mz = (z: number) => H - PAD - (z - zMin) / (zMax - zMin) * (H - 2 * PAD)

    const draw = () => {
      const canvas = canvasRef.current
      if (!canvas) { raf = requestAnimationFrame(draw); return }
      const ctx = canvas.getContext('2d')!

      ctx.clearRect(0, 0, W, H)
      ctx.fillStyle = 'rgba(255,255,255,0.93)'
      ctx.beginPath(); ctx.roundRect(0, 0, W, H, 10); ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.07)'; ctx.lineWidth = 1; ctx.stroke()

      // Zone patches
      ZONE_NAMES.forEach(zoneName => {
        const zoneGames = posGames.filter(g => g.zone === zoneName)
        if (zoneGames.length === 0) return
        const { color, offset: [ox, oz] } = GENRE_ZONES[zoneName]
        const rows = Math.ceil(zoneGames.length / LOCAL_COLS)
        const rx = LOCAL_SPREAD_X * (LOCAL_COLS / 2) + 8
        const rz = (rows * LOCAL_SPREAD_Z) / 2 + 8
        const cz = oz - ((rows - 1) * LOCAL_SPREAD_Z) / 2
        ctx.fillStyle = color + '22'
        ctx.fillRect(mx(ox - rx), mz(cz + rz), mx(ox + rx) - mx(ox - rx), mz(cz - rz) - mz(cz + rz))
      })

      // Stands colored by zone
      posGames.forEach(g => {
        const vis = visitedIdsRef.current.has(g.id)
        ctx.fillStyle = vis ? '#22c55e' : (GENRE_ZONES[g.zone]?.color ?? '#9ca3af')
        ctx.beginPath()
        ctx.arc(mx(g.pos[0]), mz(g.pos[2]), vis ? 4 : 2.5, 0, Math.PI * 2)
        ctx.fill()
      })

      // Player
      const bx = mx(ballPos.current.x), bz = mz(ballPos.current.z)
      ctx.fillStyle = '#f4b400'
      ctx.beginPath(); ctx.arc(bx, bz, 5, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke()

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [posGames, bounds, visitedIdsRef])

  return (
    <canvas ref={canvasRef} width={SIZE} height={SIZE} style={{
      position: 'absolute', bottom: 20, left: 20,
      borderRadius: 10, pointerEvents: 'none',
      boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
    }} />
  )
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({ game, query, gameMap, onClose, onNavigate }: {
  game: Game
  query: string
  gameMap: Map<string, Game>
  onClose: () => void
  onNavigate: (id: string) => void
}) {
  const [verdict, setVerdict] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setVerdict(null); setLoading(true)
    fetch(`/api/ai/take?game_id=${encodeURIComponent(game.id)}&q=${encodeURIComponent(query)}`)
      .then(r => r.json())
      .then(d => { setVerdict(d.verdict || null); setLoading(false) })
      .catch(() => setLoading(false))
  }, [game.id, query])

  const similarGames = (game.similar_ids ?? [])
    .map(id => gameMap.get(id))
    .filter(Boolean) as Game[]

  const releaseYear = game.release_date?.match(/\b(19|20)\d{2}\b/)?.[0] ?? null
  const priceLabel  = game.price_usd == null ? null : game.price_usd === 0 ? 'Free' : `$${game.price_usd.toFixed(2)}`

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(248,248,250,0.96)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif', zIndex: 20,
    }}>
      <div style={{
        background: '#fff', border: '1px solid #e4e4e4', borderRadius: 16,
        padding: '32px 40px', maxWidth: 600, width: '92%',
        maxHeight: '88vh', overflowY: 'auto',
        boxShadow: '0 8px 48px rgba(0,0,0,0.1)',
      }}>
        <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
          {game.image_url && (
            <img src={game.image_url} alt={game.name}
              style={{ width: 100, height: 130, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
          )}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <p style={{ color: GENRE_ZONES[getZone(game)]?.color ?? '#888', fontSize: 10, fontWeight: 700, letterSpacing: 3, margin: 0, textTransform: 'uppercase' }}>
                {getZone(game)}
              </p>
              <p style={{ color: game.source === 'amazon' ? '#ff9900' : '#1b2838', fontSize: 10, fontWeight: 700, letterSpacing: 2, margin: 0, textTransform: 'uppercase' }}>
                {game.source}
              </p>
            </div>
            <h2 style={{ color: '#111', margin: '0 0 8px', fontSize: 20, lineHeight: 1.3 }}>{game.name}</h2>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              {game.avg_rating != null && (
                <span style={{ color: '#f4b400', fontSize: 16, fontWeight: 700 }}>★ {game.avg_rating.toFixed(1)}</span>
              )}
              {game.score != null && (
                <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, background: '#ede9ff', color: '#7c3aed', fontWeight: 700 }}>
                  {Math.round(game.score * 100)}% match
                </span>
              )}
              {priceLabel && (
                <span style={{ fontSize: 13, color: '#22c55e', fontWeight: 700 }}>{priceLabel}</span>
              )}
              {releaseYear && (
                <span style={{ fontSize: 12, color: '#aaa' }}>{releaseYear}</span>
              )}
            </div>
            {game.sentiment != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ height: 6, width: 100, background: '#e8e8e8', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.round(game.sentiment * 100)}%`, background: '#22c55e' }} />
                </div>
                <span style={{ fontSize: 11, color: '#888' }}>{Math.round(game.sentiment * 100)}% positive</span>
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(game.top_tags ?? []).slice(0, 5).map(t => (
                <span key={t} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 12, background: '#f4f4f4', color: '#666' }}>{t}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Claude's Take */}
        <div style={{
          background: 'linear-gradient(135deg, #fafafa, #f5f0ff)',
          border: '1px solid #ede8ff', borderRadius: 12,
          padding: '14px 18px', marginBottom: 20, minHeight: 60,
        }}>
          <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, letterSpacing: 3, color: '#7c3aed', textTransform: 'uppercase' }}>
            ✦ Claude's Take
          </p>
          {loading ? (
            <p style={{ margin: 0, fontSize: 13, color: '#aaa', fontStyle: 'italic' }}>Reading reviews…</p>
          ) : verdict ? (
            <p style={{ margin: 0, fontSize: 14, color: '#222', lineHeight: 1.7 }}>{verdict}</p>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: '#bbb', fontStyle: 'italic' }}>Set ANTHROPIC_API_KEY to enable AI verdicts.</p>
          )}
        </div>

        <p style={{ color: '#444', lineHeight: 1.8, fontSize: 14, margin: '0 0 24px' }}>{game.description}</p>

        {game.top_reviews.length > 0 && (
          <>
            <p style={{ color: '#aaa', fontSize: 11, fontWeight: 700, letterSpacing: 3, margin: '0 0 12px', textTransform: 'uppercase' }}>Top Reviews</p>
            {game.top_reviews.map((r, i) => (
              <div key={i} style={{ background: '#fafafa', borderRadius: 10, padding: '14px 18px', marginBottom: 10, borderLeft: '3px solid #f4b400' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ color: '#555', fontSize: 12, fontWeight: 600 }}>{r.reviewer}</span>
                  {r.rating != null && <span style={{ color: '#f4b400', fontSize: 12, fontWeight: 700 }}>★ {r.rating}</span>}
                </div>
                {r.summary && <p style={{ color: '#222', fontSize: 13, margin: '0 0 4px', fontWeight: 600 }}>{r.summary}</p>}
                <p style={{ color: '#666', fontSize: 13, margin: 0, lineHeight: 1.6 }}>{r.text}</p>
              </div>
            ))}
          </>
        )}

        {/* Similar games */}
        {similarGames.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <p style={{ color: '#aaa', fontSize: 11, fontWeight: 700, letterSpacing: 3, margin: '0 0 10px', textTransform: 'uppercase' }}>
              ── Similar in this collection ──
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {similarGames.map(sg => (
                <button
                  key={sg.id}
                  onClick={() => { onClose(); onNavigate(sg.id) }}
                  style={{
                    fontSize: 12, padding: '6px 14px', borderRadius: 20,
                    border: '1px solid #e0e0e0', background: '#fafafa', color: '#333',
                    cursor: 'pointer', fontFamily: 'system-ui, sans-serif',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f0f0f0')}
                  onMouseLeave={e => (e.currentTarget.style.background = '#fafafa')}
                >
                  🎮 {sg.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <button onClick={onClose} style={{
          marginTop: 8, width: '100%', background: '#111', color: '#fff',
          border: 'none', borderRadius: 10, padding: '14px 0',
          fontSize: 14, cursor: 'pointer', fontWeight: 600, letterSpacing: 1,
        }}>← Back to world</button>
      </div>
    </div>
  )
}

// ── ArcadeWorld ───────────────────────────────────────────────────────────────

export default function ArcadeWorld({ games, query, onSearch, onExit }: {
  games: Game[]
  query: string
  onSearch: (q: string) => void
  onExit: () => void
}) {
  const keys          = useRef({ w: false, s: false, a: false, d: false })
  const ballPos       = useRef(new THREE.Vector3(0, 0.5, 4))
  const velRef        = useRef(new THREE.Vector3())
  const visitedIdsRef = useRef(new Set<string>())
  const camYaw        = useRef(Math.PI)   // start facing forward (into the world)
  const camPitch      = useRef(-0.2)      // slight downward tilt
  const containerRef  = useRef<HTMLDivElement>(null)
  const [locked, setLocked] = useState(false)

  const [nearGame,    setNearGame]    = useState<Game | null>(null)
  const [selected,    setSelected]    = useState<Game | null>(null)
  const [visitedIds,  setVisitedIds]  = useState<Set<string>>(new Set())
  const [searchOpen,  setSearchOpen]  = useState(false)
  const [searchInput, setSearchInput] = useState('')

  const posGames = useMemo(() => computeZoneLayout(games), [games])
  const gameMap  = useMemo(() => new Map(games.map(g => [g.id, g])), [games])

  const openGame = useCallback((g: Game) => {
    setSelected(g)
    if (!visitedIdsRef.current.has(g.id)) {
      visitedIdsRef.current = new Set([...visitedIdsRef.current, g.id])
      setVisitedIds(new Set(visitedIdsRef.current))
    }
  }, [])

  const navigateTo = useCallback((gameId: string) => {
    const target = posGames.find(g => g.id === gameId)
    if (!target) return
    ballPos.current.set(target.pos[0], 0.5, target.pos[2] + 7)
    velRef.current.set(0, 0, 0)
    setSelected(null)
  }, [posGames])

  const submitSearch = useCallback(() => {
    if (!searchInput.trim()) return
    onSearch(searchInput)
    ballPos.current.set(0, 0.5, 4)
    velRef.current.set(0, 0, 0)
    visitedIdsRef.current = new Set()
    setVisitedIds(new Set())
    setSearchOpen(false)
    setSearchInput('')
  }, [searchInput, onSearch])

  // Pointer lock — mouse controls camera yaw/pitch
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== containerRef.current) return
      camYaw.current   += e.movementX * 0.003
      camPitch.current  = Math.max(-0.6, Math.min(0.3, camPitch.current + e.movementY * 0.002))
    }
    const onLockChange = () => {
      setLocked(document.pointerLockElement === containerRef.current)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('pointerlockchange', onLockChange)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('pointerlockchange', onLockChange)
    }
  }, [])

  const requestLock = useCallback(() => {
    if (!selected && !searchOpen) containerRef.current?.requestPointerLock()
  }, [selected, searchOpen])

  // Proximity polling
  useEffect(() => {
    let raf: number
    const poll = () => {
      let best: PositionedGame | null = null
      let bestD = PROX
      posGames.forEach(g => {
        const d = Math.hypot(ballPos.current.x - g.pos[0], ballPos.current.z - g.pos[2])
        if (d < bestD) { bestD = d; best = g }
      })
      setNearGame(prev => prev?.id === best?.id ? prev : best)
      raf = requestAnimationFrame(poll)
    }
    raf = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(raf)
  }, [posGames])

  // Keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (searchOpen) {
        if (e.key === 'Enter') submitSearch()
        if (e.key === 'Escape') setSearchOpen(false)
        return
      }
      if (e.key === 'w' || e.key === 'ArrowUp')    { e.preventDefault(); keys.current.w = true }
      if (e.key === 's' || e.key === 'ArrowDown')  { e.preventDefault(); keys.current.s = true }
      if (e.key === 'a' || e.key === 'ArrowLeft')  { e.preventDefault(); keys.current.a = true }
      if (e.key === 'd' || e.key === 'ArrowRight') { e.preventDefault(); keys.current.d = true }
      if ((e.key === 'e' || e.key === 'E' || e.key === ' ') && nearGame) openGame(nearGame)
      if (e.key === 'Escape') {
        if (locked) { document.exitPointerLock(); return }
        if (!selected) onExit()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'w' || e.key === 'ArrowUp')    keys.current.w = false
      if (e.key === 's' || e.key === 'ArrowDown')  keys.current.s = false
      if (e.key === 'a' || e.key === 'ArrowLeft')  keys.current.a = false
      if (e.key === 'd' || e.key === 'ArrowRight') keys.current.d = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [nearGame, selected, searchOpen, onExit, openGame, submitSearch])

  const touchKey = useCallback((k: keyof typeof keys.current, v: boolean) => {
    keys.current[k] = v
  }, [])

  return (
    <div ref={containerRef} style={{ position: 'fixed', inset: 0, background: '#f5f5f5', cursor: locked ? 'none' : 'default' }}
      onClick={requestLock}
    >
      <Canvas
        camera={{ fov: 62, position: [0, 7, 13], near: 0.1, far: 260 }}
        shadows gl={{ antialias: true }}
      >
        <Suspense fallback={null}>
          <Scene posGames={posGames} ballPos={ballPos} velRef={velRef} keys={keys} visitedIds={visitedIds} camYaw={camYaw} camPitch={camPitch} />
        </Suspense>
      </Canvas>

      {/* Click-to-aim hint */}
      {!locked && !selected && !searchOpen && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none', textAlign: 'center',
          fontFamily: 'system-ui, sans-serif', color: 'rgba(100,100,100,0.55)',
          fontSize: 12, letterSpacing: 2, userSelect: 'none',
        }}>
          CLICK TO AIM CAMERA WITH MOUSE
        </div>
      )}
      {locked && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 10, height: 10, borderRadius: '50%',
          background: 'rgba(255,255,255,0.6)',
          outline: '1px solid rgba(0,0,0,0.2)',
          pointerEvents: 'none',
        }} />
      )}

      {/* Top bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px', fontFamily: 'system-ui, sans-serif',
      }}>
        <button onClick={onExit} style={{
          background: '#fff', color: '#555', border: '1px solid #ddd', borderRadius: 8,
          padding: '7px 16px', fontSize: 13, cursor: 'pointer',
          boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
        }}>← Search</button>
        <span style={{ color: '#ccc', fontSize: 11, fontFamily: 'monospace', letterSpacing: 2 }}>
          {games.length} RESULTS &nbsp;·&nbsp; {visitedIds.size} VISITED
        </span>
        <button
          onClick={() => { setSearchOpen(v => !v); setSearchInput('') }}
          style={{
            background: searchOpen ? '#f0f0f0' : '#fff', color: '#555',
            border: '1px solid #ddd', borderRadius: 8,
            padding: '7px 14px', fontSize: 13, cursor: 'pointer',
            boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
          }}
        >
          🔍 Search
        </button>
      </div>

      {/* In-world search overlay */}
      {searchOpen && (
        <div style={{
          position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', gap: 8, alignItems: 'center',
          background: 'rgba(255,255,255,0.97)', border: '1px solid #e0e0e0',
          borderRadius: 30, padding: '10px 16px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
          zIndex: 10,
        }}>
          <input
            autoFocus
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder={`New search (was: "${query}")`}
            style={{
              width: 260, border: 'none', outline: 'none',
              fontSize: 14, fontFamily: 'system-ui, sans-serif', background: 'transparent',
            }}
          />
          <button
            onClick={submitSearch}
            style={{
              background: '#111', color: '#fff', border: 'none', borderRadius: 20,
              padding: '6px 16px', fontSize: 13, cursor: 'pointer', fontFamily: 'system-ui, sans-serif',
            }}
          >
            Go
          </button>
        </div>
      )}

      {/* Near HUD */}
      {nearGame && !selected && !searchOpen && (
        <div style={{
          position: 'absolute', bottom: 68, left: '50%', transform: 'translateX(-50%)',
          pointerEvents: 'none',
        }}>
          <button
            onClick={() => openGame(nearGame)}
            style={{
              pointerEvents: 'all',
              background: '#fff', border: '1px solid #e0e0e0', borderRadius: 24,
              padding: '10px 24px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(0,0,0,0.1)', color: '#222',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            {visitedIds.has(nearGame.id) ? '↩ Revisit' : 'View details'}
            &nbsp;<span style={{ color: '#bbb', fontWeight: 400, fontSize: 11 }}>Space / E</span>
          </button>
        </div>
      )}

      {/* Bottom hint */}
      {!selected && !searchOpen && (
        <div style={{
          position: 'absolute', bottom: 22, left: '50%', transform: 'translateX(-50%)',
          fontFamily: 'monospace', fontSize: 10, color: '#ccc', letterSpacing: 2,
          pointerEvents: 'none', whiteSpace: 'nowrap', userSelect: 'none',
        }}>
          {nearGame ? '— SPACE / E TO VIEW —' : locked ? 'WASD / ARROWS TO ROLL · ESC TO RELEASE MOUSE' : 'WASD TO ROLL · CLICK TO AIM'}
        </div>
      )}

      {/* Minimap */}
      <Minimap posGames={posGames} ballPos={ballPos} visitedIdsRef={visitedIdsRef} />

      {/* Mobile d-pad */}
      <div style={{
        position: 'absolute', bottom: 20, right: 20,
        display: 'grid', gridTemplateColumns: '44px 44px 44px', gridTemplateRows: '44px 44px', gap: 4,
      }}>
        {([
          { lbl: '↑', k: 'w' as const, col: 2, row: 1 },
          { lbl: '←', k: 'a' as const, col: 1, row: 2 },
          { lbl: '↓', k: 's' as const, col: 2, row: 2 },
          { lbl: '→', k: 'd' as const, col: 3, row: 2 },
        ] as const).map(b => (
          <button key={b.k}
            onPointerDown={() => touchKey(b.k, true)}
            onPointerUp={() => touchKey(b.k, false)}
            onPointerLeave={() => touchKey(b.k, false)}
            style={{
              gridColumn: b.col, gridRow: b.row,
              background: 'rgba(255,255,255,0.92)', border: '1px solid #ddd', borderRadius: 8,
              color: '#888', fontSize: 15, cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(0,0,0,0.07)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              touchAction: 'none', userSelect: 'none',
            }}
          >
            {b.lbl}
          </button>
        ))}
      </div>

      {selected && (
        <DetailPanel
          game={selected}
          query={query}
          gameMap={gameMap}
          onClose={() => setSelected(null)}
          onNavigate={navigateTo}
        />
      )}
    </div>
  )
}
