"use client";

import { useEffect, useMemo, useState } from "react";

import { FilterBar } from "../../components/FilterBar";
import { SubmissionTable } from "../../components/SubmissionTable";
import { TaskDimensionStats } from "../../components/TaskDimensionStats";
import { useIdentity } from "../../auth/client/IdentityContext";
import type { Submission } from "../../domain/types";
import { searchSubmissions } from "../../submissions/client/submissionApi";
import { useTaskStats } from "../../submissions/client/useTaskStats";
import type { BackendSubmissionListPagination } from "../../submissions/contracts";
import { backendSubmissionToDomain } from "../../submissions/submissionMapper";

const PAGE_SIZE = 20;

type ListMode = "loading" | "live" | "unavailable";

/** 提交时间范围 → dateFrom/dateTo（本地时区整天） */
function resolveDateRange(range: string): {
  dateFrom?: string;
  dateTo?: string;
} {
  if (range === "all") return {};
  const now = new Date();
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
  );
  if (range === "today") {
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
    );
    return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
  }
  const days = range === "7d" ? 7 : 30;
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - days,
    0,
    0,
    0,
  );
  return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
}

function backendStatus(status: string, qualityOnly: boolean): string {
  if (qualityOnly && status === "all") return "reviewed";
  return status;
}

export function SubmissionsPage({
  qualityOnly = false,
  navigate,
}: {
  qualityOnly?: boolean;
  navigate(path: string): void;
}) {
  const { currentAccount } = useIdentity();
  const { stats: taskStats, loading: taskStatsLoading } = useTaskStats();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [taskId, setTaskId] = useState("all");
  const [dateRange, setDateRange] = useState("all");
  const [scene, setScene] = useState("all");
  const [sort, setSort] = useState("createdAt-desc");
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

  const sceneOptions = useMemo(
    () => [
      ...new Set(
        taskSources
          .map((source) => source.sceneName)
          .filter((name): name is string => Boolean(name)),
      ),
    ],
    [taskSources],
  );

  useEffect(() => {
    let active = true;
    const [sortBy, sortOrder] =
      sort === "all" ? [] : (sort.split("-") as [string, string]);
    searchSubmissions({
      q: query,
      status: backendStatus(status, qualityOnly),
      page,
      pageSize: PAGE_SIZE,
      includeThumbnails: true,
      ...(taskId !== "all" ? { taskId } : {}),
      ...resolveDateRange(dateRange),
      ...(scene !== "all" ? { scene } : {}),
      ...(sortBy === "createdAt" || sortBy === "finalScore"
        ? { sortBy, sortOrder: sortOrder === "asc" ? "asc" : "desc" }
        : {}),
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
  }, [currentAccount.id, page, qualityOnly, query, status, taskId, dateRange, scene, sort]);

  const range = useMemo(() => {
    if (pagination.total === 0) return "0";
    const start = (pagination.page - 1) * pagination.pageSize + 1;
    const end = Math.min(
      pagination.total,
      start + submissions.length - 1,
    );
    return `${start}-${end}`;
  }, [pagination, submissions.length]);

  function view(item: Submission) {
    navigate(`/collector/submissions/${item.id}`);
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">个人数据范围</p>
          <h1>{qualityOnly ? "质检结果" : "我的数据"}</h1>
          <span>
            {qualityOnly
              ? "查看评分、问题区间与返工建议"
              : "跟踪从上传到结算的完整状态"}
          </span>
        </div>
        {!qualityOnly && (
          <button
            className="button button-primary"
            onClick={() => navigate("/collector/upload")}
          >
            上传新视频
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
          taskId={qualityOnly ? undefined : taskId}
          onTaskChange={
            qualityOnly
              ? undefined
              : (value) => {
                  setTaskId(value);
                  setPage(1);
                }
          }
          taskSources={taskSources}
          dateRange={dateRange}
          onDateRangeChange={(value) => {
            setDateRange(value);
            setPage(1);
          }}
          scene={scene}
          onSceneChange={(value) => {
            setScene(value);
            setPage(1);
          }}
          sceneOptions={sceneOptions}
          sort={sort}
          onSortChange={(value) => {
            setSort(value);
            setPage(1);
          }}
        />
        <div className="table-summary">
          <span>
            {mode === "live"
              ? `后端筛选 ${range} / ${pagination.total} 条数据`
              : mode === "loading"
                ? "正在读取后端数据"
                : "后端数据暂不可用"}
          </span>
          <span>数据范围：仅本人</span>
        </div>
        <SubmissionTable
          submissions={submissions}
          loading={mode === "loading"}
          showTaskSource={!qualityOnly}
          showSubmittedAt
          onAction={view}
        />
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
