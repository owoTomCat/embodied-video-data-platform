import {
  CheckCircle2,
  Camera,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";

import type { GuideTaskCard } from "../../scene-guide/contracts";

/** 渲染一张结构化任务卡（标题 / 目标物体 / 操作步骤 / 结束条件 / 成功·失败判定）。 */
export function GuideCardView({ card }: { card: GuideTaskCard | null }) {
  if (!card) return null;
  return (
    <div className="guide-card-preview">
      {card.title && (
        <div className="guide-card-panel">
          <p className="guide-panel-title"><Camera size={15} />任务卡</p>
          <p className="guide-card-title">{card.title}</p>
        </div>
      )}
      <div className="guide-card-panel">
        <p className="guide-panel-title">
          <Camera size={15} />目标物体
          <em className="guide-panel-count">{card.target_objects.length} 个</em>
        </p>
        <div className="guide-target-list">
          {card.target_objects.map((object, index) => (
            <span className="guide-target-chip" key={`${object.name}-${index}`}>
              <ShieldCheck size={14} />
              <strong>{object.name}</strong>
              {object.action ? <small>{object.action}</small> : null}
            </span>
          ))}
        </div>
      </div>
      <div className="guide-card-panel">
        <p className="guide-panel-title">
          <RefreshCw size={15} />操作步骤
          <em className="guide-panel-count">{card.steps.length} 步</em>
        </p>
        <ol className="guide-steps-list">
          {card.steps.map((stepText, index) => (
            <li key={index}><span>{index + 1}</span>{stepText}</li>
          ))}
        </ol>
      </div>
      <div className="guide-card-panel">
        <p className="guide-panel-title"><CheckCircle2 size={15} />结束条件</p>
        <p className="guide-end-condition">{card.end_condition}</p>
      </div>
      <div className="guide-card-criteria">
        <div className="guide-criterion-panel guide-success">
          <p className="guide-panel-title guide-crite-title-success">
            <CheckCircle2 size={15} />成功判定
          </p>
          <ul className="guide-crite-list">
            {card.success_criteria.map((item, index) => (
              <li key={index}><CheckCircle2 size={14} /><span>{item}</span></li>
            ))}
          </ul>
        </div>
        <div className="guide-criterion-panel guide-fail">
          <p className="guide-panel-title guide-crite-title-fail">
            <X size={15} />失败判定
          </p>
          <ul className="guide-crite-list">
            {card.fail_criteria.map((item, index) => (
              <li key={index}><X size={14} /><span>{item}</span></li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** 紧凑版：任务卡摘要（标题 + 目标物体 chips），用于列表卡片。 */
export function GuideCardSummary({ card }: { card: GuideTaskCard | null }) {
  if (!card) return null;
  return (
    <div className="guide-card-summary">
      {card.title && <p className="guide-card-title">{card.title}</p>}
      <div className="guide-target-list">
        {card.target_objects.slice(0, 4).map((object, index) => (
          <span className="guide-target-chip" key={`${object.name}-${index}`}>
            <ShieldCheck size={13} />
            <strong>{object.name}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}
