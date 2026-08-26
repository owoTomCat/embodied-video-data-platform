"use client";

import {
  AlertTriangle,
  Box,
  Hand,
  Map,
  Plus,
  RefreshCw,
  Tags,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  deleteQualityLabel,
  getLabelSet,
  updateQualityLabel,
} from "../../ai-quality/client/aiQualityApi";
import type { LabelSet } from "../../ai-quality/contracts";
import { StatusBadge } from "../../components/StatusBadge";
import { ConfirmModal } from "../../components/ConfirmModal";
import type { LabelConfig } from "../../domain/types";
import { useInteractions } from "../../interactions/InteractionContext";
import { LabelFormModal, labelTypeLabel } from "./LabelFormModal";

type LabelType = LabelConfig["type"];

const typeMeta: Array<{
  type: LabelType;
  icon: typeof Map;
  description: string;
}> = [
  { type: "scene", icon: Map, description: "拍摄发生的物理环境，AI 质检按场景判定匹配度与库存稀缺" },
  { type: "action", icon: Hand, description: "视频中的标准任务/操作动作，用于任务分类与库存统计" },
  { type: "object", icon: Box, description: "操作涉及的主要对象/工具，用于任务变体分类" },
  { type: "issue", icon: AlertTriangle, description: "常见质量问题标签，用于质检问题的归类与复核提示" },
];

export function LabelSetPage() {
  const { notify } = useInteractions();
  const [labelSet, setLabelSet] = useState<LabelSet>();
  const [mode, setMode] = useState<"loading" | "live" | "unavailable">("loading");
  const [createType, setCreateType] = useState<LabelType>();
  const [selectedLabel, setSelectedLabel] = useState<LabelConfig>();
  const [deletingLabelId, setDeletingLabelId] = useState<string>();
  const [deleteTarget, setDeleteTarget] = useState<LabelConfig>();
  const [togglingLabelId, setTogglingLabelId] = useState<string>();
  const [createAnchor, setCreateAnchor] = useState<HTMLButtonElement | null>(null);
  const editTriggerRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    getLabelSet()
      .then((next) => {
        if (!active) return;
        setLabelSet(next);
        setMode("live");
      })
      .catch(() => {
        if (!active) return;
        setLabelSet(undefined);
        setMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleDeleteLabel() {
    if (!deleteTarget) return;
    const label = deleteTarget;
    setDeletingLabelId(label.id);
    try {
      const next = await deleteQualityLabel(label.id);
      setLabelSet(next);
      setDeleteTarget(undefined);
      notify("success", "标签已删除");
    } catch (reason) {
      notify("error", reason instanceof Error ? reason.message : "删除失败，请重试");
    } finally {
      setDeletingLabelId(undefined);
    }
  }

  async function handleToggleLabel(label: LabelConfig) {
    setTogglingLabelId(label.id);
    try {
      const next = await updateQualityLabel({
        id: label.id,
        nextId: label.id,
        name: label.name,
        enabled: !label.enabled,
      });
      setLabelSet(next);
      notify("success", label.enabled ? "标签已停用" : "标签已启用");
    } catch (reason) {
      notify(
        "error",
        reason instanceof Error ? reason.message : "状态更新失败，请重试",
      );
    } finally {
      setTogglingLabelId(undefined);
    }
  }

  const labels = labelSet?.labels ?? [];
  const totalEnabled = labels.filter((label) => label.enabled).length;

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">AI 质检内容标签字典</p>
          <h1>标签体系</h1>
          <span>按类型分区管理场景、动作、对象与质量问题标签，与系统提示词相互独立</span>
        </div>
        <span className="live-pill">
          <i />
          {mode === "live"
            ? `版本 V${labelSet?.revision ?? "—"} · 已生效`
            : mode === "loading"
              ? "正在读取标签体系"
              : "标签服务暂不可用"}
        </span>
      </div>

      {mode === "unavailable" ? (
        <div className="empty-state">
          <Tags size={28} />
          <strong>标签服务暂不可用</strong>
          <span>请确认后端已启动后重试</span>
        </div>
      ) : mode === "loading" ? (
        <div className="empty-state">
          <RefreshCw size={28} className="spin" />
          <span>正在读取标签体系…</span>
        </div>
      ) : (
        <>
          <section className="content-card label-set-summary">
            <div>
              <span className="label-set-summary-icon"><Tags size={20} /></span>
              <div>
                <strong>标签体系 V{labelSet?.revision}</strong>
                <p>
                  共 {labels.length} 个标签（启用 {totalEnabled} 个）· 由 {labelSet?.createdByName} 维护。
                  每次新增、编辑、删除或启用/停用都会发布一个新版本；AI 质检只使用启用状态的标签。
                </p>
              </div>
            </div>
            <div className="label-set-summary-types">
              {typeMeta.map((meta) => (
                <span key={meta.type}>
                  <em>{labelTypeLabel(meta.type)}</em>
                  <strong>
                    {labels.filter((label) => label.type === meta.type).length}
                  </strong>
                  <small>
                    {labels.filter(
                      (label) => label.type === meta.type && label.enabled,
                    ).length}{" "}
                    启用
                  </small>
                </span>
              ))}
            </div>
          </section>

          {typeMeta.map((meta) => {
            const Icon = meta.icon;
            const typeLabels = labels.filter((label) => label.type === meta.type);
            return (
              <section className="content-card table-card" key={meta.type}>
                <div className="card-heading">
                  <div>
                    <h2 className="label-type-heading">
                      <span className="label-type-icon"><Icon size={15} /></span>
                      {labelTypeLabel(meta.type)}
                      <em>{typeLabels.length} 个</em>
                    </h2>
                    <p>{meta.description}</p>
                  </div>
                  <button
                    className="button button-secondary"
                    onClick={(event) => {
                      setCreateAnchor(event.currentTarget);
                      setCreateType(meta.type);
                    }}
                  >
                    <Plus size={14} />
                    新增{labelTypeLabel(meta.type)}标签
                  </button>
                </div>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>编号</th>
                        <th>标签名称</th>
                        <th>关联视频</th>
                        <th>状态</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {typeLabels.map((label) => (
                        <tr key={label.id}>
                          <td><span className="mono">{label.id}</span></td>
                          <td><strong>{label.name}</strong></td>
                          <td className="nowrap-cell">{label.associationCount} 条</td>
                          <td className="status-cell">
                            <StatusBadge
                              label={label.enabled ? "启用" : "停用"}
                              tone={label.enabled ? "success" : "neutral"}
                            />
                          </td>
                          <td className="table-actions-cell">
                            <span className="row-actions">
                              <button
                                className="table-action"
                                disabled={togglingLabelId === label.id}
                                aria-label={`${label.enabled ? "停用" : "启用"}标签 ${label.name}`}
                                onClick={() => void handleToggleLabel(label)}
                              >
                                {togglingLabelId === label.id
                                  ? "处理中…"
                                  : label.enabled
                                    ? "停用"
                                    : "启用"}
                              </button>
                              <button
                                className="table-action"
                                onClick={(event) => {
                                  editTriggerRef.current = event.currentTarget;
                                  setSelectedLabel(label);
                                }}
                              >
                                编辑
                              </button>
                              <button
                                className="table-action table-action-danger"
                                disabled={deletingLabelId === label.id || togglingLabelId === label.id}
                                aria-label={`删除标签 ${label.name}`}
                                onClick={(event) => {
                                  deleteTriggerRef.current = event.currentTarget;
                                  setDeleteTarget(label);
                                }}
                              >
                                {deletingLabelId === label.id ? "删除中…" : "删除"}
                              </button>
                            </span>
                          </td>
                        </tr>
                      ))}
                      {typeLabels.length === 0 && (
                        <tr>
                          <td colSpan={5} className="empty-cell">
                            暂无{labelTypeLabel(meta.type)}标签，点击右上角新增
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}

          <p className="label-set-footnote">
            标签体系与 AI 系统提示词相互独立：提示词在「规则与提示词」页维护；
            此处只管理内容标签字典，AI 质检会按启用状态加载标签用于任务分类。
          </p>
        </>
      )}

      {createType && (
        <LabelFormModal
          open
          mode="create"
          defaultType={createType}
          onPublished={setLabelSet}
          onClose={() => setCreateType(undefined)}
          returnFocusRef={{ current: createAnchor }}
        />
      )}
      {selectedLabel && (
        <LabelFormModal
          open
          mode="edit"
          label={selectedLabel}
          onPublished={setLabelSet}
          onClose={() => setSelectedLabel(undefined)}
          returnFocusRef={editTriggerRef}
        />
      )}
      {deleteTarget && (
        <ConfirmModal
          open
          title="删除标签"
          heading={`确认删除${labelTypeLabel(deleteTarget.type)}标签“${deleteTarget.name}”？`}
          description={`当前关联 ${deleteTarget.associationCount} 条视频。删除会发布新的标签体系版本；历史版本和已有视频记录仍保留。`}
          confirmLabel="确认删除"
          busyLabel="删除中…"
          tone="danger"
          busy={deletingLabelId === deleteTarget.id}
          onClose={() => {
            if (!deletingLabelId) setDeleteTarget(undefined);
          }}
          onConfirm={() => void handleDeleteLabel()}
          returnFocusRef={deleteTriggerRef}
        />
      )}
    </div>
  );
}
