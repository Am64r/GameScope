import { useState, useEffect, type JSX } from 'react'

const MESSAGES = [
  'INSERTING COIN...',
  'LOADING LEVEL...',
  'SEARCHING THE ARCADE...',
  'CHECKING HIGH SCORES...',
]

function LoadingState(): JSX.Element {
  const [msgIndex, setMsgIndex] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex((i) => (i + 1) % MESSAGES.length)
    }, 1500)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="loading-state">
      <div className="loading-dots">
        <div className="loading-dot" />
        <div className="loading-dot" />
        <div className="loading-dot" />
      </div>
      <p className="loading-message">{MESSAGES[msgIndex]}</p>
    </div>
  )
}

export default LoadingState
