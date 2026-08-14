"use client";

import { useMemo, useRef, useState, type RefObject } from "react";
import { Modal } from "../../components/Modal";
import { useDemoStore } from "../../data/DemoStoreContext";
import { effectiveDuration, estimateIncome } from "../../domain/calculations";
import { useInteractions } from "../../interactions/InteractionContext";

export function SettlementConfirmModal({
  open,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const { state, createSettlementBatch } = useDemoStore();
  const { notify } = useInteractions();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const preview = useMemo(() => {
    const submissions = state.submissions.filter(
      (item) =>
        item.processingStatus === "completed" &&
        item.qualityStatus === "passed" &&
        item.settlementStatus === "unsettled",
    );
    const effectiveSeconds = submissions.reduce(
      (total, item) => total + effectiveDuration(item.durationSeconds, item.invalidSeconds),
      0,
    );
    const amount = submissions.reduce((total, item) => {
      const team = state.teams.find((entry) => entry.id === item.teamId);
      if (!team) return total;
      return total + estimateIncome(
        team.unitPricePerMinute,
        item.durationSeconds,
        item.invalidSeconds,
        item.finalScore,
        item.qualityResult?.settlementRatio,
      );
    }, 0);
    return {
      count: submissions.length,
      minutes: Math.round((effectiveSeconds / 60) * 100) / 100,
      amount: Math.round(amount * 100) / 100,
    };
  }, [state.submissions, state.teams]);

  function close() {
    setError("");
    setSubmitting(false);
    submittingRef.current = false;
    onClose();
  }

  function confirm() {
    if (submittingRef.current || preview.count === 0) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      createSettlementBatch();
      notify("success", "结算批次已生成并锁定");
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "结算批次生成失败");
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  return (
    <Modal
      open={open}
      title="确认生成结算批次"
      onClose={close}
      returnFocusRef={returnFocusRef}
      initialFocusRef={confirmRef}
    >
      <div className="settlement-preview">
        <p>将锁定当前所有处理完成、质检通过且未结算的视频。</p>
        <div>
          <span><small>符合条件的视频</small><strong>{preview.count} 条</strong></span>
          <span><small>有效时长</small><strong>{preview.minutes} 分钟</strong></span>
          <span><small>预计总金额</small><strong>¥{preview.amount.toFixed(2)}</strong></span>
        </div>
        {preview.count === 0 && <p className="modal-error">当前没有可结算数据</p>}
        {error && <p className="modal-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={close}>取消</button>
          <button ref={confirmRef} type="button" className="button button-primary" disabled={preview.count === 0 || submitting} onClick={confirm}>
            {submitting ? "生成中…" : "确认生成"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
