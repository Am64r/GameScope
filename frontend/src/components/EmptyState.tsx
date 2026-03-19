import { type JSX } from 'react'

const EXAMPLE_QUERIES = [
  'a cozy game with no combat',
  'dark souls but in space',
  'relaxing farming with friends',
  'competitive fps with ranked',
  'story-rich RPG that will make me cry',
  'local co-op party games',
]

function EmptyState({ onQueryClick }: { onQueryClick: (query: string) => void }): JSX.Element {
  return (
    <div className="empty-state">
      <h2 className="empty-state-title">WHAT DO YOU WANT TO PLAY?</h2>
      <p className="empty-state-sub">Describe the experience. We'll find the game.</p>
      <div className="empty-state-queries">
        {EXAMPLE_QUERIES.map((q) => (
          <button key={q} className="example-query" onClick={() => onQueryClick(q)}>
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}

export default EmptyState
