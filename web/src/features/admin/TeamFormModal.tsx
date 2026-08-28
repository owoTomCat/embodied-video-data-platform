"use client";

import {
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";

import type {
  CreateTeamInput,
  TeamPublic,
  UpdateTeamInput,
} from "../../auth/contracts";
import { Modal } from "../../components/Modal";

export function TeamFormModal({
  mode,
  team,
  memberCount = 0,
  onCreate,
  onUpdate,
  onClose,
  returnFocusRef,
}: {
  mode: "create" | "edit";
  team?: TeamPublic;
  memberCount?: number;
  onCreate(input: CreateTeamInput): Promise<TeamPublic>;
  onUpdate(id: string, input: UpdateTeamInput): Promise<TeamPublic>;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const [name, setName] = useState(team?.name ?? "");
  const [unitPrice, setUnitPrice] = useState(
    String(team?.unitPricePerMinute ?? 0),
  );
  const [status, setStatus] = useState(team?.status ?? "active");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

  function close() {
    if (submittingRef.current) return;
    setError("");
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    const parsedUnitPrice = Number(unitPrice);
    if (!Number.isFinite(parsedUnitPrice) || parsedUnitPrice < 0) {
      setError("请输入有效的每小时单价");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      if (mode === "create") {
        await onCreate({ name, unitPricePerMinute: parsedUnitPrice });
      } else if (team) {
        await onUpdate(team.id, {
          name,
          unitPricePerMinute: parsedUnitPrice,
          status,
        });
      }
      submittingRef.current = false;
      setSubmitting(false);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存团队失败");
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const title = mode === "create" ? "新增团队" : `编辑团队 · ${team?.name}`;
  return (
    <Modal
      open
      title={title}
      onClose={close}
      returnFocusRef={returnFocusRef}
      initialFocusRef={firstInputRef}
    >
      <form className="modal-form" onSubmit={submit}>
        <label>
          团队名称
          <input
            ref={firstInputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            required
          />
        </label>
        <label>
          每小时单价（元）
          <input
            type="number"
            value={unitPrice}
            onChange={(event) => setUnitPrice(event.target.value)}
            min="0"
            max="1000000"
            step="0.0001"
            required
          />
        </label>
        {mode === "edit" && (
          <label>
            团队状态
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as TeamPublic["status"])
              }
            >
              <option value="active">已启用</option>
              <option value="disabled">已停用</option>
            </select>
          </label>
        )}
        {mode === "edit" && status === "disabled" && memberCount > 0 && (
          <p className="inline-alert inline-alert-error">
            团队内有 {memberCount} 个启用账号。只有全部账号停用或转移后，团队才能停用。
          </p>
        )}
        {error && <p className="modal-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={close}
            disabled={submitting}
          >
            取消
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={
              submitting ||
              (mode === "edit" && status === "disabled" && memberCount > 0)
            }
          >
            {submitting ? "保存中…" : mode === "create" ? "创建团队" : "保存团队"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
