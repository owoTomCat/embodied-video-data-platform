"use client";

import {
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  PauseCircle,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { StatusBadge } from "../../components/StatusBadge";
import { TaskTypeBadge } from "../../components/TaskTypeBadge";
import { useInteractions } from "../../interactions/InteractionContext";
import { listTasksForCollector } from "../../tasks/client/taskApi";
import type { CollectionTaskForCollector } from "../../tasks/contracts";

const SELECTED_TASK_STORAGE_KEY = "evdp:selectedTaskId";

export function TaskHallPage({ navigate }: { navigate(path: string): void }) {
  const { notify } = useInteractions();
  const [tasks, setTasks] = useState<CollectionTaskForCollector[]>([]);
  const [mode, setMode] = useState<"loading" | "live" | "unavailable">(
    "loading",
  );
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "published" | "paused">("all");

  useEffect(() => {
    let active = true;
    listTasksForCollector()
      .then((items) => {
        if (!active) return;
        setTasks(items);
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

  const filteredTasks = useMemo(() => {
    const term = query.trim().toLowerCase();
    return tasks.filter((task) => {
      if (status !== "all" && task.status !== status) return false;
      if (!term) return true;
      const content = `${task.title} ${task.sceneName} ${task.description} ${task.normalizedRequirements?.scene_description ?? ""}`.toLowerCase();
      return content.includes(term);
    });
  }, [query, status, tasks]);

  const availableCount = tasks.filter((task) => task.status === "published").length;
  const pausedCount = tasks.length - availableCount;

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
                <p>进行中的任务可立即提交；暂停任务仍可查看，但暂不能上传。</p>
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
                        <TaskTypeBadge type={task.taskType} label={task.taskType === "preset" ? "场景任务" : "自定义"} />
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
