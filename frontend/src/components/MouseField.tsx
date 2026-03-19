import { type JSX } from 'react'
import { useMousePosition } from '../hooks/useMousePosition'

function MouseField(): JSX.Element {
  const { x, y } = useMousePosition()

  const layer1 = {
    transform: `translate(${(x - 0.5) * 20}px, ${(y - 0.5) * 20}px)`,
  }
  const layer2 = {
    transform: `translate(${(x - 0.5) * -30}px, ${(y - 0.5) * -30}px)`,
  }

  return (
    <div className="mouse-field">
      <div className="mouse-field-layer mouse-field-layer-1" style={layer1} />
      <div className="mouse-field-layer mouse-field-layer-2" style={layer2} />
    </div>
  )
}

export default MouseField
