"use client";

import { useState, type FormEvent, type RefObject } from "react";

import {
  publishScarcityConfig,
} from "../../ai-quality/client/aiQualityApi";
import type {
  ScarcityConfig,
  ScarcityTier,
} from "../../ai-quality/contracts";
import { Modal } from "../../components/Modal";
import { useInteractions } from "../../interactions/InteractionContext";

function newTier(): ScarcityTier {
  return {
    id: crypto.randomUUID(),
    minCount: 0,
    maxCount: null,
    coefficient: 1,
    label: "新增档位",
  };
}

export function ScarcityConfigModal({
  open,
  config,
  onPublished,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  config: ScarcityConfig;
  onPublished(config: ScarcityConfig): void;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const { notify } = useInteractions();
  const [enabled, setEnabled] = useState(config.enabled);
  const [tiers, setTiers] = useState<ScarcityTier[]>(
    config.tiers.map((tier) => ({ ...tier })),
  );
  const [sceneWeight, setSceneWeight] = useState(String(config.weights.scene));
  const [taskWeight, setTaskWeight] = useState(
    String(config.weights.standardTask),
  );
  const [variantWeight, setVariantWeight] = useState(
    String(config.weights.variant),
  );
  const [description, setDescription] = useState(config.description);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function updateTier(index: number, patch: Partial<ScarcityTier>) {
    setTiers((current) =>
      current.map((tier, tierIndex) =>
        tierIndex === index ? { ...tier, ...patch } : tier,
      ),
    );
  }

  function addTier() {
    setTiers((current) => {
      const previous = current[current.length - 1];
      const tier = newTier();
      if (!previous) {
        tier.minCount = 0;
        tier.maxCount = null;
        return [tier];
      }
      if (previous.maxCount === null) {
        // 最后一个档位无上限时不能在其后追加：先把它收口为单值档位，
        // 再追加一个新档位衔接在其后（新档位无上限，保持"最后档无上限"约束）。
        const boundedPrevious = { ...previous, maxCount: previous.minCount };
        tier.minCount = previous.minCount + 1;
        tier.maxCount = null;
        return [...current.slice(0, -1), boundedPrevious, tier];
      }
      tier.minCount = previous.maxCount + 1;
      tier.maxCount = null;
      return [...current, tier];
    });
  }

  function removeTier(index: number) {
    if (tiers.length <= 1) {
      setError("至少保留一个档位");
      return;
    }
    setTiers((current) => current.filter((_tier, tierIndex) => tierIndex !== index));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const scene = Number(sceneWeight);
    const task = Number(taskWeight);
    const variant = Number(variantWeight);
    if (![scene, task, variant].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
      setError("各层级权重必须是 0 到 1 之间的数字");
      return;
    }
    for (const tier of tiers) {
      const min = Number(tier.minCount);
      const max = tier.maxCount === null ? null : Number(tier.maxCount);
      if (!Number.isInteger(min) || min < 0) {
        setError(`档位「${tier.label}」的下限必须是 ≥0 的整数`);
        return;
      }
      if (max !== null && (!Number.isInteger(max) || max < min)) {
        setError(`档位「${tier.label}」的上限必须是 ≥ 下限的整数`);
        return;
      }
      if (!Number.isFinite(tier.coefficient) || tier.coefficient < 0 || tier.coefficient > 1) {
        setError(`档位「${tier.label}」的系数必须是 0 到 1 之间的数字`);
        return;
      }
    }
    setSubmitting(true);
    try {
      const input = {
        enabled,
        tiers,
        weights: { scene, standardTask: task, variant },
        description: description.trim() || "稀缺奖励配置",
      };
      const published = await publishScarcityConfig(input);
      onPublished(published);
      notify("success", "稀缺奖励配置已发布");
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败，请重试");
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title={`稀缺奖励配置（V${config.revision}）`}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
    >
      <form className="modal-form" onSubmit={submit}>
        <p className="form-help">按场景/任务/变体的有效存量分档计酬：存量越少系数越高（稀缺奖励）。档位按 minCount 升序排列，最后一个档位必须无上限。</p>
        <label className="checkbox-field">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          启用稀缺奖励（关闭后场景稀缺度不参与评分，不奖不罚）
        </label>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>档位名称</th><th>存量下限</th><th>存量上限（空=无上限）</th><th>系数</th><th /></tr>
            </thead>
            <tbody>
              {tiers.map((tier, index) => (
                <tr key={tier.id}>
                  <td><input value={tier.label} onChange={(event) => updateTier(index, { label: event.target.value })} aria-label="档位名称" /></td>
                  <td><input type="number" min="0" value={tier.minCount} onChange={(event) => updateTier(index, { minCount: Number(event.target.value) })} aria-label="存量下限" /></td>
                  <td><input type="number" min="0" value={tier.maxCount ?? ""} placeholder="无上限" onChange={(event) => updateTier(index, { maxCount: event.target.value === "" ? null : Number(event.target.value) })} aria-label="存量上限" /></td>
                  <td><input type="number" min="0" max="1" step="0.05" value={tier.coefficient} onChange={(event) => updateTier(index, { coefficient: Number(event.target.value) })} aria-label="系数" /></td>
                  <td><button type="button" className="table-action table-action-danger" onClick={() => removeTier(index)}>删除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="button button-secondary" onClick={addTier}>添加档位</button>
        <fieldset className="modal-fieldset">
          <legend>加权公式：C_inventory = 场景×C_scene + 任务×C_task + 变体×C_variant</legend>
          <label>场景权重<input type="number" min="0" max="1" step="0.05" value={sceneWeight} onChange={(event) => setSceneWeight(event.target.value)} /></label>
          <label>标准任务权重<input type="number" min="0" max="1" step="0.05" value={taskWeight} onChange={(event) => setTaskWeight(event.target.value)} /></label>
          <label>变体权重<input type="number" min="0" max="1" step="0.05" value={variantWeight} onChange={(event) => setVariantWeight(event.target.value)} /></label>
        </fieldset>
        <label>
          配置说明
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        {error && <p className="modal-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose}>取消</button>
          <button type="submit" className="button button-primary" disabled={submitting}>
            {submitting ? "发布中…" : "发布新版本"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
