"use client";

import { useMemo, useState } from "react";
import { FilterBar } from "../../components/FilterBar";
import { SubmissionTable } from "../../components/SubmissionTable";
import { useDemoStore } from "../../data/DemoStoreContext";
import type { Submission } from "../../domain/types";

export function SubmissionsPage({
  navigate,
}: {
  navigate(path: string): void;
}) {
  const { state, currentUser } = useDemoStore();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const submissions = useMemo(() => state.submissions.filter((item) => {
    if (item.ownerId !== currentUser.id) return false;
    const text = `${item.fileName} ${item.id} ${item.scene} ${item.action}`.toLowerCase();
    if (query && !text.includes(query.toLowerCase())) return false;
    if (status === "all") return true;
    if (status === "passed" || status === "failed") return item.qualityStatus === status;
    if (status === "unsettled") return item.settlementStatus === "unsettled";
    return item.processingStatus === status;
  }), [currentUser.id, query, state.submissions, status]);

  function view(item: Submission) { navigate(`/collector/submissions/${item.id}`); }

  return (
    <div className="page-stack">
      <div className="page-heading"><div><p className="page-kicker">个人数据范围</p><h1>我的数据</h1><span>跟踪上传、质检与结算的完整状态</span></div><button className="button button-primary" onClick={() => navigate("/collector/upload")}>上传新视频</button></div>
      <section className="content-card table-card"><FilterBar value={query} onChange={setQuery} status={status} onStatusChange={setStatus} /><div className="table-summary"><span>共 {submissions.length} 条数据</span><span>数据范围：仅本人</span></div><SubmissionTable submissions={submissions} onAction={view} /></section>
    </div>
  );
}
