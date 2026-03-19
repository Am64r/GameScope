import { useEffect, useCallback } from 'react'

export function useKeyboardNav(
  cardCount: number,
  focusedIndex: number,
  setFocusedIndex: (i: number) => void,
  onExpand: (i: number) => void,
  onClear: () => void
) {
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (cardCount === 0) return
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault()
      setFocusedIndex(Math.min(focusedIndex + 1, cardCount - 1))
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault()
      setFocusedIndex(Math.max(focusedIndex - 1, 0))
    } else if (e.key === 'Enter' && focusedIndex >= 0) {
      e.preventDefault()
      onExpand(focusedIndex)
    } else if (e.key === 'Escape') {
      onClear()
    }
  }, [cardCount, focusedIndex, setFocusedIndex, onExpand, onClear])

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])
}
