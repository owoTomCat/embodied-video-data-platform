import { Eye, FileVideo } from "lucide-react";
import type { Submission } from "../domain/types";
import { QualityScore } from "./QualityScore";
import { StatusBadge } from "./StatusBadge";

const processingLabel = {
  uploading: ["上传中", "info"],
  queued: ["AI 排队", "warning"],
  processing: ["分析中", "info"],
  completed: ["处理完成", "success"],
  failed: ["处理失败", "danger"],
} as const;

function formatDuration(seconds: number) {
  if (!seconds) return "解析中";
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

export function SubmissionTable({
  submissions,
  showOwner = false,
  actionLabel = "详情",
  onAction,
}: {
  submissions: Submission[];
  showOwner?: boolean;
  actionLabel?: string;
  onAction?(submission: Submission): void;
}) {
  if (!submissions.length) {
    return <div className="empty-state"><FileVideo size={26} /><strong>没有找到数据</strong><span>请调整筛选条件后再试</span></div>;
  }

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead><tr><th>视频提交</th>{showOwner && <th>成员 / 团队</th>}<th>场景与动作</th><th>时长</th><th>处理状态</th><th>质量评分</th><th /></tr></thead>
        <tbody>
          {submissions.map((item) => {
            const [label, tone] = processingLabel[item.processingStatus];
            return (
              <tr key={item.id}>
                <td><div className="file-cell"><span><FileVideo size={17} /></span><div><strong>{item.fileName}</strong><small>{item.id} · {item.createdAt}</small></div></div></td>
                {showOwner && <td><div className="stack-cell"><strong>{item.ownerName}</strong><small>{item.teamName}</small></div></td>}
                <td><div className="stack-cell"><strong>{item.scene}</strong><small>{item.action}</small></div></td>
                <td>{formatDuration(item.durationSeconds)}</td>
                <td><StatusBadge label={label} tone={tone} /></td>
                <td><QualityScore score={item.finalScore} settlementRatio={item.qualityResult?.settlementRatio} /></td>
                <td>{onAction && <button className="table-action" aria-label={actionLabel} onClick={() => onAction(item)}><Eye size={15} />{actionLabel}</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
