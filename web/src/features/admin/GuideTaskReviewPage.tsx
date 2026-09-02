"use client";

import {
  CheckCircle2,
  Loader2,
  Map as MapIcon,
  RefreshCw,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";

import { StatusBadge } from "../../components/StatusBadge";
import { useInteractions } from "../../interactions/InteractionContext";
import {
  guideTaskErrorMessage,
  listAllGuideTasks,
  reviewGuideTask,
} from "../../scene-guide/client/sceneGuideApi";
import type { GuideTask } from "../../scene-guide/contracts";

const statusLabel: Record<GuideTask["status"], string> = {
  ai_generated: "AI 生成",
  in_review: "待审核",
  approved: "已通过",
  rejected: "已驳回",
};

const statusTone: Record<GuideTask["status"], "success" | "warning" | "danger" | "info"> = {
  ai_generated: "info",
  in_review: "warning",
  approved: "success",
  rejected: "danger",
};

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "in_review", label: "待审核" },
  { key: "ai_generated", label: "AI 生成" },
  { key: "approved", label: "已通过" },
  { key: "rejected", label: "已驳回" },
] as const;

export function GuideTaskReviewPage() {
  const { notify } = useInteractions();
  const [mode, setMode] = useState<"loading" | "live" | "unavailable">("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [tasks, setTasks] = useState<GuideTask[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listAllGuideTasks()
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
  }, [reloadKey]);

  const visible = tasks.filter(
    (task) => filter === "all" || task.status === filter,
  );

  async function handleReview(task: GuideTask, decision: "approved" | "rejected") {
    setReviewingId(task.id);
    try {
      const updated = await reviewGuideTask(task.id, {
        decision,
        comment:
          decision === "approved"
            ? "管理员审核通过"
            : "任务卡不合格，请重新采集",
      });
      setTasks((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      notify("success", decision === "approved" ? "已通过该任务卡" : "已驳回该任务卡");
    } catch (error) {
      notify("error", guideTaskErrorMessage(error));
    } finally {
      setReviewingId(null);
    }
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">AI 拍照指导</p>
          <h1>指导任务卡审核</h1>
          <span>数采编辑的指导任务卡需人工审核；AI 生成未编辑的任务卡可直接采集</span>
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => setReloadKey((current) => current + 1)}
        >
          <RefreshCw size={14} />刷新
        </button>
      </div>

      {mode === "live" && (
        <div className="task-hall-toolbar">
          <div className="segmented-control" role="group" aria-label="任务卡状态筛选">
            {FILTERS.map((item) => (
              <button
                type="button"
                key={item.key}
                className={filter === item.key ? "active" : ""}
                aria-pressed={filter === item.key}
                onClick={() => setFilter(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === "unavailable" ? (
        <div className="empty-state">
          <XCircle size={28} />
          <strong>指导任务卡服务暂不可用</strong>
          <span>请稍后重试</span>
        </div>
      ) : mode === "loading" ? (
        <div className="empty-state"><span>正在读取指导任务卡…</span></div>
      ) : tasks.length === 0 ? (
        <div className="empty-state">
          <MapIcon size={28} />
          <strong>暂无指导任务卡</strong>
          <span>数采使用拍照指导后生成的卡片会显示在这里</span>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <MapIcon size={26} />
          <strong>没有该状态的任务卡</strong>
          <span>换个筛选条件再试</span>
        </div>
      ) : (
        <div className="task-hall-grid">
          {visible.map((task) => (
            <article className="content-card task-card" key={task.id}>
              <div className="task-card-head">
                <div>
                  <p className="task-card-eyebrow"><span>指导任务卡</span></p>
                  <h2>场景：{task.envObjects.length} 个识别物体 · V{task.id.slice(-4)}</h2>
                </div>
                <StatusBadge label={statusLabel[task.status]} tone={statusTone[task.status]} />
              </div>

              {task.envObjects.length > 0 && (
                <div className="guide-env-object-list">
                  {task.envObjects.map((object, index) => (
                    <span className="guide-env-object" key={`${object.name}-${index}`}>{object.name}</span>
                  ))}
                </div>
              )}

              {task.taskCard && (
                <div className="guide-card-preview">
                  <div className="guide-card-panel">
                    <p className="guide-panel-title">
                      <RefreshCw size={15} />操作步骤
                      <em className="guide-panel-count">{task.taskCard.steps.length} 步</em>
                    </p>
                    <ol className="guide-steps-list">
                      {task.taskCard.steps.map((stepText, index) => (
                        <li key={index}><span>{index + 1}</span>{stepText}</li>
                      ))}
                    </ol>
                  </div>
                  <div className="guide-card-panel">
                    <p className="guide-panel-title"><CheckCircle2 size={15} />结束条件</p>
                    <p className="guide-end-condition">{task.taskCard.end_condition}</p>
                  </div>
                  <div className="guide-card-criteria">
                    <div className="guide-criterion-panel guide-success">
                      <p className="guide-panel-title guide-crite-title-success"><ShieldCheck size={15} />成功判定</p>
                      <ul className="guide-crite-list">
                        {task.taskCard.success_criteria.map((item, index) => <li key={index}><CheckCircle2 size={14} /><span>{item}</span></li>)}
                      </ul>
                    </div>
                    <div className="guide-criterion-panel guide-fail">
                      <p className="guide-panel-title guide-crite-title-fail"><X size={15} />失败判定</p>
                      <ul className="guide-crite-list">
                        {task.taskCard.fail_criteria.map((item, index) => <li key={index}><X size={14} /><span>{item}</span></li>)}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              <div className="task-card-foot">
                <div className="task-price">
                  <ShieldCheck size={16} />
                  <span>
                    <strong>{task.editedAt ? "数采已编辑" : task.status === "ai_generated" ? "AI 生成未编辑" : "已审核"}</strong>
                    <small>{task.editedAt ? "需人工审核" : task.status === "approved" ? "可直接采集" : "无需审核，可直接采集"}</small>
                  </span>
                </div>
                {(task.status === "in_review" || task.status === "ai_generated") && (
                  <div className="guide-review-actions">
                    <button
                      type="button"
                      className="button button-ghost button-small"
                      disabled={reviewingId === task.id}
                      onClick={() => void handleReview(task, "rejected")}
                    >
                      <X size={14} />驳回
                    </button>
                    <button
                      type="button"
                      className="button button-primary button-small"
                      disabled={reviewingId === task.id}
                      onClick={() => void handleReview(task, "approved")}
                    >
                      {reviewingId === task.id ? <Loader2 className="spin" size={14} /> : <CheckCircle2 size={14} />}通过
                    </button>
                  </div>
                )}
              </div>
              {task.status === "approved" && <span className="task-card-ready"><CheckCircle2 size={13} />已通过 · 可采集</span>}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
