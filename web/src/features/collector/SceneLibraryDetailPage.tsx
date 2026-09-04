"use client";

import {
  ArrowRight,
  Camera,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { BackButton } from "../../components/BackButton";
import { StatusBadge } from "../../components/StatusBadge";
import { useInteractions } from "../../interactions/InteractionContext";
import { getCollectorLibrary, guideTaskErrorMessage } from "../../scene-guide/client/sceneGuideApi";
import type { CollectorLibrary, GuideTask } from "../../scene-guide/contracts";
import { GuideCardSummary } from "./GuideCardView";

const statusLabel: Record<GuideTask["status"], string> = {
  ai_generated: "AI 生成",
};
const statusTone: Record<GuideTask["status"], "success" | "warning" | "danger" | "info"> = {
  ai_generated: "info",
};

export function SceneLibraryDetailPage({
  id,
  navigate,
}: {
  id: string;
  navigate(path: string): void;
}) {
  const { notify } = useInteractions();
  const [mode, setMode] = useState<"loading" | "live" | "unavailable">("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [library, setLibrary] = useState<CollectorLibrary | null>(null);
  const [tasks, setTasks] = useState<GuideTask[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    getCollectorLibrary(id)
      .then((result) => {
        if (!active) return;
        setLibrary(result);
        setTasks(result.tasks ?? []);
        setMode("live");
      })
      .catch(() => {
        if (!active) return;
        setMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, [id, reloadKey]);

  function goCreate() {
    navigate(`/collector/scenes/${id}/create`);
  }

  function goCollect(task: GuideTask) {
    // 从任务卡进入提交：写入任务卡 id + 场景库 id，提交页顶部显示任务卡提示，提交挂场景大类+任务卡id
    sessionStorage.setItem("evdp:selectedGuideTaskId", task.id);
    sessionStorage.setItem("evdp:selectedGuideLibraryId", task.sceneLibraryId ?? "");
    sessionStorage.removeItem("evdp:selectedTaskId");
    navigate("/collector/upload");
  }

  function refresh() {
    setReloadKey((current) => current + 1);
  }

  if (mode === "unavailable") {
    return (
      <div className="page-stack">
        <div className="empty-state"><X size={28} /><strong>场景库加载失败</strong><span>请稍后重试</span></div>
      </div>
    );
  }
  if (mode === "loading") {
    return <div className="page-stack"><div className="empty-state"><span>正在读取场景库…</span></div></div>;
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">我的场景库</p>
          <h1>{library?.name ?? "场景库"}</h1>
          <span>
            {library?.categoryName}
            {library?.scene ? ` · ${library.scene.name}` : ""} · 共 {tasks.length} 张任务卡
          </span>
        </div>
        <div className="task-hall-toolbar-actions">
          <BackButton fallbackPath="/collector/tasks" navigate={navigate} />
          <button type="button" className="button button-primary" onClick={goCreate}>
            <Sparkles size={14} />拍照创建任务
          </button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="empty-state">
          <Camera size={28} />
          <strong>该场景库还没有任务卡</strong>
          <span>点击「拍照创建任务」，拍摄环境照片生成 3-5 张任务卡</span>
        </div>
      ) : (
        <div className="task-hall-grid">
          {tasks.map((task) => (
            <article className="content-card task-card" key={task.id}>
              <div className="task-card-head">
                <div>
                  <p className="task-card-eyebrow"><span>任务卡 {task.taskIndex + 1}</span></p>
                  <h2>{task.title ?? "采集任务"}</h2>
                </div>
                <StatusBadge label={statusLabel[task.status]} tone={statusTone[task.status]} />
              </div>
              <GuideCardSummary card={task.taskCard} />
              <div className="task-card-foot">
                <div className="task-price">
                  <CheckCircle2 size={16} />
                  <span>
                    <strong>{task.submissionId ? "已有提交" : "待采集"}</strong>
                    <small>{task.submissionId ? "已关联提交记录" : "按卡完成一次第一人称操作视频"}</small>
                  </span>
                </div>
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
      )}
    </div>
  );
}
