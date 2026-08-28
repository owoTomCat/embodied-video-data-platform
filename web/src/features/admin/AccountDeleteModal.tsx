"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import { useRef, useState, type FormEvent, type RefObject } from "react";

import type { AccountPublic } from "../../auth/contracts";
import { Modal } from "../../components/Modal";

export function AccountDeleteModal({
  account,
  onDelete,
  onClose,
  returnFocusRef,
}: {
  account: AccountPublic;
  onDelete(): Promise<void>;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmed = confirmation.trim() === account.username;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onDelete();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除失败，请重试");
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      title={`删除账号 · ${account.displayName}`}
      className="account-delete-modal"
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      initialFocusRef={inputRef}
    >
      <form className="modal-form account-delete-confirmation" onSubmit={submit}>
        <div className="destructive-callout">
          <AlertTriangle size={20} />
          <div>
            <strong>此操作会永久删除账号，无法撤销</strong>
            <span>
              仅已停用且没有视频、任务、金额或配置记录的账号可以删除；已有业务记录的账号会继续保留为停用状态。
            </span>
          </div>
        </div>
        <label>
          输入用户名 <strong>{account.username}</strong> 确认删除
          <input
            ref={inputRef}
            aria-label="确认用户名"
            autoComplete="off"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={account.username}
          />
        </label>
        {error && <p className="modal-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            className="button button-danger"
            disabled={!confirmed || submitting}
          >
            <Trash2 size={15} />
            {submitting ? "删除中…" : "永久删除账号"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
