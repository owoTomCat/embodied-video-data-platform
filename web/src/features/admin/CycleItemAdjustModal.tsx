"use client";

import { useState, type FormEvent, type RefObject } from "react";

import { Modal } from "../../components/Modal";
import { useInteractions } from "../../interactions/InteractionContext";
import { adjustPointCycleItem } from "../../points/client/pointCycleApi";
import type {
  BackendPointCycle,
  BackendPointCycleItem,
} from "../../points/contracts";

export function CycleItemAdjustModal({
  open,
  cycleId,
  item,
  onAdjusted,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  cycleId: string;
  item: BackendPointCycleItem;
  onAdjusted(cycle: BackendPointCycle): void;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const { notify } = useInteractions();
  const [finalScore, setFinalScore] = useState(String(item.finalScore));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const score = Number(finalScore);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      setError("请输入 0 到 100 之间的最终评分");
      return;
    }
    if (score === item.finalScore) {
      setError("最终评分未变化，无需调整");
      return;
    }
    if (!reason.trim()) {
      setError("请填写调整原因");
      return;
    }
    setSubmitting(true);
    try {
      const cycle = await adjustPointCycleItem(cycleId, item.id, {
        reason: reason.trim(),
        nextFinalScore: score,
      });
      notify("success", "条目积分已调整");
      onAdjusted(cycle);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "调整失败，请重试");
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title={`调整条目积分 · ${item.fileName}`}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
    >
      <form className="modal-form" onSubmit={submit}>
        <p className="form-help">当前评分 {item.finalScore.toFixed(1)} 分 · 积分 {item.points.toFixed(2)} 分。修改评分后，结算比例与积分将按当前积分规则自动重算。</p>
        <label>
          最终评分
          <input
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={finalScore}
            onChange={(event) => setFinalScore(event.target.value)}
            required
          />
        </label>
        <label>
          调整原因
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="例如：人工复核确认该视频存在硬性问题，评分修正为 XX"
            required
          />
        </label>
        {error && <p className="modal-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose}>取消</button>
          <button type="submit" className="button button-primary" disabled={submitting}>
            {submitting ? "提交中…" : "确认调整"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
