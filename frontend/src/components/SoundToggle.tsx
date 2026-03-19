import { type JSX } from 'react'

function SoundToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }): JSX.Element {
  return (
    <button
      className={`sound-toggle${enabled ? ' active' : ''}`}
      onClick={onToggle}
      title={enabled ? 'Sound on' : 'Sound off'}
    >
      {enabled ? '\u{1F50A}' : '\u{1F507}'}
    </button>
  )
}

export default SoundToggle
