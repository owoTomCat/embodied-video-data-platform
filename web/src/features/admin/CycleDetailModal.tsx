"use client";

import { type RefObject } from "react";

import { Modal } from "../../components/Modal";
import { StatusBadge } from "../../components/StatusBadge";
import type { BackendPointCycle } from "../../points/contracts";

export function CycleDetailModal({
  open,
  cycle,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  cycle: BackendPointCycle;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Modal
      open={open}
      title={`周期明细 · ${cycle.businessDate}`}
      className="cycle-detail-modal"
      onClose={onClose}
      returnFocusRef={returnFocusRef}
    >
      <div className="modal-intro">
        <p>
          共 {cycle.submissionCount} 条视频 · 有效 {cycle.effectiveMinutes} 分钟 · 合计{" "}
          <strong>{cycle.totalPoints.toFixed(2)} 元</strong>
        </p>
        <p className="form-help">
          {cycle.status === "locked"
            ? `锁定中：预计 ${new Intl.DateTimeFormat("zh-CN", {
                timeZone: "Asia/Shanghai",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              }).format(cycle.settleDueAt ?? 0)} 自动结算入钱包。锁定后条目不可编辑。`
            : "已结算：金额已转入各数采人员钱包的「可提现」。"}
        </p>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr><th>视频</th><th>任务</th><th>数采</th><th>团队</th><th>评分</th><th>比例</th><th>有效时长</th><th>无效时长</th><th>金额</th></tr>
          </thead>
          <tbody>
            {(cycle.items ?? []).map((item) => (
              <tr key={item.id}>
                <td>
                  <div className="cycle-video-cell">
                    {item.thumbnail ? (
                      <img src={item.thumbnail.url} alt={`${item.fileName} 缩略图`} loading="lazy" />
                    ) : (
                      <span className="cycle-video-placeholder" aria-hidden="true">视频</span>
                    )}
                    <span className="stack-cell">
                      <strong>{item.fileName}</strong>
                      <small>{item.submissionId}</small>
                    </span>
                  </div>
                </td>
                <td>
                  {item.taskName ? (
                    <span className="stack-cell">
                      <strong>{item.taskName}</strong>
                      <small>{item.taskSceneName ?? ""}</small>
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>{item.ownerName}</td>
                <td>{item.teamName}</td>
                <td>{item.finalScore.toFixed(1)}</td>
                <td>{item.settlementRatio.toFixed(2)}</td>
                <td>{item.effectiveMinutes} 分钟</td>
                <td>{Math.round(item.invalidDurationMs / 1_000)} 秒</td>
                <td><strong>{item.points.toFixed(2)} 元</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
