"use client";

import { useEffect, useMemo, useState } from "react";

import { FilterBar } from "../../components/FilterBar";
import { SubmissionTable } from "../../components/SubmissionTable";
import { TaskDimensionStats } from "../../components/TaskDimensionStats";
import { useIdentity } from "../../auth/client/IdentityContext";
import type { Submission } from "../../domain/types";
import {
  searchSubmissions,
  submissionsExportUrl,
} from "../../submissions/client/submissionApi";
import { useTaskStats } from "../../submissions/client/useTaskStats";
import type { BackendSubmissionListPagination } from "../../submissions/contracts";
import { backendSubmissionToDomain } from "../../submissions/submissionMapper";

const PAGE_SIZE = 20;

type ListMode = "loading" | "live" | "unavailable";

function processingCount(submissions: Submission[]): number {
  return submissions.filter((item) =>
    ["uploading", "queued", "processing"].includes(item.processingStatus),
  ).length;
}

export function TeamSubmissionsPage() {
  const { currentAccount, teams } = useIdentity();
  const currentTeam = teams.find((team) => team.id === currentAccount.teamId);
  const { stats: taskStats, loading: taskStatsLoading } = useTaskStats();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [taskId, setTaskId] = useState("all");
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<ListMode>("loading");
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [taskSources, setTaskSources] = useState<
    Array<{ taskId: string; title: string; sceneName: string }>
  >([]);
  const [pagination, setPagination] =
    useState<BackendSubmissionListPagination>({
      page: 1,
      pageSize: PAGE_SIZE,
      total: 0,
      totalPages: 1,
    });

  useEffect(() => {
    let active = true;
    searchSubmissions({
      q: query,
      status,
      page,
      pageSize: PAGE_SIZE,
      includeThumbnails: true,
      ...(taskId !== "all" ? { taskId } : {}),
    })
      .then((result) => {
        if (!active) return;
        setSubmissions(result.submissions.map(backendSubmissionToDomain));
        setTaskSources(result.taskSources ?? []);
        setPagination(result.pagination);
        setMode("live");
      })
      .catch(() => {
        if (!active) return;
        setSubmissions([]);
        setTaskSources([]);
        setPagination({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 });
        setMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, [currentTeam?.id, page, query, status, taskId]);

  const range = useMemo(() => {
    if (pagination.total === 0) return "0";
    const start = (pagination.page - 1) * pagination.pageSize + 1;
    const end = Math.min(
      pagination.total,
      start + submissions.length - 1,
    );
    return `${start}-${end}`;
  }, [pagination, submissions.length]);
  const exportUrl = useMemo(
    () => submissionsExportUrl({ q: query, status, ...(taskId !== "all" ? { taskId } : {}) }),
    [query, status, taskId],
  );

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">团队数据范围</p>
          <h1>团队数据</h1>
          <span>仅展示 {currentTeam?.name ?? "本团队"} 的成员提交</span>
        </div>
        {mode === "live" ? (
          <a className="button button-primary" href={exportUrl}>
            导出团队数据
          </a>
        ) : (
          <button
            className="button button-primary"
            type="button"
            disabled
            title="仅连接后端后可导出团队数据"
          >
            导出团队数据
          </button>
        )}
      </div>
      <TaskDimensionStats
        stats={taskStats}
        active={taskId}
        loading={taskStatsLoading}
        onSelect={(value) => {
          setTaskId(value);
          setPage(1);
        }}
      />
      <section className="content-card table-card">
        <FilterBar
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(1);
          }}
          status={status}
          onStatusChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          taskId={taskId}
          onTaskChange={(value) => {
            setTaskId(value);
            setPage(1);
          }}
          taskSources={taskSources}
          placeholder="搜索成员、文件或场景"
        />
        <div className="table-summary">
          <span>
            {mode === "live"
              ? `后端筛选 ${range} / ${pagination.total} 条团队数据`
              : mode === "loading"
                ? "正在读取后端团队数据"
                : "后端团队数据暂不可用"}
          </span>
          <span>处理中 {processingCount(submissions)} 条</span>
        </div>
        <SubmissionTable submissions={submissions} loading={mode === "loading"} showOwner />
        <div className="table-summary">
          <span>
            第 {pagination.page} / {pagination.totalPages} 页
          </span>
          <span className="row-actions">
            <button
              className="table-action"
              disabled={pagination.page <= 1}
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              上一页
            </button>
            <button
              className="table-action"
              disabled={pagination.page >= pagination.totalPages}
              type="button"
              onClick={() =>
                setPage((current) =>
                  Math.min(pagination.totalPages, current + 1),
                )
              }
            >
              下一页
            </button>
          </span>
        </div>
      </section>
    </div>
  );
}
