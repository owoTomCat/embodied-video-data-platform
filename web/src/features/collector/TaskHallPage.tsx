"use client";

import {
  ArrowRight,
  Camera,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  Map as MapIcon,
  PauseCircle,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { StatusBadge } from "../../components/StatusBadge";
import { TaskTypeBadge } from "../../components/TaskTypeBadge";
import { useInteractions } from "../../interactions/InteractionContext";
import { getSceneProgress } from "../../scene-system/client/sceneSystemApi";
import type { SceneInventoryItem } from "../../scene-system/client/sceneSystemApi";
import { listTasksForCollector } from "../../tasks/client/taskApi";
import type { CollectionTaskForCollector } from "../../tasks/contracts";

const SELECTED_TASK_STORAGE_KEY = "evdp:selectedTaskId";

function formatMinutes(seconds: number): string {
  if (seconds <= 0) return "0 分钟";
  const minutes = Math.round((seconds / 60) * 10) / 10;
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest > 0 ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

export function TaskHallPage({ navigate }: { navigate(path: string): void }) {
  const { notify } = useInteractions();
  const [tasks, setTasks] = useState<CollectionTaskForCollector[]>([]);
  const [progress, setProgress] = useState<SceneInventoryItem[]>([]);
  const [mode, setMode] = useState<"loading" | "live" | "unavailable">(
    "loading",
  );
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "published" | "paused">("all");

  useEffect(() => {
    let active = true;
    Promise.all([listTasksForCollector(), getSceneProgress()])
      .then(([items, sceneProgress]) => {
        if (!active) return;
        setTasks(items);
        setProgress(sceneProgress ?? []);
        setMode("live");
      })
      .catch(() => {
        if (!active) return;
        setMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  function goCollect(task: CollectionTaskForCollector) {
    if (task.status !== "published") {
      notify("error", "该任务当前已暂停，暂不可提交");
      return;
    }
    sessionStorage.setItem(SELECTED_TASK_STORAGE_KEY, task.id);
    navigate("/collector/upload");
  }

  function goPhotoGuide(task: CollectionTaskForCollector) {
    if (task.status !== "published") {
      notify("error", "该任务当前已暂停，暂不可提交");
      return;
    }
    sessionStorage.setItem(SELECTED_TASK_STORAGE_KEY, task.id);
    navigate("/collector/photo-guide");
  }

  const filteredTasks = useMemo(() => {
    const term = query.trim().toLowerCase();
    return tasks.filter((task) => {
      if (status !== "all" && task.status !== status) return false;
      if (!term) return true;
      const content = `${task.title} ${task.sceneName} ${task.description} ${task.normalizedRequirements?.scene_description ?? ""}`.toLowerCase();
      return content.includes(term);
    });
  }, [query, status, tasks]);

  const progressByScene = useMemo(() => {
    const map = new Map<string, SceneInventoryItem>();
    for (const item of progress) map.set(item.sceneName, item);
    return map;
  }, [progress]);

  // 场景型任务所属场景（用于进度面板，缺口大的在前）
  const sceneTypeScenes = useMemo(() => {
    const wanted = new Set<string>();
    for (const task of tasks) {
      if (task.taskType === "scene_type" && task.sceneName) {
        wanted.add(task.sceneName);
      }
    }
    const items = [...wanted]
      .map((name) => progressByScene.get(name))
      .filter((item): item is SceneInventoryItem => Boolean(item))
      .sort((left, right) => right.shortfallSeconds - left.shortfallSeconds);
    return items;
  }, [progressByScene, tasks]);

  const availableCount = tasks.filter((task) => task.status === "published").length;
  const pausedCount = tasks.length - availableCount;

  function renderSceneProgress(task: CollectionTaskForCollector) {
    if (task.taskType !== "scene_type") return null;
    const item = progressByScene.get(task.sceneName);
    const target = item?.targetSeconds ?? task.targetDurationSeconds ?? 0;
    const current = item?.currentSeconds ?? 0;
    const shortfall = item?.shortfallSeconds ?? Math.max(0, target - current);
    const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
    return (
      <div className="task-scene-progress">
        <div className="task-scene-progress-head">
          <span><MapIcon size={13} />本场景采集进度</span>
          <em>{target > 0 ? "缺口 " + formatMinutes(shortfall) : "尚未设置目标"}</em>
        </div>
        <div className="scene-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${task.sceneName} 采集进度 ${pct}%`}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="task-scene-progress-meta">
          <span>已采 <strong>{formatMinutes(current)}</strong></span>
          <span>目标 <strong>{target > 0 ? formatMinutes(target) : "—"}</strong></span>
        </div>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">众包采集入口</p>
          <h1>任务大厅</h1>
          <span>选择正在进行的采集任务，按任务要求拍摄并提交视频</span>
        </div>
      </div>

      {mode === "live" && tasks.length > 0 && (
        <>
          <section className="task-hall-summary" aria-label="任务概览">
            <div className="task-hall-summary-copy">
              <span className="task-hall-summary-icon"><ClipboardList size={22} /></span>
              <div>
                <strong>找到适合的任务，先读要求再拍摄</strong>
                <p>进行中的任务可立即提交；场景型任务会显示各场景采集缺口，优先补量场景更容易被质检通过。</p>
              </div>
            </div>
            <div className="task-hall-stats">
              <span><strong>{availableCount}</strong><small>可提交</small></span>
              <span><strong>{pausedCount}</strong><small>已暂停</small></span>
              <span><strong>{tasks.length}</strong><small>全部任务</small></span>
            </div>
          </section>
          <div className="task-hall-toolbar">
            <label className="search-field task-hall-search">
              <Search size={16} />
              <input
                aria-label="搜索任务"
                value={query}
                placeholder="搜索任务名称或场景"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="segmented-control" role="group" aria-label="任务状态筛选">
              {(["all", "published", "paused"] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  className={status === value ? "active" : ""}
                  aria-pressed={status === value}
                  onClick={() => setStatus(value)}
                >
                  {value === "all" ? "全部" : value === "published" ? "可提交" : "暂停中"}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* 场景型任务：缺口优先面板 */}
      {mode === "live" && sceneTypeScenes.length > 0 && (
        <section className="content-card task-scene-layout" aria-label="场景采集缺口">
          <div className="card-heading">
            <div>
              <h2>场景采集进度</h2>
              <p>各场景当前合格存量 vs 目标时长，缺口大的场景优先采集可更快补齐</p>
            </div>
          </div>
          <div className="task-scene-grid">
            {sceneTypeScenes.map((item) => {
              const pct =
                item.targetSeconds > 0
                  ? Math.min(100, Math.round((item.currentSeconds / item.targetSeconds) * 100))
                  : 0;
              return (
                <div className="task-scene-cell" key={item.sceneName}>
                  <div className="task-scene-cell-head">
                    <strong>{item.sceneName}</strong>
                    {item.shortfallSeconds > 0 ? (
                      <StatusBadge label="需补量" tone="warning" />
                    ) : (
                      <StatusBadge label="达标" tone="success" />
                    )}
                  </div>
                  <div className="scene-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${item.sceneName} 采集进度 ${pct}%`}>
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  <div className="task-scene-cell-meta">
                    <span>已采 <strong>{formatMinutes(item.currentSeconds)}</strong></span>
                    <span>目标 <strong>{item.targetSeconds > 0 ? formatMinutes(item.targetSeconds) : "—"}</strong></span>
                    <span className={item.shortfallSeconds > 0 ? "gap" : "ok"}>缺口 <strong>{item.shortfallSeconds > 0 ? formatMinutes(item.shortfallSeconds) : "0"}</strong></span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {mode === "unavailable" ? (
        <div className="empty-state">
          <ClipboardList size={28} />
          <strong>任务服务暂不可用</strong>
          <span>请稍后重试</span>
        </div>
      ) : mode === "loading" ? (
        <div className="empty-state">
          <span>正在读取任务…</span>
        </div>
      ) : tasks.length === 0 ? (
        <div className="empty-state">
          <ClipboardList size={28} />
          <strong>暂无进行中的任务</strong>
          <span>管理员发布任务后即可在此查看并提交</span>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="empty-state">
          <Search size={26} />
          <strong>没有匹配的任务</strong>
          <span>换个关键词或状态再试</span>
        </div>
      ) : (
        <div className="task-hall-grid">
          {filteredTasks.map((task) => (
            <article className="content-card task-card" key={task.id}>
              <div className="task-card-head">
                <div>
                  <p className="task-card-eyebrow">
                    {task.taskType === "generic" ? (
                      <>
                        <TaskTypeBadge type="generic" />
                        <span>不限具体场景</span>
                      </>
                    ) : (
                      <>
                        <TaskTypeBadge type={task.taskType} label={task.taskType === "preset" ? "场景任务" : task.taskType === "scene_type" ? "场景型" : "自定义"} />
                        <span>场景：{task.sceneName}</span>
                      </>
                    )}
                  </p>
                  <h2>{task.title}</h2>
                </div>
                <StatusBadge
                  label={task.status === "paused" ? "已暂停" : "进行中"}
                  tone={task.status === "paused" ? "warning" : "success"}
                />
              </div>
              <p className="task-desc">
                {task.normalizedRequirements?.scene_description ??
                  (task.description || "（任务未提供说明）")}
              </p>
              {renderSceneProgress(task)}
              {task.normalizedRequirements?.requirements.length ? (
                <div className="task-requirement-block">
                  <div className="task-requirement-heading">
                    <span><ShieldCheck size={14} />拍摄要求</span>
                    <em>共 {task.normalizedRequirements.requirements.length} 条</em>
                  </div>
                  <ul className="task-req-list">
                    {task.normalizedRequirements.requirements
                      .slice(0, 4)
                      .map((item, index) => (
                        <li key={`${item.type}-${index}`}>
                          <span className={`req-badge ${item.type}`}>
                            {item.type === "hard" ? "硬性" : "一般"}
                          </span>
                          <span>{item.content}</span>
                        </li>
                      ))}
                    {task.normalizedRequirements.requirements.length > 4 && (
                      <li className="req-more">
                        进入提交页可查看全部要求
                      </li>
                    )}
                  </ul>
                </div>
              ) : null}
              <div className="task-card-foot">
                <div className="task-price">
                  <CircleDollarSign size={16} />
                  <span><strong>{task.pricePointsPerMinute !== null ? `${task.pricePointsPerMinute} 元/小时` : "按全局规则计费"}</strong><small>通过质检后计入金额</small></span>
                </div>
                {task.taskType === "scene_type" ? (
                  <div className="task-card-actions">
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      disabled={task.status !== "published"}
                      onClick={() => goPhotoGuide(task)}
                    >
                      <Camera size={14} />拍照指导
                    </button>
                    <button
                      type="button"
                      className="button button-primary button-small"
                      disabled={task.status !== "published"}
                      onClick={() => goCollect(task)}
                    >
                      {task.status === "paused" ? (
                        <>
                          <PauseCircle size={14} />
                          已暂停
                        </>
                      ) : (
                        <>
                          去采集
                          <ArrowRight size={14} />
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="button button-primary button-small"
                    disabled={task.status !== "published"}
                    onClick={() => goCollect(task)}
                  >
                    {task.status === "paused" ? (
                      <>
                        <PauseCircle size={14} />
                        已暂停
                      </>
                    ) : (
                      <>
                        去采集
                        <ArrowRight size={14} />
                      </>
                    )}
                  </button>
                )}
              </div>
              {task.status === "published" && (
                <span className="task-card-ready"><CheckCircle2 size={13} />当前可提交</span>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
