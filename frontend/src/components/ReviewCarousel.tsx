import { useState, useEffect, useCallback, type JSX } from 'react'

function ReviewCarousel({ snippets }: { snippets: string[] }): JSX.Element | null {
  const [index, setIndex] = useState(0)

  const next = useCallback(() => {
    setIndex((i) => (i + 1) % snippets.length)
  }, [snippets.length])

  const prev = useCallback(() => {
    setIndex((i) => (i - 1 + snippets.length) % snippets.length)
  }, [snippets.length])

  useEffect(() => {
    if (snippets.length <= 1) return
    const timer = setInterval(next, 6000)
    return () => clearInterval(timer)
  }, [next, snippets.length])

  if (snippets.length === 0) return null

  return (
    <div className="review-carousel" onClick={(e) => e.stopPropagation()}>
      <p className="review-carousel-label">Players say</p>
      <div className="review-carousel-content">
        <p className="review-carousel-snippet">"{snippets[index]}"</p>
      </div>
      {snippets.length > 1 && (
        <div className="review-carousel-controls">
          <div className="review-carousel-dots">
            {snippets.map((_, i) => (
              <button
                key={i}
                className={`review-carousel-dot${i === index ? ' active' : ''}`}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
          <div className="review-carousel-arrows">
            <button className="review-carousel-arrow" onClick={prev}>&lt;</button>
            <button className="review-carousel-arrow" onClick={next}>&gt;</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ReviewCarousel
