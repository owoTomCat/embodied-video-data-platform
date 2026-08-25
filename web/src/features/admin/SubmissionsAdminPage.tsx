"use client";

import { ClipboardCheck, Eye, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { FilterBar } from "../../components/FilterBar";
import { Modal } from "../../components/Modal";
import { ReviewDrawer } from "../../components/ReviewDrawer";
import { SubmissionTable } from "../../components/SubmissionTable";
import type { Submission } from "../../domain/types";
import { useInteractions } from "../../interactions/InteractionContext";
import {
  deleteSubmission,
  renameSubmission,
  searchSubmissions,
  submissionsExportUrl,
} from "../../submissions/client/submissionApi";
import type {
  BackendSubmission,
  BackendSubmissionListPagination,
} from "../../submissions/contracts";
import { backendSubmissionToDomain } from "../../submissions/submissionMapper";
import { AiRerunModal } from "./AiRerunModal";

const PAGE_SIZE = 20;

type ListMode = "loading" | "live" | "unavailable";
type SubmissionManagementStage =
  | "queued"
  | "probing"
  | "awaiting_ai"
  | "ai_processing";

const activeManagementStages = new Set<SubmissionManagementStage>([
  "queued",
  "probing",
  "awaiting_ai",
  "ai_processing",
]);

function isActiveProcessing(submission: Submission): boolean {
  return activeManagementStages.has(
    submission.pipelineStage as SubmissionManagementStage,
  );
}

function canRerun(submission: Submission): boolean {
  return (
    submission.settlementStatus !== "settled" &&
    submission.storageStatus === "available" &&
    ["awaiting_ai", "completed", "system_failed"].includes(
      submission.pipelineStage ?? "",
    )
  );
}

function canReview(submission: Submission): boolean {
  if (submission.settlementStatus === "settled") return false;
  if (submission.pipelineStage !== "completed") return false;
  if (submission.storageStatus !== "available") return false;
  return ["scored", "review_pending"].includes(
    submission.qualityResult?.status ?? "",
  );
}

function RenameSubmissionModal({
  submission,
  open,
  onClose,
  onRenamed,
}: {
  submission: Submission | null;
  open: boolean;
  onClose(): void;
  onRenamed(submission: BackendSubmission): void;
}) {
  const [fileName, setFileName] = useState(submission?.fileName ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { notify } = useInteractions();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!submission || saving) return;
    const trimmed = fileName.trim();
    if (!trimmed) {
      setError("请填写新的文件名");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updated = await renameSubmission(submission.id, {
        fileName: trimmed,
        reason: reason.trim() || undefined,
      });
      onRenamed(updated);
      notify("success", "提交数据已重命名");
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "重命名失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="重命名提交数据"
      onClose={onClose}
      initialFocusRef={inputRef}
    >
      <form className="modal-form" onSubmit={submit}>
        <label>
          提交编号
          <input value={submission?.id ?? ""} disabled />
        </label>
        <label>
          新文件名
          <input
            ref={inputRef}
            value={fileName}
            onChange={(event) => {
              setFileName(event.target.value);
              setError("");
            }}
            placeholder="例如：kitchen-task-01.mp4"
          />
        </label>
        <label>
          备注
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="例如：修正测试人员误填的文件名"
          />
        </label>
        {error && <p className="modal-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
            disabled={saving}
          >
            取消
          </button>
          <button type="submit" className="button button-primary" disabled={saving}>
            {saving ? "保存中" : "保存"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteSubmissionModal({
  submission,
  open,
  onClose,
  onDeleted,
}: {
  submission: Submission | null;
  open: boolean;
  onClose(): void;
  onDeleted(id: string): void;
}) {
  const [reason, setReason] = useState("");
  const [force, setForce] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const { notify } = useInteractions();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!submission || saving) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("请填写删除原因");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await deleteSubmission(submission.id, {
        reason: trimmed,
        force,
      });
      onDeleted(result.deletedSubmissionId);
      notify("success", "提交数据已删除");
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="删除提交数据"
      onClose={onClose}
      initialFocusRef={reasonRef}
    >
      <form className="modal-form" onSubmit={submit}>
        <label>
          提交编号
          <input value={submission?.id ?? ""} disabled />
        </label>
        <p className="modal-note">
          删除后会移除这条提交记录，并取消相关后台队列；已生成的视频文件、预览和证据帧也会一并删除。
        </p>
        <label>
          删除原因
          <textarea
            ref={reasonRef}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setError("");
            }}
            placeholder="例如：测试人员误传，确认不进入结算"
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={force}
            onChange={(event) => setForce(event.target.checked)}
          />
          保留期内也强制删除视频文件
        </label>
        {error && <p className="modal-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
            disabled={saving}
          >
            取消
          </button>
          <button type="submit" className="button button-danger" disabled={saving}>
            {saving ? "删除中" : "确认删除"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function SubmissionsAdminPage({
  navigate,
}: {
  navigate?(path: string): void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [mode, setMode] = useState<ListMode>("loading");
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [rerunTarget, setRerunTarget] = useState<Submission | null>(null);
  const [reviewTarget, setReviewTarget] = useState<Submission | null>(null);
  const [renameTarget, setRenameTarget] = useState<Submission | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Submission | null>(null);
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
    })
      .then((result) => {
        if (!active) return;
        setSubmissions(result.submissions.map(backendSubmissionToDomain));
        setPagination(result.pagination);
        setMode("live");
      })
      .catch(() => {
        if (!active) return;
        setSubmissions([]);
        setPagination({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 });
        setMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, [page, query, refreshKey, status]);

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
    () => submissionsExportUrl({ q: query, status }),
    [query, status],
  );

  function refresh() {
    setRefreshKey((current) => current + 1);
  }

  function handleUpdatedSubmission(updated: BackendSubmission) {
    const mapped = backendSubmissionToDomain(updated);
    setSubmissions((current) =>
      current.map((item) => (item.id === mapped.id ? mapped : item)),
    );
    refresh();
  }

  function handleDeletedSubmission(id: string) {
    setSubmissions((current) => current.filter((item) => item.id !== id));
    setPagination((current) => ({
      ...current,
      total: Math.max(0, current.total - 1),
    }));
    // 删除当前页最后一条时回到上一页，避免停留在空页
    setPage((current) =>
      submissions.length === 1 && current > 1 ? current - 1 : current,
    );
    refresh();
  }

  function renderActions(item: Submission) {
    const settled = item.settlementStatus === "settled";
    const active = isActiveProcessing(item);
    return (
      <span className="row-actions submission-actions">
        {navigate && (
          <button
            type="button"
            className="table-action"
            onClick={() => navigate(`/admin/submissions/${item.id}`)}
          >
            <Eye size={14} />
            详情
          </button>
        )}
        <button
          type="button"
          className="table-action"
          disabled={!canReview(item)}
          title={
            canReview(item)
              ? "对未结算数据进行复核打分"
              : "仅未结算且已有质检结果的数据可复核"
          }
          onClick={() => setReviewTarget(item)}
        >
          <ClipboardCheck size={14} />
          复核
        </button>
        <button
          type="button"
          className="table-action"
          disabled={!canRerun(item)}
          title={
            canRerun(item)
              ? "重新进入 AI 质检队列"
              : "仅未结算且已完成媒体解析的数据可重跑"
          }
          onClick={() => setRerunTarget(item)}
        >
          <RotateCcw size={14} />
          重跑
        </button>
        <button
          type="button"
          className="table-action"
          disabled={settled}
          title={settled ? "已进入结算的数据不能重命名" : "修改列表显示文件名"}
          onClick={() => setRenameTarget(item)}
        >
          <Pencil size={14} />
          重命名
        </button>
        <button
          type="button"
          className="table-action table-action-danger"
          disabled={settled || active}
          title={
            settled
              ? "已进入结算的数据不能删除"
              : active
                ? "正在处理的数据暂不能删除"
                : "删除提交记录和文件对象"
          }
          onClick={() => setDeleteTarget(item)}
        >
          <Trash2 size={14} />
          删除
        </button>
      </span>
    );
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">全平台数据范围</p>
          <h1>数据提交</h1>
          <span>统一检索视频、成员、团队、处理与结算状态</span>
        </div>
        <a
          className="button button-primary"
          href={exportUrl}
        >
          导出当前结果
        </a>
      </div>
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
          placeholder="搜索编号、视频、成员、团队或场景"
        />
        <div className="table-summary">
          <span>
            {mode === "live"
              ? `后端筛选 ${range} / ${pagination.total} 条`
              : mode === "loading"
                ? "正在读取后端数据"
                : "后端数据暂不可用"}
          </span>
          <span>
            第 {pagination.page} / {pagination.totalPages} 页
          </span>
        </div>
        <SubmissionTable
          submissions={submissions}
          loading={mode === "loading"}
          showOwner
          renderActions={renderActions}
        />
        <div className="table-summary">
          <span>每页 {pagination.pageSize} 条</span>
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
      <AiRerunModal
        open={rerunTarget !== null}
        submission={rerunTarget}
        onClose={() => setRerunTarget(null)}
        onRerun={handleUpdatedSubmission}
      />
      {reviewTarget ? (
        <ReviewDrawer
          submission={reviewTarget}
          onClose={() => {
            setReviewTarget(null);
            refresh();
          }}
        />
      ) : null}
      {renameTarget ? (
        <RenameSubmissionModal
          key={renameTarget.id}
          open
          submission={renameTarget}
          onClose={() => setRenameTarget(null)}
          onRenamed={handleUpdatedSubmission}
        />
      ) : null}
      {deleteTarget ? (
        <DeleteSubmissionModal
          key={deleteTarget.id}
          open
          submission={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={handleDeletedSubmission}
        />
      ) : null}
    </div>
  );
}
