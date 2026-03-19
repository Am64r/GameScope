import React from "react";

interface ScoreMeterProps {
  score: number;
  maxScore: number;
}

const ScoreMeter: React.FC<ScoreMeterProps> = ({ score, maxScore }) => {
  const [width, setWidth] = React.useState(0);

  const percentage = Math.min(
    100,
    Math.max(1, Math.round((score / maxScore) * 100))
  );

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setWidth(percentage);
    }, 50);
    return () => clearTimeout(timer);
  }, [percentage]);

  return (
    <div className="score-meter">
      <div className="score-meter-bar">
        <div
          className="score-meter-fill"
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="score-meter-label">{percentage}% MATCH</span>
    </div>
  );
};

export default ScoreMeter;
