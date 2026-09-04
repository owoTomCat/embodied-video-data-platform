import { CopyCheck, Eye, FileVideo, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { Submission } from "../domain/types";
import { submissionStatus } from "../submissions/submissionStatus";
import { QualityScore } from "./QualityScore";
import { StatusBadge } from "./StatusBadge";


function formatDuration(seconds: number, item: Submission) {
  if (!seconds) {
    if (item.pipelineStage === "system_failed" || item.pipelineStage === "stuck") {
      return "—";
    }
    return "解析中";
  }
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

export function SubmissionTable({
  submissions,
  showOwner = false,
  showTaskSource = false,
  showSubmittedAt = false,
  actionLabel = "详情",
  onAction,
  renderActions,
  loading = false,
}: {
  submissions: Submission[];
  showOwner?: boolean;
  showTaskSource?: boolean;
  /** 提交时间作为独立列展示（默认混在视频提交列内） */
  showSubmittedAt?: boolean;
  actionLabel?: string;
  onAction?(submission: Submission): void;
  renderActions?(submission: Submission): ReactNode;
  loading?: boolean;
}) {
  const extraColumns =
    Number(showOwner) + Number(showTaskSource) + Number(showSubmittedAt);
  if (loading) {
    return (
      <div className="table-scroll" aria-label="正在加载数据">
        <table className="data-table submission-table">
          <tbody>
            {Array.from({ length: 5 }, (_, index) => (
              <tr key={`skeleton-${index}`}>
                <td colSpan={6 + extraColumns}>
                  <span className="skeleton-row" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (!submissions.length) {
    return <div className="empty-state"><FileVideo size={26} /><strong>没有找到数据</strong><span>请调整筛选条件后再试</span></div>;
  }

  return (
    <div className="table-scroll">
      <table className="data-table submission-table">
        <thead><tr><th>视频提交</th>{showOwner && <th>成员 / 团队</th>}{showTaskSource && <th>任务来源</th>}{showSubmittedAt && <th>提交时间</th>}<th>场景与动作</th><th>时长</th><th>处理状态</th><th>质量评分</th><th /></tr></thead>
        <tbody>
          {submissions.map((item) => {
            const { label, tone } = submissionStatus(item);
            return (
              <tr key={item.id}>
                <td><div className="file-cell">{item.thumbnailUrl ? <img className="file-thumb" src={item.thumbnailUrl} alt={`${item.fileName} 缩略图`} loading="lazy" /> : <span><FileVideo size={17} /></span>}<div><strong>{item.fileName}</strong><small>{item.id}{showSubmittedAt ? "" : ` · ${item.createdAt}`}</small>{item.assetStatus === "quarantined" && <em><ShieldAlert size={12} />敏感隔离</em>}{item.duplicateCandidates?.some((candidate) => candidate.status === "candidate") && <em className="warning-tag"><CopyCheck size={12} />疑似重复</em>}</div></div></td>
                {showOwner && <td className="owner-cell"><div className="stack-cell"><strong>{item.ownerName}</strong><small>{item.teamName}</small></div></td>}
                {showTaskSource && (
                  <td className="task-source-cell">
                    <div className="stack-cell">
                      {item.task ? (
                        <>
                          <strong>{item.task.title || item.task.sceneName}</strong>
                          <small>{item.task.taskId}</small>
                        </>
                      ) : (
                        <>
                          <strong>历史自由提交</strong>
                          <small>未关联采集任务</small>
                        </>
                      )}
                    </div>
                  </td>
                )}
                {showSubmittedAt && <td className="submitted-at-cell">{item.createdAt}</td>}
                <td className="submission-context-cell"><div className="stack-cell">{item.task ? <><strong>{item.task.sceneName}</strong><small>任务 · {item.task.sceneName}</small></> : <><strong>{item.scene}</strong><small>{item.action}</small></>}</div></td>
                <td className="duration-cell">{formatDuration(item.durationSeconds, item)}</td>
                <td className="status-cell"><StatusBadge label={label} tone={tone} /></td>
                <td className="quality-cell"><QualityScore score={item.finalScore} ratio={item.qualityResult?.settlementRatio} passed={item.qualityResult?.passed} /></td>
                <td className="table-actions-cell">{renderActions ? renderActions(item) : onAction && <button className="table-action" aria-label={actionLabel} onClick={() => onAction(item)}><Eye size={15} />{actionLabel}</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
