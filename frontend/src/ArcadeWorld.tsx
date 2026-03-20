import {
  useRef, useState, useEffect, Suspense, useCallback, MutableRefObject, useMemo,
} from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { Game } from './types'

// ── Constants ─────────────────────────────────────────────────────────────────

const PROX  = 5.0
const FORCE = 70
const DAMP  = 0.90
const MAXSPD = 30
const MAX_GAMES = 10

const FALLBACK_IMG = 'https://placehold.co/460x215/1b2838/c7d5e0?text=No+Image'

// ── Layout — two rows of 5, spread out on the grid ───────────────────────────

interface PositionedGame extends Game {
  pos: [number, number, number]
  idx: number
}

function computeLayout(games: Game[]): PositionedGame[] {
  const count = Math.min(games.length, MAX_GAMES)
  const result: PositionedGame[] = []
  const cols = 5
  const spacingX = 8
  const spacingZ = 12
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols)
    const col = i % cols
    const x = (col - (cols - 1) / 2) * spacingX
    const z = -(row * spacingZ) - 12
    result.push({ ...games[i], pos: [x, 0, z], idx: i })
  }
  return result
}

// ── Cover image (manual TextureLoader for reliable cross-origin loading) ─────

const textureLoader = new THREE.TextureLoader()
textureLoader.crossOrigin = 'anonymous'

function CoverImage({ url }: { url: string }) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null)
  const [failed, setFailed]   = useState(false)

  useEffect(() => {
    if (!url || url === FALLBACK_IMG) { setFailed(true); return }
    setTexture(null)
    setFailed(false)
    textureLoader.load(
      url,
      (tex) => { tex.colorSpace = THREE.SRGBColorSpace; setTexture(tex) },
      undefined,
      () => setFailed(true),
    )
  }, [url])

  if (failed || (!texture && !url)) {
    return (
      <mesh position={[0, 0.5, 0.046]}>
        <planeGeometry args={[2.5, 2.9]} />
        <meshStandardMaterial color="#1a0a2e" />
      </mesh>
    )
  }

  return (
    <mesh position={[0, 0.5, 0.046]}>
      <planeGeometry args={[2.5, 2.9]} />
      {texture
        ? <meshBasicMaterial map={texture} />
        : <meshStandardMaterial color="#1a0a2e" />
      }
    </mesh>
  )
}

// ── Game stand ───────────────────────────────────────────────────────────────

function GameStand({ game, ballPos, visited }: {
  game: PositionedGame
  ballPos: MutableRefObject<THREE.Vector3>
  visited: boolean
}) {
  const groupRef = useRef<THREE.Group>(null)
  const leanRef  = useRef(0)
  const [active, setActive] = useState(false)

  useFrame(() => {
    const g = groupRef.current
    if (!g) return
    const dx = ballPos.current.x - game.pos[0]
    const dz = ballPos.current.z - game.pos[2]
    const near = Math.sqrt(dx * dx + dz * dz) < PROX
    if (near !== active) setActive(near)
    leanRef.current = THREE.MathUtils.lerp(leanRef.current, near ? -0.14 : 0, 0.1)
    g.rotation.x = leanRef.current
    g.position.y = Math.sin(Date.now() * 0.0015 + game.idx) * 0.06
  })

  const ratingStr  = game.avg_rating != null ? `★ ${game.avg_rating.toFixed(1)}` : ''
  const matchPct   = game.score != null ? `${Math.round(game.score * 100)}%` : null
  const releaseYear = game.release_date?.match(/\b(19|20)\d{2}\b/)?.[0] ?? null
  const priceLabel  = game.price_usd == null ? null : game.price_usd === 0 ? 'Free' : `$${game.price_usd.toFixed(2)}`

  return (
    <group ref={groupRef} position={game.pos}>
      {/* Card */}
      <mesh castShadow>
        <boxGeometry args={[2.7, 3.6, 0.08]} />
        <meshStandardMaterial color="#1a0a2e" roughness={0.1} metalness={0.3} />
      </mesh>

      {/* Neon border */}
      <mesh position={[0, 0, -0.01]}>
        <boxGeometry args={[2.84, 3.74, 0.02]} />
        <meshStandardMaterial color="#ff00ff" emissive="#ff00ff" emissiveIntensity={active ? 1.5 : 0.4} transparent opacity={0.8} />
      </mesh>

      {/* Cover art */}
      <CoverImage url={game.image_url} />

      {/* Rank badge */}
      <mesh position={[-1.1, 1.6, 0.05]}>
        <circleGeometry args={[0.45, 24]} />
        <meshStandardMaterial color="#00ffff" emissive="#00ffff" emissiveIntensity={0.8} />
      </mesh>
      <Html center position={[-1.1, 1.6, 0.08]}>
        <div style={{ fontSize: 28, fontWeight: 900, color: '#0a0a2e', pointerEvents: 'none', userSelect: 'none', fontFamily: "'Press Start 2P', monospace", textShadow: '0 0 4px rgba(0,255,255,0.5)' }}>
          #{game.idx + 1}
        </div>
      </Html>

      {/* Game name */}
      <Html center distanceFactor={5} position={[0, -1.15, 0.06]}>
        <div style={{
          fontSize: 20, fontWeight: 700, color: '#e0d0ff',
          fontFamily: "'Space Mono', monospace", textAlign: 'center',
          maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', pointerEvents: 'none', userSelect: 'none',
          textShadow: '0 0 10px #ff00ff',
        }}>
          {game.name}
        </div>
      </Html>

      {/* Post */}
      <mesh position={[0, -2.3, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 1.0, 8]} />
        <meshStandardMaterial color="#ff00ff" emissive="#ff00ff" emissiveIntensity={0.6} />
      </mesh>

      {/* Base glow ring */}
      <mesh position={[0, -2.8, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.3, 0.55, 32]} />
        <meshStandardMaterial
          color={active ? '#00ffff' : visited ? '#ff00ff' : '#8800aa'}
          emissive={active ? '#00ffff' : visited ? '#ff00ff' : '#8800aa'}
          emissiveIntensity={active ? 2.5 : visited ? 1.5 : 0.5}
          transparent opacity={0.8}
        />
      </mesh>

      {/* Tooltip */}
      {active && (
        <Html center position={[0, 3.0, 0]}>
          <div style={{
            background: 'rgba(10,5,30,0.95)', border: '2px solid #ff00ff88',
            borderRadius: 16, padding: '18px 28px',
            fontFamily: "'Space Mono', monospace", textAlign: 'center',
            boxShadow: '0 0 30px rgba(255,0,255,0.4)',
            pointerEvents: 'none', whiteSpace: 'nowrap', minWidth: 280,
          }}>
            <p style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: '#e0d0ff', maxWidth: 350, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {game.name}
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', fontSize: 18, flexWrap: 'wrap', marginBottom: 8 }}>
              {ratingStr   && <span style={{ color: '#ffdd00', fontWeight: 700 }}>{ratingStr}</span>}
              {matchPct    && <span style={{ color: '#00ffff', fontWeight: 700 }}>{matchPct} match</span>}
              {priceLabel  && <span style={{ color: '#00ff88', fontWeight: 700 }}>{priceLabel}</span>}
              {releaseYear && <span style={{ color: '#aa88cc' }}>{releaseYear}</span>}
              {visited     && <span style={{ color: '#ff00ff', fontWeight: 700 }}>✓</span>}
            </div>
            {(game.top_tags ?? []).length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 8 }}>
                {(game.top_tags ?? []).slice(0, 3).map(t => (
                  <span key={t} style={{ fontSize: 15, padding: '3px 10px', borderRadius: 8, background: '#2a1a4e', color: '#aa88cc' }}>{t}</span>
                ))}
              </div>
            )}
            {(game.sentiment ?? null) != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                <div style={{ height: 8, width: 120, background: '#2a1a4e', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.round((game.sentiment ?? 0) * 100)}%`, background: '#00ffff', borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 15, color: '#aa88cc' }}>{Math.round((game.sentiment ?? 0) * 100)}% pos</span>
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  )
}

// ── Player (person figure) ───────────────────────────────────────────────────

function Player({ ballPos, velRef, keys, camYaw }: {
  ballPos: MutableRefObject<THREE.Vector3>
  velRef: MutableRefObject<THREE.Vector3>
  keys: MutableRefObject<{ w: boolean; s: boolean; a: boolean; d: boolean }>
  camYaw: MutableRefObject<number>
}) {
  const groupRef = useRef<THREE.Group>(null)
  const _fwd   = new THREE.Vector3()
  const _right = new THREE.Vector3()

  useFrame((_, dt) => {
    _fwd.set(Math.sin(camYaw.current), 0, Math.cos(camYaw.current)).normalize()
    _right.set(Math.cos(camYaw.current), 0, -Math.sin(camYaw.current)).normalize()

    const { w, s, a, d } = keys.current
    if (w) velRef.current.addScaledVector(_fwd,    FORCE * dt)
    if (s) velRef.current.addScaledVector(_fwd,   -FORCE * dt)
    if (a) velRef.current.addScaledVector(_right,  FORCE * dt)
    if (d) velRef.current.addScaledVector(_right, -FORCE * dt)

    velRef.current.multiplyScalar(DAMP)
    const spd = velRef.current.length()
    if (spd > MAXSPD) velRef.current.multiplyScalar(MAXSPD / spd)

    ballPos.current.addScaledVector(velRef.current, dt)
    const speed = velRef.current.length()
    const bob = speed > 0.5 ? Math.sin(Date.now() * 0.01) * 0.06 * Math.min(speed / MAXSPD, 1) : 0
    ballPos.current.y = bob

    if (groupRef.current) {
      groupRef.current.position.copy(ballPos.current)
      // Face movement direction so you can see which way you're going
      if (speed > 1) {
        const targetRot = Math.atan2(velRef.current.x, velRef.current.z)
        groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, targetRot, 0.15)
      }
    }
  })

  return (
    <group ref={groupRef} position={[0, 0, 4]}>
      {/* Legs */}
      <mesh position={[-0.12, 0.45, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.1, 0.8, 8]} />
        <meshStandardMaterial color="#1a0a3e" emissive="#8800ff" emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0.12, 0.45, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.1, 0.8, 8]} />
        <meshStandardMaterial color="#1a0a3e" emissive="#8800ff" emissiveIntensity={0.3} />
      </mesh>
      {/* Body */}
      <mesh position={[0, 1.15, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.28, 0.9, 10]} />
        <meshStandardMaterial color="#2a1a5e" emissive="#8800ff" emissiveIntensity={0.4} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 1.85, 0]} castShadow>
        <sphereGeometry args={[0.22, 16, 16]} />
        <meshStandardMaterial color="#00ffff" emissive="#00ffff" emissiveIntensity={1.5} />
      </mesh>
      {/* Face direction indicator (nose/visor) */}
      <mesh position={[0, 1.85, 0.22]} castShadow>
        <boxGeometry args={[0.18, 0.08, 0.06]} />
        <meshStandardMaterial color="#ff00ff" emissive="#ff00ff" emissiveIntensity={2} />
      </mesh>
      {/* Arms */}
      <mesh position={[-0.35, 1.1, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.06, 0.7, 6]} />
        <meshStandardMaterial color="#2a1a5e" emissive="#8800ff" emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0.35, 1.1, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.06, 0.7, 6]} />
        <meshStandardMaterial color="#2a1a5e" emissive="#8800ff" emissiveIntensity={0.3} />
      </mesh>
      {/* Glow light */}
      <pointLight position={[0, 2.2, 0]} intensity={1.5} color="#00ffff" distance={6} />
    </group>
  )
}

// ── Camera ───────────────────────────────────────────────────────────────────

function CameraRig({ ballPos, camYaw, camPitch }: {
  ballPos: MutableRefObject<THREE.Vector3>
  camYaw: MutableRefObject<number>
  camPitch: MutableRefObject<number>
}) {
  const { camera } = useThree()
  const lookAt = useRef(new THREE.Vector3(0, 0.5, 0))

  useFrame(() => {
    const pos = ballPos.current
    const dist = 8, height = Math.max(3, 8 + camPitch.current * 7)
    const cx = pos.x - Math.sin(camYaw.current) * dist
    const cz = pos.z - Math.cos(camYaw.current) * dist
    const desired = new THREE.Vector3(cx, pos.y + height, cz)
    camera.position.lerp(desired, 0.09)
    lookAt.current.lerp(new THREE.Vector3(pos.x, pos.y + 0.5, pos.z), 0.12)
    camera.lookAt(lookAt.current)
  })
  return null
}

// ── Synthwave Grid Floor ─────────────────────────────────────────────────────

function RetroGrid() {
  const gridRef = useRef<THREE.ShaderMaterial>(null)

  const shader = useMemo(() => ({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      varying float vDist;
      void main() {
        vUv = uv;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vDist = length(mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying float vDist;
      uniform float uTime;
      void main() {
        vec2 uv = vUv * 80.0;
        uv.y += uTime * 2.0;
        vec2 grid = abs(fract(uv - 0.5) - 0.5) / fwidth(uv);
        float line = min(grid.x, grid.y);
        float gridVal = 1.0 - min(line, 1.0);

        float fade = smoothstep(120.0, 20.0, vDist);
        float centerGlow = smoothstep(0.7, 0.0, abs(vUv.x - 0.5)) * smoothstep(0.7, 0.0, abs(vUv.y - 0.5));

        vec3 lineColor = mix(vec3(0.6, 0.0, 1.0), vec3(0.0, 1.0, 1.0), centerGlow);
        vec3 col = lineColor * gridVal * fade;
        col += vec3(0.6, 0.0, 1.0) * centerGlow * 0.15 * fade;
        gl_FragColor = vec4(col, gridVal * fade * 0.9 + centerGlow * 0.1);
      }
    `,
  }), [])

  useFrame((_, dt) => {
    if (gridRef.current) gridRef.current.uniforms.uTime.value += dt
  })

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.35, 0]}>
      <planeGeometry args={[200, 200, 1, 1]} />
      <shaderMaterial ref={gridRef} args={[shader]} transparent depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

// ── Horizon glow ─────────────────────────────────────────────────────────────

function HorizonGlow() {
  return (
    <group>
      {/* Horizontal neon line */}
      <mesh position={[0, -1.5, -80]}>
        <planeGeometry args={[300, 0.8]} />
        <meshBasicMaterial color="#00ddff" transparent opacity={0.6} />
      </mesh>
      {/* Glow bloom behind */}
      <mesh position={[0, 2, -85]}>
        <planeGeometry args={[300, 30]} />
        <meshBasicMaterial color="#ff00ff" transparent opacity={0.08} />
      </mesh>
      <mesh position={[0, -0.5, -82]}>
        <planeGeometry args={[300, 6]} />
        <meshBasicMaterial color="#00ccff" transparent opacity={0.12} />
      </mesh>
    </group>
  )
}

// ── Scene ────────────────────────────────────────────────────────────────────

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
      <color attach="background" args={['#0a0520']} />
      <fog attach="fog" args={['#0a0520', 40, 120]} />

      <ambientLight intensity={0.15} color="#8844cc" />
      <directionalLight position={[0, 15, -10]} intensity={0.3} color="#ff88ff" />
      <pointLight position={[0, 8, -40]} intensity={1} color="#00ccff" distance={80} />
      <pointLight position={[0, 3, 0]} intensity={0.4} color="#ff00ff" distance={30} />

      <RetroGrid />
      <HorizonGlow />

      <Player ballPos={ballPos} velRef={velRef} keys={keys} camYaw={camYaw} />
      <CameraRig ballPos={ballPos} camYaw={camYaw} camPitch={camPitch} />

      {posGames.map(g => (
        <GameStand key={g.id} game={g} ballPos={ballPos} visited={visitedIds.has(g.id)} />
      ))}
    </>
  )
}

// ── Minimap ──────────────────────────────────────────────────────────────────

function Minimap({ posGames, ballPos, visitedIdsRef }: {
  posGames: PositionedGame[]
  ballPos: MutableRefObject<THREE.Vector3>
  visitedIdsRef: MutableRefObject<Set<string>>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const SIZE = 120

  const bounds = useMemo(() => {
    if (posGames.length === 0) return { xMin: -20, xMax: 20, zMin: -30, zMax: 10 }
    const xs = posGames.map(g => g.pos[0])
    const zs = posGames.map(g => g.pos[2])
    return { xMin: Math.min(...xs) - 10, xMax: Math.max(...xs) + 10, zMin: Math.min(...zs) - 10, zMax: 10 }
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

      ctx.fillStyle = 'rgba(10,5,32,0.9)'
      ctx.beginPath(); ctx.roundRect(0, 0, W, H, 8); ctx.fill()
      ctx.strokeStyle = 'rgba(255,0,255,0.3)'; ctx.lineWidth = 1; ctx.stroke()

      // Grid lines
      ctx.strokeStyle = 'rgba(128,0,255,0.15)'; ctx.lineWidth = 0.5
      for (let i = 0; i <= 8; i++) {
        const y = PAD + (i / 8) * (H - 2 * PAD)
        ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke()
        const x = PAD + (i / 8) * (W - 2 * PAD)
        ctx.beginPath(); ctx.moveTo(x, PAD); ctx.lineTo(x, H - PAD); ctx.stroke()
      }

      posGames.forEach(g => {
        const vis = visitedIdsRef.current.has(g.id)
        ctx.fillStyle = vis ? '#ff00ff' : '#8800cc'
        ctx.shadowColor = vis ? '#ff00ff' : '#8800cc'
        ctx.shadowBlur = vis ? 6 : 3
        ctx.beginPath()
        ctx.arc(mx(g.pos[0]), mz(g.pos[2]), vis ? 4 : 3, 0, Math.PI * 2)
        ctx.fill()
      })

      ctx.shadowColor = '#00ffff'; ctx.shadowBlur = 8
      ctx.fillStyle = '#00ffff'
      ctx.beginPath(); ctx.arc(mx(ballPos.current.x), mz(ballPos.current.z), 4, 0, Math.PI * 2); ctx.fill()
      ctx.shadowBlur = 0

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [posGames, bounds, visitedIdsRef])

  return (
    <canvas ref={canvasRef} width={SIZE} height={SIZE} style={{
      position: 'absolute', bottom: 20, left: 20,
      borderRadius: 8, pointerEvents: 'none',
      boxShadow: '0 0 15px rgba(255,0,255,0.2)',
    }} />
  )
}

// ── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({ game, query, gameMap, onClose, onNavigate }: {
  game: Game; query: string; gameMap: Map<string, Game>
  onClose: () => void; onNavigate: (id: string) => void
}) {
  const [verdict, setVerdict] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setVerdict(null); setLoading(true)
    fetch(`/api/ai/take?game_id=${encodeURIComponent(game.id)}&q=${encodeURIComponent(query)}`)
      .then(r => r.json()).then(d => { setVerdict(d.verdict || null); setLoading(false) })
      .catch(() => setLoading(false))
  }, [game.id, query])

  const similarGames = (game.similar_ids ?? []).map(id => gameMap.get(id)).filter(Boolean) as Game[]
  const releaseYear = game.release_date?.match(/\b(19|20)\d{2}\b/)?.[0] ?? null
  const priceLabel  = game.price_usd == null ? null : game.price_usd === 0 ? 'Free' : `$${game.price_usd.toFixed(2)}`

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(10,5,32,0.96)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Space Mono', monospace", zIndex: 20,
    }}>
      <div style={{
        background: '#12082e', border: '1px solid #ff00ff44', borderRadius: 16,
        padding: '32px 40px', maxWidth: 600, width: '92%',
        maxHeight: '88vh', overflowY: 'auto',
        boxShadow: '0 0 40px rgba(255,0,255,0.15)',
      }}>
        <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
          {game.image_url && (
            <img src={game.image_url} alt={game.name}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
              style={{ width: 100, height: 130, objectFit: 'cover', borderRadius: 8, flexShrink: 0, border: '1px solid #ff00ff44' }} />
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

        <div style={{
          background: 'linear-gradient(135deg, #1a0a3e, #220e4e)',
          border: '1px solid #ff00ff33', borderRadius: 12,
          padding: '14px 18px', marginBottom: 20, minHeight: 60,
        }}>
          <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, letterSpacing: 3, color: '#00ffff', textTransform: 'uppercase', fontFamily: "'Press Start 2P', monospace" }}>
            Claude's Take
          </p>
          {loading ? (
            <p style={{ margin: 0, fontSize: 13, color: '#aa88cc', fontStyle: 'italic' }}>Reading reviews...</p>
          ) : verdict ? (
            <p style={{ margin: 0, fontSize: 14, color: '#e0d0ff', lineHeight: 1.7 }}>{verdict}</p>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: '#5a4080', fontStyle: 'italic' }}>Set ANTHROPIC_API_KEY to enable AI verdicts.</p>
          )}
        </div>

        <p style={{ color: '#aa88cc', lineHeight: 1.8, fontSize: 14, margin: '0 0 24px' }}>{game.description}</p>

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
                <button key={sg.id} onClick={() => { onClose(); onNavigate(sg.id) }}
                  style={{ fontSize: 12, padding: '6px 14px', borderRadius: 20, border: '1px solid #ff00ff44', background: '#1a0a3e', color: '#e0d0ff', cursor: 'pointer', fontFamily: "'Space Mono', monospace" }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#2a1a5e')}
                  onMouseLeave={e => (e.currentTarget.style.background = '#1a0a3e')}
                >{sg.name}</button>
              ))}
            </div>
          </div>
        )}

        <button onClick={onClose} style={{
          marginTop: 8, width: '100%',
          background: 'linear-gradient(90deg, #ff00ff, #8800ff)',
          color: '#fff', border: 'none', borderRadius: 10, padding: '14px 0',
          fontSize: 14, cursor: 'pointer', fontWeight: 600, letterSpacing: 1,
          fontFamily: "'Press Start 2P', monospace",
          boxShadow: '0 0 20px rgba(255,0,255,0.3)',
        }}>Back to grid</button>
      </div>
    </div>
  )
}

// ── ArcadeWorld ───────────────────────────────────────────────────────────────

export default function ArcadeWorld({ games, query, onSearch, onExit }: {
  games: Game[]; query: string; onSearch: (q: string) => void; onExit: () => void
}) {
  const keys          = useRef({ w: false, s: false, a: false, d: false })
  const ballPos       = useRef(new THREE.Vector3(0, 0.5, 4))
  const velRef        = useRef(new THREE.Vector3())
  const visitedIdsRef = useRef(new Set<string>())
  const containerRef  = useRef<HTMLDivElement>(null)
  const camYaw        = useRef(Math.PI)
  const camPitch      = useRef(-0.2)
  const [locked, setLocked] = useState(false)

  const [nearGame,    setNearGame]    = useState<Game | null>(null)
  const [selected,    setSelected]    = useState<Game | null>(null)
  const [visitedIds,  setVisitedIds]  = useState<Set<string>>(new Set())
  const [searchOpen,  setSearchOpen]  = useState(false)
  const [searchInput, setSearchInput] = useState('')

  const posGames = useMemo(() => computeLayout(games), [games])
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
    ballPos.current.set(target.pos[0], 0.5, target.pos[2] + 6)
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

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== containerRef.current) return
      camYaw.current   += e.movementX * 0.003
      camPitch.current  = Math.max(-0.6, Math.min(0.3, camPitch.current + e.movementY * 0.002))
    }
    const onLockChange = () => setLocked(document.pointerLockElement === containerRef.current)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('pointerlockchange', onLockChange)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('pointerlockchange', onLockChange) }
  }, [])

  const requestLock = useCallback(() => {
    if (!selected && !searchOpen) containerRef.current?.requestPointerLock()
  }, [selected, searchOpen])

  // Auto-lock pointer on mount
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const tryLock = () => el.requestPointerLock()
    el.addEventListener('click', tryLock, { once: true })
    el.click()
    return () => el.removeEventListener('click', tryLock)
  }, [])

  useEffect(() => {
    let raf: number
    const poll = () => {
      let best: PositionedGame | null = null, bestD = PROX
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

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (searchOpen) { if (e.key === 'Enter') submitSearch(); if (e.key === 'Escape') setSearchOpen(false); return }
      if (e.key === 'w' || e.key === 'ArrowUp')    { e.preventDefault(); keys.current.w = true }
      if (e.key === 's' || e.key === 'ArrowDown')  { e.preventDefault(); keys.current.s = true }
      if (e.key === 'a' || e.key === 'ArrowLeft')  { e.preventDefault(); keys.current.a = true }
      if (e.key === 'd' || e.key === 'ArrowRight') { e.preventDefault(); keys.current.d = true }
      if ((e.key === 'e' || e.key === 'E' || e.key === ' ') && nearGame) openGame(nearGame)
      if (e.key === 'Escape') { if (locked) { document.exitPointerLock(); return }; if (!selected) onExit() }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'w' || e.key === 'ArrowUp')    keys.current.w = false
      if (e.key === 's' || e.key === 'ArrowDown')  keys.current.s = false
      if (e.key === 'a' || e.key === 'ArrowLeft')  keys.current.a = false
      if (e.key === 'd' || e.key === 'ArrowRight') keys.current.d = false
    }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [nearGame, selected, searchOpen, onExit, openGame, submitSearch, locked])

  const touchKey = useCallback((k: keyof typeof keys.current, v: boolean) => { keys.current[k] = v }, [])

  return (
    <div ref={containerRef} style={{ position: 'fixed', inset: 0, background: '#0a0520', cursor: locked ? 'none' : 'default' }} onClick={requestLock}>
      <Canvas camera={{ fov: 62, position: [0, 7, 13], near: 0.1, far: 200 }} shadows gl={{ antialias: true }}>
        <Suspense fallback={null}>
          <Scene posGames={posGames} ballPos={ballPos} velRef={velRef} keys={keys} visitedIds={visitedIds} camYaw={camYaw} camPitch={camPitch} />
        </Suspense>
      </Canvas>

      {!locked && !selected && !searchOpen && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          pointerEvents: 'none', fontFamily: "'Press Start 2P', monospace",
          color: 'rgba(255,0,255,0.35)', fontSize: 10, letterSpacing: 2, userSelect: 'none',
        }}>CLICK TO AIM CAMERA</div>
      )}
      {locked && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 8, height: 8, borderRadius: '50%',
          background: 'rgba(0,255,255,0.7)', boxShadow: '0 0 10px rgba(0,255,255,0.5)',
          pointerEvents: 'none',
        }} />
      )}

      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px', fontFamily: "'Space Mono', monospace",
      }}>
        <button onClick={onExit} style={{
          background: 'rgba(10,5,32,0.9)', color: '#e0d0ff', border: '1px solid #ff00ff44', borderRadius: 8,
          padding: '7px 16px', fontSize: 13, cursor: 'pointer', boxShadow: '0 0 10px rgba(255,0,255,0.15)',
        }}>← Search</button>
        <span style={{ color: '#aa88cc', fontSize: 11, letterSpacing: 2 }}>
          {posGames.length} GAMES &nbsp;·&nbsp; {visitedIds.size} VISITED
        </span>
        <button onClick={() => { setSearchOpen(v => !v); setSearchInput('') }}
          style={{
            background: searchOpen ? '#2a1a5e' : 'rgba(10,5,32,0.9)', color: '#e0d0ff',
            border: '1px solid #ff00ff44', borderRadius: 8,
            padding: '7px 14px', fontSize: 13, cursor: 'pointer', boxShadow: '0 0 10px rgba(255,0,255,0.15)',
          }}
        >Search</button>
      </div>

      {searchOpen && (
        <div style={{
          position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', gap: 8, alignItems: 'center',
          background: 'rgba(10,5,32,0.97)', border: '1px solid #ff00ff55',
          borderRadius: 30, padding: '10px 16px', boxShadow: '0 0 25px rgba(255,0,255,0.2)', zIndex: 10,
        }}>
          <input autoFocus value={searchInput} onChange={e => setSearchInput(e.target.value)}
            placeholder={`New search (was: "${query}")`}
            style={{ width: 260, border: 'none', outline: 'none', fontSize: 14, fontFamily: "'Space Mono', monospace", background: 'transparent', color: '#e0d0ff' }}
          />
          <button onClick={submitSearch}
            style={{ background: 'linear-gradient(90deg, #ff00ff, #8800ff)', color: '#fff', border: 'none', borderRadius: 20, padding: '6px 16px', fontSize: 13, cursor: 'pointer', fontFamily: "'Press Start 2P', monospace" }}
          >Go</button>
        </div>
      )}

      {nearGame && !selected && !searchOpen && (
        <div style={{ position: 'absolute', bottom: 68, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none' }}>
          <button onClick={() => openGame(nearGame)}
            style={{
              pointerEvents: 'all', background: 'rgba(10,5,32,0.92)', border: '1px solid #ff00ff55', borderRadius: 24,
              padding: '10px 24px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 0 20px rgba(255,0,255,0.2)', color: '#e0d0ff', fontFamily: "'Space Mono', monospace",
            }}
          >
            {visitedIds.has(nearGame.id) ? 'Revisit' : 'View details'}
            &nbsp;<span style={{ color: '#aa88cc', fontWeight: 400, fontSize: 11 }}>Space / E</span>
          </button>
        </div>
      )}

      {!selected && !searchOpen && (
        <div style={{
          position: 'absolute', bottom: 22, left: '50%', transform: 'translateX(-50%)',
          fontFamily: "'Press Start 2P', monospace", fontSize: 8, color: '#ff00ff', letterSpacing: 2,
          pointerEvents: 'none', whiteSpace: 'nowrap', userSelect: 'none', opacity: 0.5,
        }}>
          {nearGame ? 'SPACE / E TO VIEW' : locked ? 'WASD TO MOVE · ESC TO RELEASE' : 'WASD TO MOVE · CLICK TO AIM'}
        </div>
      )}

      <Minimap posGames={posGames} ballPos={ballPos} visitedIdsRef={visitedIdsRef} />

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
            onPointerDown={() => touchKey(b.k, true)} onPointerUp={() => touchKey(b.k, false)} onPointerLeave={() => touchKey(b.k, false)}
            style={{
              gridColumn: b.col, gridRow: b.row,
              background: 'rgba(10,5,32,0.92)', border: '1px solid #ff00ff44', borderRadius: 8,
              color: '#ff00ff', fontSize: 15, cursor: 'pointer',
              boxShadow: '0 0 8px rgba(255,0,255,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              touchAction: 'none', userSelect: 'none',
            }}
          >{b.lbl}</button>
        ))}
      </div>

      {selected && (
        <DetailPanel game={selected} query={query} gameMap={gameMap}
          onClose={() => setSelected(null)} onNavigate={navigateTo} />
      )}
    </div>
  )
}
