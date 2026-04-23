import { useMemo } from 'react'
import './BackgroundBlocks.css'

interface Block {
  id: number
  left: number   // %
  top: number    // %
  size: number   // px
  delay: number  // s
  duration: number // s
  variant: 'slow' | 'fast'
}

const COUNT = 45

function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

function buildBlocks(seed = 7): Block[] {
  const rnd = seededRandom(seed)
  const blocks: Block[] = []
  for (let i = 0; i < COUNT; i++) {
    const size = Math.round(4 + rnd() * 16) // 4–20px, snappy pixel sizes
    const fast = rnd() < 0.12                // ~12% of blocks breathe a touch brighter
    blocks.push({
      id: i,
      left: rnd() * 100,
      top: rnd() * 100,
      size,
      delay: -rnd() * 12,                               // negative delay = already mid-cycle, no synchronized start-pop
      duration: fast ? 5 + rnd() * 3                    // 5–8s gentle breathe
                     : 8 + rnd() * 6,                   // 8–14s slow breathe
      variant: fast ? 'fast' : 'slow',
    })
  }
  return blocks
}

function BackgroundBlocks(): JSX.Element {
  const blocks = useMemo(() => buildBlocks(), [])
  return (
    <div className="bg-blocks" aria-hidden>
      {blocks.map(b => (
        <span
          key={b.id}
          className={`bg-block bg-block--${b.variant}`}
          style={{
            left: `${b.left}%`,
            top: `${b.top}%`,
            width: b.size,
            height: b.size,
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.duration}s`,
          }}
        />
      ))}
    </div>
  )
}

export default BackgroundBlocks
