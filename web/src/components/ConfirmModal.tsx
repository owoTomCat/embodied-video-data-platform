"use client";

import { AlertTriangle, Info, type LucideIcon } from "lucide-react";
import type { ReactNode, RefObject } from "react";

import { Modal } from "./Modal";

type ConfirmTone = "primary" | "danger";

export function ConfirmModal({
  open,
  title,
  heading,
  description,
  confirmLabel,
  busyLabel = "处理中…",
  tone = "primary",
  busy = false,
  onClose,
  onConfirm,
  returnFocusRef,
}: {
  open: boolean;
  title: string;
  heading: string;
  description: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  tone?: ConfirmTone;
  busy?: boolean;
  onClose(): void;
  onConfirm(): void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const Icon: LucideIcon = tone === "danger" ? AlertTriangle : Info;

  return (
    <Modal
      open={open}
      title={title}
      className="confirm-modal"
      onClose={() => {
        if (!busy) onClose();
      }}
      returnFocusRef={returnFocusRef}
    >
      <div className={`confirm-content confirm-content-${tone}`}>
        <span className="confirm-icon" aria-hidden="true">
          <Icon size={22} />
        </span>
        <div>
          <strong>{heading}</strong>
          <p>{description}</p>
        </div>
      </div>
      <div className="modal-actions">
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={onClose}
        >
          取消
        </button>
        <button
          type="button"
          className={`button ${tone === "danger" ? "button-danger" : "button-primary"}`}
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
