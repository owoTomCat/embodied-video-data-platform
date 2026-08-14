import { qualityCoefficient } from "../domain/calculations";

export function QualityScore({
  score,
  settlementRatio,
}: {
  score: number;
  settlementRatio?: number | null;
}) {
  const tone = score >= 80 ? "high" : score >= 60 ? "mid" : "low";
  const hasResult = score > 0 || settlementRatio !== undefined;
  const coefficient =
    settlementRatio === undefined ? qualityCoefficient(score) : settlementRatio;
  return (
    <div className={`quality-score quality-score-${tone}`}>
      <strong>{hasResult ? score : "—"}</strong>
      <span>
        {!hasResult
          ? "等待评分"
          : coefficient === null
            ? "暂不结算"
            : `系数 ${coefficient.toFixed(2)}`}
      </span>
    </div>
  );
}
