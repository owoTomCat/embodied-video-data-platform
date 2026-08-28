"use client";

import {
  ClipboardList,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Square,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  const [deleteTarget, setDeleteTarget] = useState<CollectionTask>();
  const [confirmTarget, setConfirmTarget] = useState<{
    task: CollectionTask;
    action: "publish" | "close";
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
    const task = await createTask(input);
    setTasks((current) => [task, ...current]);
    setTotal((current) => current + 1);
    notify("success", "任务已创建，可进行 AI 要求规范化");
    return task;
  }

  async function handleUpdate(id: string, input: UpdateTaskInput) {
    const task = await updateTask(id, input);
    setTasks((current) =>
      current.map((item) => (item.id === id ? task : item)),
    );
    notify("success", "任务已更新");
    return task;
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
      () => (action === "publish" ? publishTask(task.id) : closeTask(task.id)),
      action === "publish" ? "任务已发布" : "任务已关闭",
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

  function taskStatCell(taskId: string) {
    const stat = statByTask.get(taskId);
    if (!stat) {
      return <span className="muted">—</span>;
    }
    return (
      <span className="task-stat-cell">
        <span><em>提交</em><b>{stat.total}</b></span>
        <span><em>通过率</em><b>{stat.passRate === null ? "—" : `${stat.passRate}%`}</b></span>
        <span><em>锁定金额</em><b>{stat.lockedPoints.toFixed(2)}</b></span>
      </span>
    );
  }

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
        <section className="content-card table-card">
          <div className="card-heading">
            <div>
              <h2>采集任务</h2>
              <p>共 {total} 个任务</p>
            </div>
          </div>
          <div className="table-scroll">
            <table className="data-table task-management-table">
              <thead>
                <tr>
                  <th>任务</th>
                  <th>类型</th>
                  <th>场景</th>
                  <th>任务数据</th>
                  <th>单价</th>
                  <th>状态</th>
                  <th>规范化</th>
                  <th>版本</th>
                  <th>更新时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td className="task-title-cell">
                      <strong>{task.title}</strong>
                      <small className="row-sub">{task.id}</small>
                    </td>
                    <td className="nowrap-cell">
                      <TaskTypeBadge type={task.taskType} />
                    </td>
                    <td>{task.sceneName}</td>
                    <td className="nowrap-cell">{taskStatCell(task.id)}</td>
                    <td className="nowrap-cell">
                      {task.pricePointsPerMinute !== null ? (
                        <span className="mono">
                          {task.pricePointsPerMinute} 元/小时
                        </span>
                      ) : (
                        <span className="muted">全局默认</span>
                      )}
                    </td>
                    <td className="status-cell">
                      <StatusBadge
                        label={statusLabel[task.status]}
                        tone={statusTone[task.status]}
                      />
                    </td>
                    <td className="nowrap-cell">
                      {task.normalizationStatus === "ready" ? (
                        <span className="ok-text">
                          {task.normalizedRequirements?.requirements.length ?? 0} 条
                        </span>
                      ) : (
                        <span className="muted">
                          {task.normalizationStatus === "failed" ? "失败" : "待规范化"}
                        </span>
                      )}
                    </td>
                    <td className="nowrap-cell">V{task.revision}</td>
                    <td className="nowrap-cell">{formatTime(task.updatedAt)}</td>
                    <td className="table-actions-cell">
                      <span className="row-actions">
                        {task.status === "draft" && (
                          <>
                            <button
                              className="table-action"
                              disabled={actingId === task.id}
                              onClick={(event) => {
                                actionTriggerRef.current = event.currentTarget;
                                setEditTarget(task);
                              }}
                            >
                              编辑
                            </button>
                            <button
                              className="table-action"
                              disabled={actingId === task.id}
                              onClick={(event) => {
                                actionTriggerRef.current = event.currentTarget;
                                setNormalizeTarget(task);
                              }}
                            >
                              <WandSparkles size={14} />
                              规范化
                            </button>
                            <button
                              className="table-action"
                              disabled={actingId === task.id}
                              onClick={(event) => {
                                actionTriggerRef.current = event.currentTarget;
                                setConfirmTarget({ task, action: "publish" });
                              }}
                            >
                              发布
                            </button>
                            <button
                              className="table-action danger"
                              disabled={actingId === task.id}
                              aria-label={`删除任务 ${task.title}`}
                              onClick={(event) => {
                                actionTriggerRef.current = event.currentTarget;
                                setDeleteTarget(task);
                              }}
                            >
                              <Trash2 size={14} />
                              删除
                            </button>
                          </>
                        )}
                        {task.status === "published" && (
                          <>
                            <button
                              className="table-action"
                              disabled={actingId === task.id}
                              onClick={(event) => {
                                actionTriggerRef.current = event.currentTarget;
                                setEditTarget(task);
                              }}
                            >
                              编辑
                            </button>
                            <button
                              className="table-action"
                              disabled={actingId === task.id}
                              onClick={() => void pause(task.id)}
                            >
                              <Pause size={14} />
                              暂停
                            </button>
                            <button
                              className="table-action danger"
                              disabled={actingId === task.id}
                              onClick={(event) => {
                                actionTriggerRef.current = event.currentTarget;
                                setConfirmTarget({ task, action: "close" });
                              }}
                            >
                              <Square size={14} />
                              关闭
                            </button>
                          </>
                        )}
                        {task.status === "paused" && (
                          <>
                            <button
                              className="table-action"
                              disabled={actingId === task.id}
                              onClick={(event) => {
                                actionTriggerRef.current = event.currentTarget;
                                setEditTarget(task);
                              }}
                            >
                              编辑
                            </button>
                            <button
                              className="table-action"
                              disabled={actingId === task.id}
                              onClick={() => void resume(task.id)}
                            >
                              <Play size={14} />
                              恢复
                            </button>
                            <button
                              className="table-action danger"
                              disabled={actingId === task.id}
                              onClick={(event) => {
                                actionTriggerRef.current = event.currentTarget;
                                setConfirmTarget({ task, action: "close" });
                              }}
                            >
                              <Square size={14} />
                              关闭
                            </button>
                          </>
                        )}
                        {task.status === "closed" && (
                          <span className="muted">已结束</span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
                {tasks.length === 0 && (
                  <tr>
                    <td colSpan={10} className="empty-cell">
                      暂无任务
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="button button-secondary button-small"
                disabled={page <= 1}
                onClick={() => {
                  setPage(page - 1);
                }}
              >
                上一页
              </button>
              <span>
                {page} / {totalPages}
              </span>
              <button
                className="button button-secondary button-small"
                disabled={page >= totalPages}
                onClick={() => {
                  setPage(page + 1);
                }}
              >
                下一页
              </button>
            </div>
          )}
        </section>
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
          title={confirmTarget.action === "publish" ? "发布采集任务" : "关闭采集任务"}
          heading={
            confirmTarget.action === "publish"
              ? `确认发布“${confirmTarget.task.title}”？`
              : `确认关闭“${confirmTarget.task.title}”？`
          }
          description={
            confirmTarget.action === "publish"
              ? "发布后数采人员即可看到并提交此任务；新的场景名称会自动加入标签字典。"
              : "关闭后任务不可恢复，也不再接受新提交；已经提交的数据仍会继续处理。"
          }
          confirmLabel={confirmTarget.action === "publish" ? "确认发布" : "确认关闭"}
          busyLabel={confirmTarget.action === "publish" ? "发布中…" : "关闭中…"}
          tone={confirmTarget.action === "close" ? "danger" : "primary"}
          busy={actingId === confirmTarget.task.id}
          onClose={() => {
            if (!actingId) setConfirmTarget(undefined);
          }}
          onConfirm={() => void confirmTaskAction()}
          returnFocusRef={actionTriggerRef}
        />
      )}
    </div>
  );
}
