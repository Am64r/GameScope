import { useCallback, useRef, useState } from 'react'

export function useSound() {
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem('gamescope-sound') === 'on' } catch { return false }
  })
  const ctxRef = useRef<AudioContext | null>(null)

  const getCtx = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = new AudioContext()
    return ctxRef.current
  }, [])

  const playTone = useCallback((freq: number, duration: number, type: OscillatorType = 'square') => {
    if (!enabled) return
    const ctx = getCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    gain.gain.value = 0.08
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + duration)
  }, [enabled, getCtx])

  const playSearch = useCallback(() => playTone(880, 0.1), [playTone])
  const playResult = useCallback(() => { playTone(523, 0.08); setTimeout(() => playTone(659, 0.08), 80) }, [playTone])
  const playExpand = useCallback(() => playTone(440, 0.06, 'triangle'), [playTone])
  const playTag = useCallback(() => playTone(1047, 0.05), [playTone])

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev
      try { localStorage.setItem('gamescope-sound', next ? 'on' : 'off') } catch {}
      return next
    })
  }, [])

  return { enabled, toggle, playSearch, playResult, playExpand, playTag }
}
