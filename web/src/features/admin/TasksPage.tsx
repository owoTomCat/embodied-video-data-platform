"use client";

import {
  ClipboardList,
  Eye,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  RotateCcw,
  Search,
  Square,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "../../components/Modal";
import { StatusBadge } from "../../components/StatusBadge";
import { ConfirmModal } from "../../components/ConfirmModal";
import { TaskTypeBadge } from "../../components/TaskTypeBadge";
import { useInteractions } from "../../interactions/InteractionContext";
import { useTaskStats } from "../../submissions/client/useTaskStats";
import type {
  CollectionTask,
  CollectionTaskStatus,
  ConfirmRequirementsInput,
  CreateTaskInput,
  UpdateTaskInput,
} from "../../tasks/contracts";
import {
  closeTask,
  confirmTaskRequirements,
  createTask,
  deleteTask,
  listManageTasks,
  pauseTask,
  publishTask,
  reopenTask,
  resumeTask,
  taskErrorMessage,
  updateTask,
} from "../../tasks/client/taskApi";
import { TaskFormModal } from "./TaskFormModal";
import { TaskNormalizeModal } from "./TaskNormalizeModal";

const statusLabel: Record<CollectionTaskStatus, string> = {
  draft: "草稿",
  published: "已发布",
  paused: "已暂停",
  closed: "已关闭",
};

const statusTone: Record<CollectionTaskStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  draft: "neutral",
  published: "success",
  paused: "warning",
  closed: "neutral",
};

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function fmtHours(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "0";
  return String(Math.round((seconds / 3600) * 10) / 10);
}

export function TasksPage() {
  const { notify } = useInteractions();
  const { stats: taskStats } = useTaskStats();
  const [mode, setMode] = useState<"loading" | "live" | "unavailable">(
    "loading",
  );
  const [tasks, setTasks] = useState<CollectionTask[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState<"all" | CollectionTaskStatus>("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CollectionTask>();
  const [normalizeTarget, setNormalizeTarget] = useState<CollectionTask>();
  const [detailTarget, setDetailTarget] = useState<CollectionTask>();
  const [deleteTarget, setDeleteTarget] = useState<CollectionTask>();
  const [confirmTarget, setConfirmTarget] = useState<{
    task: CollectionTask;
    action: "publish" | "close" | "reopen";
  }>();
  const [actingId, setActingId] = useState<string>();
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const actionTriggerRef = useRef<HTMLButtonElement>(null);

  const reload = useCallback(
    async (options?: { status?: "all" | CollectionTaskStatus; q?: string; page?: number }) => {
      try {
        const result = await listManageTasks({
          status: options?.status ?? statusFilter,
          q: options?.q ?? search,
          page: options?.page ?? page,
          pageSize,
        });
        setTasks(result.tasks);
        setTotal(result.pagination.total);
        setPage(result.pagination.page);
        setMode("live");
      } catch {
        setMode("unavailable");
      }
    },
    [pageSize, search, statusFilter, page],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reload();
    }, 150);
    return () => window.clearTimeout(timer);
  }, [reload]);

  function changeStatus(next: "all" | CollectionTaskStatus) {
    setStatusFilter(next);
    setPage(1);
  }

  function changeSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  async function handleCreate(input: CreateTaskInput) {
    const result = await createTask(input);
    setTasks((current) => [result.task, ...current]);
    setTotal((current) => current + 1);
    if (result.autoNormalized) {
      const count =
        result.task.normalizedRequirements?.requirements.length ?? 0;
      notify(
        "success",
        `任务已创建，提示词已自动规范化（${count} 条要求），请核查后发布`,
      );
    } else if (result.normalizationFailed) {
      notify(
        "error",
        "任务已创建，但提示词自动规范化失败，请手动点击「规范化」重试",
      );
    } else {
      notify("success", "任务已创建");
    }
    return result.task;
  }

  async function handleUpdate(id: string, input: UpdateTaskInput) {
    const result = await updateTask(id, input);
    setTasks((current) =>
      current.map((item) => (item.id === id ? result.task : item)),
    );
    if (result.autoNormalized) {
      const count =
        result.task.normalizedRequirements?.requirements.length ?? 0;
      notify(
        "success",
        `任务已更新，提示词已自动规范化（${count} 条要求），可直接发布`,
      );
    } else if (result.normalizationFailed) {
      notify(
        "error",
        "任务已更新，但提示词自动规范化失败，请点击「规范化」手动重试",
      );
    } else {
      notify("success", "任务已更新");
    }
    return result.task;
  }

  async function handleConfirm(id: string, input: ConfirmRequirementsInput) {
    const task = await confirmTaskRequirements(id, input);
    setTasks((current) =>
      current.map((item) => (item.id === id ? task : item)),
    );
    notify("success", "规范化要求已确认，可发布任务");
    return task;
  }

  async function act(
    id: string,
    operation: () => Promise<CollectionTask>,
    successMessage: string,
  ): Promise<boolean> {
    if (actingId) return false;
    setActingId(id);
    try {
      const task = await operation();
      setTasks((current) =>
        current.map((item) => (item.id === id ? task : item)),
      );
      notify("success", successMessage);
      return true;
    } catch (reason) {
      notify("error", taskErrorMessage(reason));
      return false;
    } finally {
      setActingId(undefined);
    }
  }

  async function pause(id: string) {
    await act(id, () => pauseTask(id), "任务已暂停");
  }

  async function resume(id: string) {
    await act(id, () => resumeTask(id), "任务已恢复");
  }

  async function confirmTaskAction() {
    if (!confirmTarget || actingId) return;
    const { task, action } = confirmTarget;
    const succeeded = await act(
      task.id,
      () =>
        action === "publish"
          ? publishTask(task.id)
          : action === "close"
            ? closeTask(task.id)
            : reopenTask(task.id),
      action === "publish"
        ? "任务已发布"
        : action === "close"
          ? "任务已关闭"
          : "任务已重新开启",
    );
    if (succeeded) setConfirmTarget(undefined);
  }

  async function removeDraft() {
    if (!deleteTarget || actingId) return;
    const target = deleteTarget;
    setActingId(target.id);
    try {
      await deleteTask(target.id);
      setTasks((current) => current.filter((item) => item.id !== target.id));
      setTotal((current) => Math.max(0, current - 1));
      setDeleteTarget(undefined);
      notify("success", "草稿任务已删除");
      if (tasks.length === 1 && page > 1) setPage((current) => current - 1);
    } catch (reason) {
      notify("error", taskErrorMessage(reason));
    } finally {
      setActingId(undefined);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const statByTask = new Map(
    taskStats
      .filter((stat) => stat.taskId !== null)
      .map((stat) => [stat.taskId as string, stat]),
  );
  // 排序：通用任务置顶，已关闭任务统一置底
  const sortedTasks = [...tasks].sort((a, b) => {
    const weight = (t: CollectionTask) =>
      (t.status === "closed" ? 10 : 0) + (t.taskType === "generic" ? 0 : 1);
    return weight(a) - weight(b);
  });

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">采集任务管理</p>
          <h1>任务管理</h1>
          <span>发布采集任务，限定场景与要求，数采人员按任务提交视频</span>
        </div>
        <div className="page-heading-actions">
          <button
            ref={createTriggerRef}
            className="button button-primary"
            disabled={mode === "unavailable"}
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={16} />
            创建任务
          </button>
        </div>
      </div>

      <div className="toolbar">
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="搜索标题或场景"
            value={search}
            onChange={(event) => changeSearch(event.target.value)}
            placeholder="搜索标题或场景"
          />
        </div>
        <div className="segmented-control" role="group" aria-label="按任务状态筛选">
          {(["all", "draft", "published", "paused", "closed"] as const).map(
            (status) => (
              <button
                key={status}
                className={statusFilter === status ? "active" : ""}
                aria-pressed={statusFilter === status}
                onClick={() => changeStatus(status)}
              >
                {status === "all" ? "全部" : statusLabel[status]}
              </button>
            ),
          )}
        </div>
      </div>

      {mode === "unavailable" ? (
        <div className="empty-state">
          <ClipboardList size={28} />
          <strong>任务服务暂不可用</strong>
          <span>请确认后端已启动后重试</span>
        </div>
      ) : mode === "loading" ? (
        <div className="empty-state">
          <RefreshCw size={28} className="spin" />
          <span>正在读取任务…</span>
        </div>
      ) : (
        <>
          <div className="task-admin-grid">
            {sortedTasks.map((task) => {
              const stat = statByTask.get(task.id);
              return (
                <article className="content-card task-card admin-task-card" key={task.id}>
                  <div className="task-card-head">
                    <div>
                      <p className="task-card-eyebrow">
                        <TaskTypeBadge type={task.taskType} />
                      </p>
                      <h2>{task.title}</h2>
                    </div>
                    <div className="task-card-head-actions">
                      <StatusBadge
                        label={statusLabel[task.status]}
                        tone={statusTone[task.status]}
                      />
                      <details className="task-menu">
                        <summary className="task-menu-btn" aria-label="更多操作">
                          <MoreHorizontal size={18} />
                        </summary>
                        <div className="task-menu-popover">
                          {task.status === "draft" && (
                            <>
                              <button
                                className="danger"
                                onClick={(event) => {
                                  actionTriggerRef.current = event.currentTarget;
                                  setDeleteTarget(task);
                                }}
                              >
                                <Trash2 size={14} />删除
                              </button>
                            </>
                          )}
                          {task.status === "published" && (
                            <>
                              <button onClick={() => void pause(task.id)}>
                                <Pause size={14} />暂停
                              </button>
                              <button
                                className="danger"
                                onClick={(event) => {
                                  actionTriggerRef.current = event.currentTarget;
                                  setConfirmTarget({ task, action: "close" });
                                }}
                              >
                                <Square size={14} />结束
                              </button>
                            </>
                          )}
                          {task.status === "paused" && (
                            <>
                              <button onClick={() => void resume(task.id)}>
                                <Play size={14} />恢复
                              </button>
                              <button
                                className="danger"
                                onClick={(event) => {
                                  actionTriggerRef.current = event.currentTarget;
                                  setConfirmTarget({ task, action: "close" });
                                }}
                              >
                                <Square size={14} />结束
                              </button>
                            </>
                          )}
                          {task.status === "closed" && (
                            <button
                              onClick={(event) => {
                                actionTriggerRef.current = event.currentTarget;
                                setConfirmTarget({ task, action: "reopen" });
                              }}
                            >
                              <RotateCcw size={14} />重新开启
                            </button>
                          )}
                        </div>
                      </details>
                    </div>
                  </div>

                  <div className="task-card-stats">
                    <span><em>提交</em><b>{stat?.total ?? "—"}</b></span>
                    <span>
                      <em>通过率</em>
                      <b>{stat?.passRate == null ? "—" : `${stat.passRate}%`}</b>
                    </span>
                    <span>
                      <em>平均得分</em>
                      <b>{stat?.avgScore == null ? "—" : stat.avgScore}</b>
                    </span>
                  </div>

                  <div className="task-card-duration">
                    <span className="task-dur-label">数据时长</span>
                    <span>
                      已收集 {fmtHours((stat?.effectiveMinutes ?? 0) * 60)} 小时 / 目标{" "}
                      {task.targetDurationSeconds
                        ? fmtHours(task.targetDurationSeconds)
                        : "无"}{" "}
                      小时
                    </span>
                  </div>

                  <div className="task-card-meta">
                    <span>
                      {task.pricePerHour !== null
                        ? `${task.pricePerHour} 元/小时`
                        : "全局默认"}
                    </span>
                    <span className="muted">{formatTime(task.updatedAt)}</span>
                    <span className="muted">V{task.revision}</span>
                  </div>

                  <div className="task-card-foot">
                    <button
                      type="button"
                      className="button button-ghost button-small"
                      onClick={() => setDetailTarget(task)}
                    >
                      <Eye size={14} />查看详情
                    </button>
                    <div className="task-card-foot-actions">
                      {task.status === "draft" && (
                        <>
                          <button
                            type="button"
                            className="button button-primary button-small"
                            onClick={(event) => {
                              actionTriggerRef.current = event.currentTarget;
                              setConfirmTarget({ task, action: "publish" });
                            }}
                          >
                            <Rocket size={14} />发布
                          </button>
                          <button
                            type="button"
                            className="button button-secondary button-small"
                            onClick={(event) => {
                              actionTriggerRef.current = event.currentTarget;
                              setNormalizeTarget(task);
                            }}
                          >
                            <WandSparkles size={14} />规范化
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className={`button button-small ${task.status === "draft" ? "button-ghost" : "button-primary"}`}
                        onClick={(event) => {
                          actionTriggerRef.current = event.currentTarget;
                          setEditTarget(task);
                        }}
                      >
                        编辑
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
            {tasks.length === 0 && (
              <div
                className="empty-state"
                style={{ gridColumn: "1 / -1" }}
              >
                暂无任务
              </div>
            )}
          </div>
          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="button button-secondary button-small"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                上一页
              </button>
              <span>
                {page} / {totalPages}
              </span>
              <button
                className="button button-secondary button-small"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}

      {createOpen && (
        <TaskFormModal
          open
          mode="create"
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onClose={() => setCreateOpen(false)}
          returnFocusRef={createTriggerRef}
        />
      )}
      {editTarget && (
        <TaskFormModal
          key={editTarget.id}
          open
          mode="edit"
          task={editTarget}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onClose={() => setEditTarget(undefined)}
          returnFocusRef={actionTriggerRef}
        />
      )}
      {normalizeTarget && (
        <TaskNormalizeModal
          open
          task={normalizeTarget}
          onConfirm={handleConfirm}
          onClose={() => setNormalizeTarget(undefined)}
          returnFocusRef={actionTriggerRef}
        />
      )}
      {deleteTarget && (
        <ConfirmModal
          open
          title="删除草稿任务"
          heading={`确认删除“${deleteTarget.title}”？`}
          description={`任务编号 ${deleteTarget.id}。删除后无法恢复；已发布任务不会提供删除入口，以确保提交数据可追溯。`}
          confirmLabel="确认删除"
          busyLabel="删除中…"
          tone="danger"
          busy={actingId === deleteTarget.id}
          onClose={() => {
            if (!actingId) setDeleteTarget(undefined);
          }}
          onConfirm={() => void removeDraft()}
          returnFocusRef={actionTriggerRef}
        />
      )}
      {confirmTarget && (
        <ConfirmModal
          open
          title={
            confirmTarget.action === "publish"
              ? "发布采集任务"
              : confirmTarget.action === "close"
                ? "关闭采集任务"
                : "重新开启采集任务"
          }
          heading={
            confirmTarget.action === "publish"
              ? `确认发布“${confirmTarget.task.title}”？`
              : confirmTarget.action === "close"
                ? `确认关闭“${confirmTarget.task.title}”？`
                : `确认重新开启“${confirmTarget.task.title}”？`
          }
          description={
            confirmTarget.action === "publish"
              ? "发布后数采人员即可看到并提交此任务；新的场景名称会自动加入标签字典。"
              : confirmTarget.action === "close"
                ? "关闭后任务不再接受新提交；已经提交的数据仍会继续处理，如需继续收集可重新开启。"
                : "重新开启后任务将恢复为发布状态，数采人员可继续提交；已提交的数据与统计记录会保留。"
          }
          confirmLabel={
            confirmTarget.action === "publish"
              ? "确认发布"
              : confirmTarget.action === "close"
                ? "确认关闭"
                : "确认重新开启"
          }
          busyLabel={
            confirmTarget.action === "publish"
              ? "发布中…"
              : confirmTarget.action === "close"
                ? "关闭中…"
                : "开启中…"
          }
          tone={confirmTarget.action === "close" ? "danger" : "primary"}
          busy={actingId === confirmTarget.task.id}
          onClose={() => {
            if (!actingId) setConfirmTarget(undefined);
          }}
          onConfirm={() => void confirmTaskAction()}
          returnFocusRef={actionTriggerRef}
        />
      )}
      {detailTarget && (
        <TaskDetailModal task={detailTarget} onClose={() => setDetailTarget(undefined)} />
      )}
    </div>
  );
}

function TaskDetailModal({
  task,
  onClose,
}: {
  task: CollectionTask;
  onClose(): void;
}) {
  return (
    <Modal open title={task.title} onClose={onClose}>
      <div className="modal-form">
        <div className="card-heading">
          <div>
            <h2>{task.title}</h2>
            <p>
              <TaskTypeBadge type={task.taskType} /> · {task.sceneName}
              {task.pricePerHour !== null ? ` · ${task.pricePerHour} 元/小时` : ""}
            </p>
          </div>
          <StatusBadge label={statusLabel[task.status]} tone={statusTone[task.status]} />
        </div>

        <label className="form-label">
          <span>任务说明</span>
          <p className="task-detail-block">{task.description || "（无说明）"}</p>
        </label>
        <label className="form-label">
          <span>任务编号 / 版本</span>
          <p className="task-detail-block">{task.id} · V{task.revision}</p>
        </label>

        {task.normalizedRequirements && (
          <>
            <label className="form-label">
              <span>场景描述</span>
              <p className="task-detail-block">
                {task.normalizedRequirements.scene_description}
              </p>
            </label>
            <label className="form-label">
              <span>采集要求</span>
              <ul className="check-list compact">
                {task.normalizedRequirements.requirements.map((item, index) => (
                  <li key={`${item.type}-${index}`}>
                    <span>
                      <strong>
                        {item.type === "hard" ? "【硬性】" : "【一般】"}
                        {item.content}
                      </strong>
                      {item.rationale ? <small>{item.rationale}</small> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </label>
          </>
        )}

        <label className="form-label">
          <span>规范化状态</span>
          <p className="task-detail-block">
            {task.normalizationStatus === "ready"
              ? `已完成（${task.normalizedRequirements?.requirements.length ?? 0} 条要求）`
              : task.normalizationStatus === "failed"
                ? "失败"
                : "待规范化"}
          </p>
        </label>

        <div className="modal-actions">
          <button type="button" className="button button-primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </Modal>
  );
}
