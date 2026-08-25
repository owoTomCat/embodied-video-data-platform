"use client";

import type { RefObject } from "react";
import { Modal } from "../../components/Modal";
import type { User } from "../../domain/types";

export type MemberMetrics = {
  uploads: number;
  duration: string;
  passRate: string;
  averageScore: string;
};

export function MemberDetailModal({
  member,
  team,
  metrics,
  periodLabel,
  open,
  onClose,
  returnFocusRef,
}: {
  member?: User;
  team?: { id: string; name: string };
  metrics: MemberMetrics;
  periodLabel: string;
  open: boolean;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  if (!member) return null;

  return (
    <Modal
      open={open}
      title="成员详情"
      onClose={onClose}
      returnFocusRef={returnFocusRef}
    >
      <div className="member-detail">
        <div className="member-detail-profile">
          <span>{member.avatar}</span>
          <div>
            <strong>{member.name}</strong>
            <small>{member.role === "leader" ? "团长" : "数采人员"}</small>
          </div>
        </div>
        <dl className="member-detail-fields">
          <div><dt>登录账号</dt><dd>{member.account}</dd></div>
          <div><dt>所属团队</dt><dd>{team?.name ?? "未加入团队"}</dd></div>
          <div><dt>手机号</dt><dd>{member.phone}</dd></div>
        </dl>
        <p id="member-detail-metrics-note" role="note">
          以下指标根据该成员{periodLabel}的真实视频提交和 AI 质检结果计算
        </p>
        <div
          className="member-detail-metrics"
          role="group"
          aria-label="成员表现"
          aria-describedby="member-detail-metrics-note"
        >
          <div><span>{periodLabel}上传</span><strong>{metrics.uploads} 条</strong></div>
          <div><span>有效时长</span><strong>{metrics.duration}</strong></div>
          <div><span>通过率</span><strong>{metrics.passRate}</strong></div>
          <div><span>平均分</span><strong>{metrics.averageScore}</strong></div>
        </div>
      </div>
    </Modal>
  );
}
