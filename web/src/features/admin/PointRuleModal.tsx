"use client";

import { useRef, useState, type FormEvent, type RefObject } from "react";

import { Modal } from "../../components/Modal";
import { useInteractions } from "../../interactions/InteractionContext";
import { createPointRule } from "../../points/client/pointCycleApi";
import type {
  BackendPointRule,
  BackendPointRuleCoefficientBand,
} from "../../points/contracts";

const DEFAULT_BANDS: BackendPointRuleCoefficientBand[] = [
  { minScore: 80, maxScore: 100, ratio: 1, label: "优质" },
  { minScore: 70, maxScore: 79, ratio: 0.85, label: "合格" },
  { minScore: 60, maxScore: 69, ratio: 0.7, label: "基础" },
  { minScore: 0, maxScore: 59, ratio: 0, label: "不计分" },
];

function newBand(): BackendPointRuleCoefficientBand {
  return { minScore: 0, maxScore: 0, ratio: 1, label: "新档位" };
}

export function PointRuleModal({
  open,
  currentRule,
  onCreated,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  currentRule?: BackendPointRule;
  onCreated(rule: BackendPointRule): void;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const { notify } = useInteractions();
  const [version, setVersion] = useState("");
  const [defaultPoints, setDefaultPoints] = useState(
    String(currentRule?.defaultPointsPerMinute ?? 12),
  );
  const [bands, setBands] = useState<BackendPointRuleCoefficientBand[]>(
    currentRule?.coefficientBands?.length
      ? currentRule.coefficientBands.map((band) => ({ ...band }))
      : DEFAULT_BANDS.map((band) => ({ ...band })),
  );
  const [description, setDescription] = useState(
    currentRule?.description ?? "",
  );
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

  function close() {
    if (submittingRef.current) return;
    setError("");
    setSubmitting(false);
    submittingRef.current = false;
    onClose();
  }

  function updateBand(
    index: number,
    patch: Partial<BackendPointRuleCoefficientBand>,
  ) {
    setBands((current) =>
      current.map((band, bandIndex) =>
        bandIndex === index ? { ...band, ...patch } : band,
      ),
    );
  }

  function addBand() {
    setBands((current) => [...current, newBand()]);
  }

  function removeBand(index: number) {
    if (bands.length <= 1) {
      setError("至少保留一个系数档位");
      return;
    }
    setBands((current) => current.filter((_band, bandIndex) => bandIndex !== index));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    if (!version.trim()) {
      setError("请填写版本名称");
      return;
    }
    const parsedPoints = Number(defaultPoints);
    if (!Number.isFinite(parsedPoints) || parsedPoints < 0) {
      setError("请输入有效的每分钟单价");
      return;
    }
    for (const band of bands) {
      const min = Number(band.minScore);
      const max = Number(band.maxScore);
      const ratio = Number(band.ratio);
      if (
        !Number.isInteger(min) ||
        !Number.isInteger(max) ||
        min < 0 ||
        max > 100 ||
        min > max
      ) {
        setError(`档位「${band.label || "未命名"}」的分数区间无效（0-100 且下限≤上限）`);
        return;
      }
      if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
        setError(`档位「${band.label || "未命名"}」的比例必须是 0 到 1 之间的数字`);
        return;
      }
      if (!band.label.trim()) {
        setError("每个档位都需要填写名称");
        return;
      }
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const rule = await createPointRule({
        version: version.trim(),
        defaultPointsPerMinute: parsedPoints,
        coefficientBands: bands.map((band) => ({
          minScore: Number(band.minScore),
          maxScore: Number(band.maxScore),
          ratio: Number(band.ratio),
          label: band.label.trim(),
        })),
        description,
      });
      onCreated(rule);
      notify("success", "单价规则已发布");
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败，请重试");
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  return (
    <Modal
      open={open}
      title="发布单价规则"
      onClose={close}
      returnFocusRef={returnFocusRef}
      initialFocusRef={firstInputRef}
    >
      <form className="modal-form" onSubmit={submit}>
        <label>
          版本名称
          <input
            ref={firstInputRef}
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            placeholder="POINTS-2026-09"
            required
          />
        </label>
        <label>
          默认每分钟单价
          <input
            type="number"
            min="0"
            step="0.01"
            value={defaultPoints}
            onChange={(event) => setDefaultPoints(event.target.value)}
          />
        </label>
        <fieldset className="modal-fieldset">
          <legend>质量系数档位（按最终评分计算结算比例）</legend>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr><th>档位名称</th><th>分数下限</th><th>分数上限</th><th>比例</th><th /></tr>
              </thead>
              <tbody>
                {bands.map((band, index) => (
                  <tr key={`${band.label}-${index}`}>
                    <td><input value={band.label} onChange={(event) => updateBand(index, { label: event.target.value })} aria-label="档位名称" /></td>
                    <td><input type="number" min="0" max="100" value={band.minScore} onChange={(event) => updateBand(index, { minScore: Number(event.target.value) })} aria-label="分数下限" /></td>
                    <td><input type="number" min="0" max="100" value={band.maxScore} onChange={(event) => updateBand(index, { maxScore: Number(event.target.value) })} aria-label="分数上限" /></td>
                    <td><input type="number" min="0" max="1" step="0.05" value={band.ratio} onChange={(event) => updateBand(index, { ratio: Number(event.target.value) })} aria-label="比例" /></td>
                    <td><button type="button" className="table-action table-action-danger" onClick={() => removeBand(index)}>删除</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="button button-secondary" onClick={addBand}>添加档位</button>
        </fieldset>
        <label>
          规则说明
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        {error && <p className="modal-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={close}>
            取消
          </button>
          <button type="submit" className="button button-primary" disabled={submitting}>
            {submitting ? "保存中…" : "发布规则"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
