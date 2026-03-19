import { useState, useEffect } from 'react'

export function useMousePosition(): { x: number; y: number } {
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 })

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      setPos({
        x: e.clientX / window.innerWidth,
        y: e.clientY / window.innerHeight,
      })
    }
    window.addEventListener('mousemove', handler)
    return () => window.removeEventListener('mousemove', handler)
  }, [])

  return pos
}
