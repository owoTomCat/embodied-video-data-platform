"use client";

import { useRef, useState, type RefObject } from "react";
import { Modal } from "../../components/Modal";
import { useInteractions } from "../../interactions/InteractionContext";
import {
  createPointCycle,
  PointCycleApiError,
} from "../../points/client/pointCycleApi";
import type {
  BackendPointCycle,
  BackendPointCyclePreview,
} from "../../points/contracts";

type PointCyclePreview = Pick<
  BackendPointCyclePreview,
  "submissionCount" | "effectiveMinutes" | "totalPoints"
>;

export function SettlementConfirmModal({
  open,
  onClose,
  returnFocusRef,
  preview: backendPreview,
  onCreated,
}: {
  open: boolean;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  preview?: BackendPointCyclePreview | null;
  onCreated?(cycle: BackendPointCycle): void;
}) {
  const { notify } = useInteractions();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const preview: PointCyclePreview = backendPreview ?? {
    submissionCount: 0,
    effectiveMinutes: 0,
    totalPoints: 0,
  };

  function close() {
    setError("");
    setSubmitting(false);
    submittingRef.current = false;
    onClose();
  }

  async function confirm() {
    if (submittingRef.current || preview.submissionCount === 0) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      onCreated?.(await createPointCycle());
      notify("success", "积分周期已生成并锁定");
      close();
    } catch (reason) {
      const message =
        reason instanceof PointCycleApiError || reason instanceof Error
          ? reason.message
          : "积分周期生成失败";
      setError(message);
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  return (
    <Modal
      open={open}
      title="确认生成积分周期"
      onClose={close}
      returnFocusRef={returnFocusRef}
      initialFocusRef={cancelRef}
    >
      <div className="settlement-preview">
        <p>将锁定当前所有处理完成、质检通过且未进入周期的视频。</p>
        <div>
          <span><small>符合条件的视频</small><strong>{preview.submissionCount} 条</strong></span>
          <span><small>有效时长</small><strong>{preview.effectiveMinutes} 分钟</strong></span>
          <span><small>预计总积分</small><strong>{preview.totalPoints.toFixed(2)} 分</strong></span>
        </div>
        {preview.submissionCount === 0 && <p className="modal-error">当前没有可锁定积分数据</p>}
        {error && <p className="modal-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button ref={cancelRef} type="button" className="button button-secondary" onClick={close}>取消</button>
          <button type="button" className="button button-primary" disabled={preview.submissionCount === 0 || submitting} onClick={confirm}>
            {submitting ? "生成中…" : "确认生成"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
