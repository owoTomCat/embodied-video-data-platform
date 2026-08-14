import type { Submission } from "../domain/types";

type QualityResult = NonNullable<Submission["qualityResult"]>;
type Deduction = NonNullable<QualityResult["deductions"]>[number];

const qualityDimensions = [
  ["first_person_and_composition", "第一人称与构图"],
  ["hand_forearm_object_integrity", "手部、前臂与对象完整性"],
  ["frame_and_video_quality", "视频与画面质量"],
  ["task_authenticity_completeness", "任务真实性与完整度"],
] as const;

const dimensionAliases: Record<string, string> = {
  D1: "first_person_and_composition",
  D2: "hand_forearm_object_integrity",
  D3: "frame_and_video_quality",
  D4: "task_authenticity_completeness",
  D5: "task_value_uniqueness",
};

const reasonLabels: Record<string, string> = {
  BROKEN_UNPLAYABLE: "视频损坏或无法播放",
  EXACT_DUPLICATE: "完全重复视频",
  FAKE_OR_NON_TASK: "虚假或非任务内容",
  NON_FIRST_PERSON: "不符合第一人称视角",
  NO_HAND_OR_OBJECT: "手部或操作对象不可见",
  HAND_CROPPED: "手部被裁切",
  HAND_SCALE_TOO_LARGE: "操作主体占比过大",
  HAND_SCALE_TOO_SMALL: "操作主体占比过小",
  HAND_NEAR_EDGE: "手部靠近画面边缘",
  OBJECT_NOT_VISIBLE: "操作对象不可见",
  LOW_RESOLUTION: "视频分辨率不足",
  LOW_FPS: "视频帧率不足",
  BLACK_SCREEN: "黑屏",
  FREEZE: "画面冻结",
  BLUR: "画面模糊",
  EXPOSURE: "曝光异常",
  SHAKE: "画面抖动",
  TASK_INCOMPLETE: "任务未完成",
  REPETITIVE: "操作重复",
  LOW_VALUE: "任务信息价值较低",
  INVENTORY_SATURATED: "任务库存已饱和",
};

const subcriterionLabels: Record<string, string> = {
  POV: "第一人称真实性",
  ANGLE: "视角自然度",
  ORIENTATION: "横竖屏构图",
  ARM_ENTRY: "手臂入镜方向",
  COMPLETENESS: "手部与前臂完整性",
  EDGE: "手部贴边",
  SCALE: "操作区域大小",
  OCCLUSION: "操作遮挡",
  OBJECT_VISIBILITY: "操作对象可见性",
  RESOLUTION: "视频分辨率",
  FPS: "视频帧率",
  SHARPNESS: "画面清晰度",
  EXPOSURE: "画面曝光",
  STABILITY: "画面稳定性",
  CONTINUITY: "视频连续性",
  LEVEL: "操作价值等级",
  AUTHENTICITY: "任务真实性",
  PROGRESS: "任务连续推进",
  COMPLETION: "任务完成度",
};

function dimensionOf(item: Deduction): string {
  const dimension = item.dimension ?? "";
  return dimensionAliases[dimension] ?? dimension;
}

function userText(value: string): string {
  return value
    .replace(/\bD1\b/gu, "第一人称与构图")
    .replace(/\bD2\b/gu, "手部、前臂与对象完整性")
    .replace(/\bD3\b/gu, "视频与画面质量")
    .replace(/\bD4\b/gu, "任务真实性与完整度")
    .replace(/\bD5\b/gu, "平台需求与稀缺度");
}

function formatTime(ms: number | undefined): string {
  const seconds = Math.max(0, Math.round((ms ?? 0) / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function DimensionScore({ label, max, score }: { label: string; max: number; score: number }) {
  const safeScore = Math.max(0, Math.min(max, score));
  const percentage = max > 0 ? (safeScore / max) * 100 : 0;
  return (
    <div className="quality-dimension-score">
      <span
        aria-label={`${label} ${score.toFixed(1)} / ${max}`}
        aria-valuemax={max}
        aria-valuemin={0}
        aria-valuenow={safeScore}
        className="quality-score-track"
        role="progressbar"
      >
        <i style={{ width: `${percentage}%` }} />
      </span>
      <span className="quality-score-label">{score.toFixed(1)} / {max}</span>
    </div>
  );
}

function DeductionItem({ item, admin }: { item: Deduction; admin: boolean }) {
  const points = Number(item.deducted_points ?? 0);
  const reasonCode = item.reason_code ?? "";
  const title = subcriterionLabels[item.subcriterion ?? ""] || item.subcriterion || reasonLabels[reasonCode] || reasonCode || "质量问题";
  return (
    <div className={`quality-deduction${points > 0 ? "" : " absorbed"}`}>
      <div><strong>{title}</strong><b>{points > 0 ? `−${points.toFixed(1)} 分` : "未额外扣分"}</b></div>
      <p>{userText(item.observed_value || item.description || "暂无观察说明")}</p>
      <small>{formatTime(item.start_ms)}–{formatTime(item.end_ms)} · 证据 {(item.evidence_timestamps_ms ?? []).map(formatTime).join("、") || "未记录"}</small>
      {admin && <small>{item.rule_id || item.reason_code || "OTHER.OBSERVATION"} · 置信度 {Math.round(Number(item.confidence ?? 0) * 100)}% · 系数 {Number(item.coefficient ?? 1).toFixed(2)}</small>}
      {item.recommendation && <em>建议：{userText(item.recommendation)}</em>}
    </div>
  );
}

export function QualityBreakdown({
  quality,
  finalScore,
  admin = false,
}: {
  quality: QualityResult;
  finalScore: number;
  admin?: boolean;
}) {
  const dimensions = quality.dimensions ?? {};
  const deductions = quality.deductions ?? [];
  const isCurrentRule = quality.ruleVersion === "video_qc_v2_traceable";
  const usesTwentyFivePointDimensions =
    isCurrentRule ||
    quality.ruleVersion === "video_qc_v2_25point" ||
    qualityDimensions.some(([key]) => Number(dimensions[key]?.score ?? 0) > 20);
  const dimensionMax = usesTwentyFivePointDimensions ? 25 : 20;
  const raw = quality.qualityRawScore ?? qualityDimensions.reduce(
    (sum, [key]) => sum + Number(dimensions[key]?.score ?? 0),
    0,
  );
  const qualityScore = quality.qualityScore ?? raw;
  const demandCoefficient = quality.demandCoefficient ?? Number(
    dimensions.task_value_uniqueness?.coefficient ?? 1,
  );
  const severe = deductions.some((item) => item.severity === "major" || item.severity === "critical");
  const showQualitySuggestions = qualityScore < 80 || severe;
  const recommendations = quality.recommendations.filter(
    (item) => showQualitySuggestions || /需求|紧缺|饱和|任务/u.test(item),
  );
  const namedKeys = new Set([...qualityDimensions.map(([key]) => key), "task_value_uniqueness"]);
  const otherProblems = deductions.filter((item) => !namedKeys.has(dimensionOf(item)));

  return (
    <section className="quality-breakdown">
      <div className="quality-overview">
        <div><span>最终综合分</span><strong>{finalScore.toFixed(1)} / 100</strong></div>
        <div><span>质量总分</span><strong>{qualityScore.toFixed(1)} / 100</strong></div>
        <div><span>平台需求</span><strong>{quality.demandStatus || "紧缺"} ×{demandCoefficient.toFixed(2)}</strong></div>
      </div>
      <div className="quality-dimensions">
        {qualityDimensions.map(([key, label]) => {
          const dimension = dimensions[key];
          const items = deductions.filter((item) => dimensionOf(item) === key);
          const score = Number(dimension?.score ?? 0);
          return (
            <section className="quality-dimension" key={key}>
              <header><strong>{label}</strong><DimensionScore label={label} max={dimensionMax} score={score} /></header>
              {items.length > 0
                ? <div className="quality-deduction-list">{items.map((item, index) => <DeductionItem admin={admin} item={item.deducted_points === undefined ? { ...item, deducted_points: index === 0 ? Math.max(0, dimensionMax - score) : 0, points_after: score, is_controlling: index === 0 } : item} key={`${item.rule_id || item.reason_code}-${index}`} />)}</div>
                : score < dimensionMax
                  ? <div className="quality-deduction missing"><div><strong>扣分依据缺失</strong><b>−{(dimensionMax - score).toFixed(1)} 分待核实</b></div><p>{isCurrentRule ? `模型返回 ${score.toFixed(1)}/${dimensionMax}，但没有返回对应的扣分原因和证据。本结果不具备结算条件，已进入复核。` : "这条历史记录没有保存可复算的扣分原因；不能根据分差反推原因，请重新检测。"}</p></div>
                  : <p className="quality-clear">未发现该维度的明确扣分点。</p>}
              {admin && dimension?.calculation_trace && <p className="quality-trace">计算：{dimension.calculation_trace}</p>}
            </section>
          );
        })}
        <section className="quality-dimension demand">
          <header><strong>平台需求与稀缺度</strong><span>{quality.demandStatus || "紧缺"} ×{demandCoefficient.toFixed(2)}</span></header>
          <p className="quality-clear">{isCurrentRule ? `质量总分 ${qualityScore.toFixed(1)} × 需求系数 ${demandCoefficient.toFixed(2)} = 最终综合分 ${finalScore.toFixed(1)}。` : "这是旧规则产生的历史记录，需求系数不可按新规则反推；请重新检测后查看新的乘法结算明细。"}</p>
          {deductions.filter((item) => dimensionOf(item) === "task_value_uniqueness").map((item, index) => <DeductionItem admin={admin} item={item} key={`${item.rule_id || item.reason_code}-${index}`} />)}
        </section>
      </div>
      {otherProblems.length > 0 && <section className="quality-other"><h3>其他问题</h3>{otherProblems.map((item, index) => <p key={`${item.reason_code}-${index}`}>{item.description || item.observed_value}</p>)}</section>}
      <section className="quality-advice">
        <h3>建议</h3>
        {recommendations.length > 0
          ? <ul>{recommendations.map((item, index) => <li key={`${index}-${item}`}>{userText(item)}</li>)}</ul>
          : <p>当前视频无需质量改进。</p>}
      </section>
      {admin && <p className="quality-version">规则 {quality.ruleVersion || "历史版本"} · 提示词 V{quality.promptRevision} · 首次模型 {quality.initialModel}</p>}
    </section>
  );
}
