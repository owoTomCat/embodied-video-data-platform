"use client";

import { ArrowRight, Eye, Library, Map as MapIcon, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Modal } from "../../components/Modal";
import { useInteractions } from "../../interactions/InteractionContext";
import { listSceneCategories } from "../../scene-guide/client/sceneGuideApi";
import type { SceneCategory } from "../../scene-guide/contracts";
import { listTasksForCollector } from "../../tasks/client/taskApi";
import type { CollectionTaskForCollector } from "../../tasks/contracts";

function fmtHours(seconds: number): string {
  if (seconds <= 0) return "0";
  return String(Math.round((seconds / 3600) * 10) / 10);
}

function taskTypeLabel(type: CollectionTaskForCollector["taskType"]): string {
  if (type === "generic") return "通用";
  if (type === "scene_type") return "补量";
  return "自定义";
}

function percent(current: number, target: number | null): number | null {
  if (!target || target <= 0) return null;
  return Math.min(100, Math.round((current / target) * 100));
}

export function TaskHallPage({ navigate }: { navigate(path: string): void }) {
  const { notify } = useInteractions();
  const [tasks, setTasks] = useState<CollectionTaskForCollector[]>([]);
  const [categories, setCategories] = useState<SceneCategory[]>([]);
  const [mode, setMode] = useState<"loading" | "live" | "unavailable">("loading");
  const [detailTask, setDetailTask] = useState<CollectionTaskForCollector | null>(
    null,
  );

  function load() {
    setMode("loading");
    Promise.all([listTasksForCollector(), listSceneCategories()])
      .then(([taskList, categoryList]) => {
        setTasks(taskList);
        setCategories(categoryList);
        setMode("live");
      })
      .catch(() => setMode("unavailable"));
  }

  useEffect(() => {
    let active = true;
    Promise.all([listTasksForCollector(), listSceneCategories()])
      .then(([taskList, categoryList]) => {
        if (!active) return;
        setTasks(taskList);
        setCategories(categoryList);
        setMode("live");
      })
      .catch(() => {
        if (active) setMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  const categoryName = (key: string | null) =>
    key
      ? categories.find((item) => item.categoryKey === key)?.name ?? key
      : "通用";

  const groups = useMemo(() => {
    const byKey = new Map<string, CollectionTaskForCollector[]>();
    for (const task of tasks) {
      const key = task.categoryKey ?? "generic";
      byKey.set(key, [...(byKey.get(key) ?? []), task]);
    }
    return [...byKey.entries()].map(([key, list]) => ({
      key,
      name: categoryName(key),
      list,
    }));
  }, [tasks, categories]);

  function goCollect(task: CollectionTaskForCollector) {
    navigate(`/collector/tasks/${task.id}/scenes`);
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">众包采集入口</p>
          <h1>任务大厅</h1>
          <span>选择管理员发布的采集任务，查看补量进度并去采集场景</span>
        </div>
      </div>

      {mode === "unavailable" ? (
        <div className="empty-state">
          <Library size={28} />
          <strong>任务服务暂不可用</strong>
          <span>请稍后重试</span>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={load}
          >
            <RefreshCw size={14} />重试
          </button>
        </div>
      ) : (
        <>
          {groups.length === 0 && (
            <div className="empty-state">
              <MapIcon size={28} />
              <strong>暂无进行中的采集任务</strong>
              <span>管理员发布任务后即可在此采集</span>
            </div>
          )}
          {groups.map((group) => (
            <section className="task-hall-category" key={group.key}>
              <div className="task-hall-toolbar-title">
                <strong>{group.name}</strong>
                <span>{group.list.length} 个任务</span>
              </div>
              <div className="task-hall-grid">
                {group.list.map((task) => (
                  <article className="content-card task-card" key={task.id}>
                    <div className="task-card-head">
                      <div>
                        <p className="task-card-eyebrow">
                          <span>{taskTypeLabel(task.taskType)}</span>
                        </p>
                        <h2>{task.title}</h2>
                      </div>
                    </div>
                    <p className="task-desc">
                      {task.description || task.sceneName}
                    </p>

                    <div className="task-card-progress">
                      {percent(task.currentDurationSeconds, task.targetDurationSeconds) !== null ? (
                        <>
                          <div className="task-progress-text">
                            <span>已收集 {fmtHours(task.currentDurationSeconds)} 小时</span>
                            <span>
                              / 目标 {fmtHours(task.targetDurationSeconds ?? 0)} 小时
                            </span>
                            <strong>
                              {percent(task.currentDurationSeconds, task.targetDurationSeconds)}%
                            </strong>
                          </div>
                          <div className="progress-track">
                            <div
                              className="progress-fill"
                              style={{
                                width: `${percent(task.currentDurationSeconds, task.targetDurationSeconds)}%`,
                              }}
                            />
                          </div>
                        </>
                      ) : (
                        <p className="task-type-note">该任务不设目标时长，按实际采集量统计</p>
                      )}
                    </div>

                    <div className="task-card-foot">
                      <button
                        type="button"
                        className="button button-ghost button-small"
                        onClick={() => setDetailTask(task)}
                      >
                        <Eye size={14} />查看详情
                      </button>
                      <button
                        type="button"
                        className="button button-primary button-small"
                        onClick={() => goCollect(task)}
                      >
                        去采集<ArrowRight size={14} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      {detailTask && (
        <TaskDetailModal task={detailTask} onClose={() => setDetailTask(null)} />
      )}
    </div>
  );
}

function TaskDetailModal({
  task,
  onClose,
}: {
  task: CollectionTaskForCollector;
  onClose(): void;
}) {
  return (
    <Modal open title={task.title} onClose={onClose}>
      <div className="modal-form">
        <div className="card-heading">
          <div>
            <h2>{task.title}</h2>
            <p>
              {taskTypeLabel(task.taskType)}任务 · {task.sceneName}
              {task.pricePerHour !== null ? ` · ${task.pricePerHour} 元/小时` : ""}
            </p>
          </div>
        </div>

        <label className="form-label">
          <span>任务说明</span>
          <p className="task-detail-block">{task.description || "（无说明）"}</p>
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

        <p className="task-progress-summary">
          当前进度：已收集 {fmtHours(task.currentDurationSeconds)} 小时
          {task.targetDurationSeconds
            ? ` / 目标 ${fmtHours(task.targetDurationSeconds)} 小时（${percent(
                task.currentDurationSeconds,
                task.targetDurationSeconds,
              )}%）`
            : ""}
        </p>

        <div className="modal-actions">
          <button type="button" className="button button-primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </Modal>
  );
}
