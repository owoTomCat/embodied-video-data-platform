"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Modal } from "../../components/Modal";
import { useInteractions } from "../../interactions/InteractionContext";
import type {
  CollectionTask,
  ConfirmRequirementsInput,
  NormalizedRequirementItem,
  NormalizedTaskRequirements,
} from "../../tasks/contracts";
import { normalizeTaskRequirements, taskErrorMessage } from "../../tasks/client/taskApi";

export function TaskNormalizeModal({
  open,
  task,
  onConfirm,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  task: CollectionTask;
  onConfirm(id: string, input: ConfirmRequirementsInput): Promise<CollectionTask>;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const { notify } = useInteractions();
  const [normalized, setNormalized] = useState<NormalizedTaskRequirements | null>(
    task.normalizedRequirements,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const firstRunRef = useRef(false);

  const runNormalize = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const result = await normalizeTaskRequirements(task.id);
      setNormalized(result);
      notify("success", "AI 已生成规范化要求，请确认或调整");
    } catch (reason) {
      setError(taskErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [loading, notify, task.id]);

  useEffect(() => {
    if (!open || normalized || firstRunRef.current) return;
    firstRunRef.current = true;
    const timer = window.setTimeout(() => {
      void runNormalize();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [normalized, open, runNormalize]);

  function updateItem(index: number, values: Partial<NormalizedRequirementItem>) {
    setNormalized((current) => {
      if (!current) return current;
      const requirements = current.requirements.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...values } : item,
      );
      return { ...current, requirements };
    });
  }

  function removeItem(index: number) {
    setNormalized((current) => {
      if (!current) return current;
      return {
        ...current,
        requirements: current.requirements.filter(
          (_item, itemIndex) => itemIndex !== index,
        ),
      };
    });
  }

  function addItem() {
    setNormalized((current) => {
      if (!current) return current;
      return {
        ...current,
        requirements: [
          ...current.requirements,
          { type: "soft", content: "" },
        ],
      };
    });
  }

  function close() {
    if (submittingRef.current) return;
    setError("");
    onClose();
  }

  async function submit() {
    if (submittingRef.current || !normalized) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    const validRequirements = normalized.requirements.filter(
      (item) => item.content.trim() !== "",
    );
    if (validRequirements.length === 0) {
      submittingRef.current = false;
      setSubmitting(false);
      setError("至少需要一条有效要求");
      return;
    }
    try {
      await onConfirm(task.id, {
        scene_description: normalized.scene_description,
        requirements: validRequirements.map((item) => ({
          type: item.type,
          content: item.content.trim(),
          ...(item.rationale?.trim() ? { rationale: item.rationale.trim() } : {}),
        })),
        quality_notes: (normalized.quality_notes ?? [])
          .map((note) => note.trim())
          .filter(Boolean),
      });
      submittingRef.current = false;
      setSubmitting(false);
      onClose();
    } catch (reason) {
      submittingRef.current = false;
      setSubmitting(false);
      setError(taskErrorMessage(reason));
    }
  }

  return (
    <Modal
      open={open}
      title={`AI 要求规范化 · ${task.title}`}
      onClose={close}
      className="normalize-modal"
      returnFocusRef={returnFocusRef}
    >
      <div className="normalize-body">
        <p className="modal-hint">
          AI 已把自由填写的任务要求转换为可逐条判定的结构化要求，请核对并调整后确认。
          「硬性」要求不满足将触发否决或人工复核，「一般」要求仅影响评分。
        </p>
        {error && <p className="form-error">{error}</p>}
        {loading && !normalized ? (
          <p className="modal-hint">正在调用 AI 生成规范化要求…</p>
        ) : normalized ? (
          <div className="normalize-preview">
            <label className="form-label">
              <span>场景描述（质检模型据此判断场景边界）</span>
              <textarea
                value={normalized.scene_description}
                onChange={(event) =>
                  setNormalized({
                    ...normalized,
                    scene_description: event.target.value,
                  })
                }
                rows={3}
                maxLength={2000}
              />
            </label>
            <div className="normalize-requirements">
              <div className="normalize-heading">
                <span>要求条目</span>
                <button type="button" className="button button-secondary button-small" onClick={addItem}>
                  添加条目
                </button>
              </div>
              {normalized.requirements.map((item, index) => (
                <div className="normalize-item" key={index}>
                  <select
                    value={item.type}
                    onChange={(event) =>
                      updateItem(index, {
                        type: event.target.value === "hard" ? "hard" : "soft",
                      })
                    }
                    aria-label={`第 ${index + 1} 条要求类型`}
                  >
                    <option value="hard">硬性</option>
                    <option value="soft">一般</option>
                  </select>
                  <div className="normalize-item-fields">
                    <input
                      aria-label={`第 ${index + 1} 条要求内容`}
                      value={item.content}
                      onChange={(event) =>
                        updateItem(index, { content: event.target.value })
                      }
                      placeholder="要求内容"
                      maxLength={2000}
                    />
                    <input
                      aria-label={`第 ${index + 1} 条判定依据`}
                      value={item.rationale ?? ""}
                      onChange={(event) =>
                        updateItem(index, { rationale: event.target.value })
                      }
                      placeholder="判定依据（可选）"
                      maxLength={2000}
                    />
                  </div>
                  <button
                    type="button"
                    className="table-action"
                    onClick={() => removeItem(index)}
                    aria-label={`删除第 ${index + 1} 条要求`}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
            <label className="form-label">
              <span>补充说明（可选，影响评分或复核）</span>
              <textarea
                value={(normalized.quality_notes ?? []).join("\n")}
                onChange={(event) =>
                  setNormalized({
                    ...normalized,
                    quality_notes: event.target.value
                      .split("\n")
                      .map((note) => note.trim())
                      .filter(Boolean),
                  })
                }
                rows={2}
                maxLength={2000}
              />
            </label>
          </div>
        ) : null}
      </div>
      <div className="modal-actions">
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void runNormalize()}
          disabled={loading}
        >
          {loading ? "重新生成中…" : "重新生成"}
        </button>
        <button type="button" className="button button-secondary" onClick={close}>
          取消
        </button>
        <button
          type="button"
          className="button button-primary"
          onClick={() => void submit()}
          disabled={submitting || !normalized}
        >
          {submitting ? "确认中…" : "确认并保存"}
        </button>
      </div>
    </Modal>
  );
}
