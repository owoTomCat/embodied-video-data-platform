"use client";

import { CheckCircle2, CloudUpload, FileVideo, Info, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { listActiveUploads } from "../../submissions/client/submissionApi";
import type { ActiveUploadResult } from "../../submissions/contracts";
import { resumeUploadVideo, uploadVideo } from "../../submissions/upload/multipartUploader";
import { uploadSizeError } from "../../submissions/upload/uploadLimits";
import { listTasksForCollector } from "../../tasks/client/taskApi";
import type { CollectionTaskForCollector } from "../../tasks/contracts";

const isSupported = (file: File) => /\.(mov|mp4)$/i.test(file.name);

const SELECTED_TASK_STORAGE_KEY = "evdp:selectedTaskId";

export function UploadPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const resumeInputRef = useRef<HTMLInputElement>(null);
  const resumeTargetRef = useRef<ActiveUploadResult | null>(null);
  const [error, setError] = useState("");
  const [authorization, setAuthorization] = useState({
    dataUsageAuthorized: false,
    privacyConfirmed: false,
    sensitiveContentConfirmed: false,
  });
  const [tasks, setTasks] = useState<CollectionTaskForCollector[]>([]);
  const [taskMode, setTaskMode] = useState<"loading" | "live" | "unavailable">("loading");
  const [taskReloadKey, setTaskReloadKey] = useState(0);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [taskRequirementsConfirmed, setTaskRequirementsConfirmed] =
    useState(false);
  const [activeUploads, setActiveUploads] = useState<ActiveUploadResult[]>([]);
  const [uploads, setUploads] = useState<Array<{
    key: string;
    name: string;
    progress: number;
    status: "hashing" | "uploading" | "queued" | "failed" | "paused";
    file?: File;
    session?: ActiveUploadResult;
    controller?: AbortController;
    error?: string;
  }>>([]);
  const selectedTask =
    tasks.find((task) => task.id === selectedTaskId) ?? null;
  const authorizationComplete =
    authorization.dataUsageAuthorized &&
    authorization.privacyConfirmed &&
    authorization.sensitiveContentConfirmed &&
    selectedTask !== null &&
    taskRequirementsConfirmed;

  useEffect(() => {
    let active = true;
    listTasksForCollector()
      .then((items) => {
        if (!active) return;
        setTasks(items);
        setTaskMode("live");
        const preselected = sessionStorage.getItem(SELECTED_TASK_STORAGE_KEY);
        if (preselected && items.some((task) => task.id === preselected)) {
          setSelectedTaskId(preselected);
          sessionStorage.removeItem(SELECTED_TASK_STORAGE_KEY);
        }
      })
      .catch(() => {
        if (!active) return;
        setTasks([]);
        setTaskMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, [taskReloadKey]);

  useEffect(() => {
    let active = true;
    listActiveUploads()
      .then((items) => {
        if (!active) return;
        setActiveUploads(items);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  function updateUpload(
    key: string,
    values: Partial<(typeof uploads)[number]>,
  ) {
    setUploads((current) =>
      current.map((item) =>
        item.key === key ? { ...item, ...values } : item,
      ),
    );
  }

  async function upload(file: File, key: string) {
    const controller = new AbortController();
    updateUpload(key, { file, controller });
    try {
      await uploadVideo(file, {
        signal: controller.signal,
        authorization,
        task: {
          id: selectedTaskId,
          requirementsConfirmed: taskRequirementsConfirmed,
        },
        onProgress: (progress) =>
          updateUpload(key, { progress, status: "uploading" }),
      });
      updateUpload(key, { progress: 100, status: "queued", controller: undefined });
    } catch (reason) {
      if (controller.signal.aborted) {
        const active = await listActiveUploads().catch(() => []);
        const session = active.find(
          (item) =>
            item.submission.fileName === file.name &&
            Number(item.submission.sizeBytes) === file.size,
        );
        setActiveUploads(active);
        updateUpload(key, {
          status: "paused",
          file,
          session,
          controller: undefined,
          error: session ? "已暂停，可继续上传" : "已暂停，请在可恢复上传中继续",
        });
        return;
      }
      updateUpload(key, {
        status: "failed",
        controller: undefined,
        error: reason instanceof Error ? reason.message : "上传失败，请重试",
      });
    }
  }

  async function resumeUpload(
    file: File,
    session: ActiveUploadResult,
    key = `resume-${session.submission.id}`,
  ) {
    const controller = new AbortController();
    setUploads((current) => [
      {
        key,
        name: session.submission.fileName,
        progress: 0,
        status: "uploading",
        file,
        session,
        controller,
      },
      ...current.filter((item) => item.key !== key),
    ]);
    try {
      await resumeUploadVideo(file, session, {
        signal: controller.signal,
        onProgress: (progress) =>
          updateUpload(key, { progress, status: "uploading" }),
      });
      setActiveUploads((current) =>
        current.filter((item) => item.submission.id !== session.submission.id),
      );
      updateUpload(key, { progress: 100, status: "queued", controller: undefined });
    } catch (reason) {
      if (controller.signal.aborted) {
        updateUpload(key, {
          status: "paused",
          file,
          session,
          controller: undefined,
          error: "已暂停，可继续上传",
        });
        return;
      }
      updateUpload(key, {
        status: "failed",
        controller: undefined,
        error:
          reason instanceof Error
            ? reason.message
            : "恢复上传失败，请重新选择原文件",
      });
    }
  }

  function pauseUpload(key: string) {
    setUploads((current) => {
      const target = current.find((item) => item.key === key);
      target?.controller?.abort();
      return current;
    });
  }

  function continueUpload(item: (typeof uploads)[number]) {
    if (!item.file || !item.session) return;
    void resumeUpload(item.file, item.session, item.key);
  }

  function chooseResumeFile(session: ActiveUploadResult) {
    resumeTargetRef.current = session;
    resumeInputRef.current?.click();
  }

  function acceptResumeFile(file?: File) {
    const session = resumeTargetRef.current;
    resumeTargetRef.current = null;
    if (!file || !session) return;
    void resumeUpload(file, session);
    if (resumeInputRef.current) resumeInputRef.current.value = "";
  }

  function acceptFiles(files: File[]) {
    const supported = files.filter(isSupported);
    const valid = supported.filter((file) => !uploadSizeError(file));
    if (supported.length !== files.length) {
      setError("仅支持 MOV 和 MP4 视频");
    } else {
      const sizeError = supported
        .map((file) => uploadSizeError(file))
        .find((message): message is string => Boolean(message));
      setError(sizeError ?? "");
    }
    if (!valid.length) return;
    if (!authorizationComplete) {
      setError(
        !selectedTask
          ? "请先选择采集任务"
          : !taskRequirementsConfirmed
            ? "上传前请先确认已阅读并理解任务要求"
            : "上传前请先确认数据授权、隐私规范和敏感内容处理要求",
      );
      return;
    }
    const created = valid.map((file, index) => ({
      key: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      progress: 0,
      status: "hashing" as const,
      file,
    }));
    setUploads((current) => [
      ...created.map(({ key, name, progress, status, file }) => ({
        key,
        name,
        progress,
        status,
        file,
      })),
      ...current,
    ]);
    for (const item of created) void upload(item.file, item.key);
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">任务提交</p>
          <h1>提交采集视频</h1>
          <span>按顺序完成任务选择、规范确认和文件上传，避免视频提交到错误任务。</span>
        </div>
      </div>
      <ol className="upload-progress-steps" aria-label="提交步骤">
        <li className={selectedTask ? "complete" : "active"}>
          <span>{selectedTask ? <CheckCircle2 size={16} /> : "1"}</span>
          <div><strong>选择任务</strong><small>确认视频归属</small></div>
        </li>
        <li className={taskRequirementsConfirmed && authorization.dataUsageAuthorized && authorization.privacyConfirmed && authorization.sensitiveContentConfirmed ? "complete" : selectedTask ? "active" : ""}>
          <span>{taskRequirementsConfirmed && authorization.dataUsageAuthorized && authorization.privacyConfirmed && authorization.sensitiveContentConfirmed ? <CheckCircle2 size={16} /> : "2"}</span>
          <div><strong>确认规范</strong><small>阅读要求与授权</small></div>
        </li>
        <li className={authorizationComplete ? "active" : ""}>
          <span>3</span>
          <div><strong>上传文件</strong><small>查看实时进度</small></div>
        </li>
      </ol>
      <section className="upload-layout">
        <div className="content-card upload-main-card upload-flow-card">
          <input ref={inputRef} className="file-input" aria-label="选择视频文件" accept=".mov,.mp4,video/quicktime,video/mp4" multiple type="file" onChange={(event) => acceptFiles(Array.from(event.target.files ?? []))} />
          <input ref={resumeInputRef} className="file-input" aria-label="选择恢复上传文件" accept=".mov,.mp4,video/quicktime,video/mp4" type="file" onChange={(event) => acceptResumeFile(event.target.files?.[0])} />
          <section className="upload-step-card" aria-label="选择采集任务">
            <div className="upload-step-heading">
              <span>1</span>
              <div><h2>选择采集任务</h2><p>本次选择会作为“任务来源”写入视频记录，并决定 AI 质检标准。</p></div>
            </div>
            <div className="upload-step-body">
              {taskMode === "loading" ? (
                <p className="modal-hint task-load-state"><RefreshCw className="spin" size={16} />正在读取可提交任务…</p>
              ) : taskMode === "unavailable" ? (
                <div className="task-load-state" role="status">
                  <div><strong>任务服务暂不可用</strong><span>任务列表未加载，无法确认视频归属。</span></div>
                  <button type="button" className="button button-secondary button-small" onClick={() => {
                    setTaskMode("loading");
                    setTaskReloadKey((current) => current + 1);
                  }}>
                    <RefreshCw size={14} />重试
                  </button>
                </div>
              ) : tasks.length === 0 ? (
                <p className="modal-hint">当前没有可提交的采集任务，请稍后再试。</p>
              ) : (
                <>
                  <label className="form-label">
                    <span>任务（场景）</span>
                    <select
                      value={selectedTaskId}
                      onChange={(event) => {
                        setSelectedTaskId(event.target.value);
                        setTaskRequirementsConfirmed(false);
                      }}
                    >
                      <option value="">请选择任务…</option>
                      {tasks.map((task) => (
                        <option key={task.id} value={task.id} disabled={task.status !== "published"}>
                          {task.title}（{task.sceneName}）
                          {task.status !== "published" ? " · 已暂停" : task.pricePointsPerMinute !== null ? ` · ${task.pricePointsPerMinute} 元/小时` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedTask && (
                    <div className="task-requirements-preview">
                      <p className="task-req-title">
                        <strong>{selectedTask.title}</strong>
                        <span>场景：{selectedTask.sceneName}</span>
                      </p>
                      <p className="task-req-desc">
                        {selectedTask.normalizedRequirements?.scene_description ??
                          (selectedTask.description || "（任务未提供场景描述）")}
                      </p>
                      {selectedTask.normalizedRequirements?.requirements.length ? (
                        <ul className="check-list compact">
                          {selectedTask.normalizedRequirements.requirements.map((item, index) => (
                            <li key={`${item.type}-${index}`}>
                              <ShieldCheck size={14} />
                              <span>
                                <strong>{item.type === "hard" ? "【硬性】" : "【一般】"}{item.content}</strong>
                                {item.rationale ? <small>{item.rationale}</small> : null}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <label className="upload-consent-item">
                        <input
                          type="checkbox"
                          aria-label="我已阅读并理解该任务的采集要求，本次视频符合任务要求"
                          checked={taskRequirementsConfirmed}
                          onChange={(event) => setTaskRequirementsConfirmed(event.target.checked)}
                        />
                        <span><strong>我已阅读并理解以上任务要求</strong><small>并确认本次视频内容符合该任务</small></span>
                      </label>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          <section className="upload-step-card" aria-label="确认授权与隐私规范">
            <div className="upload-step-heading">
              <span>2</span>
              <div><h2>确认授权与隐私规范</h2><p>三项都需要确认，避免上传无授权或包含敏感信息的视频。</p></div>
            </div>
            <div className="upload-step-body upload-consent-panel">
              <label><input type="checkbox" aria-label="我确认拥有本次上传视频的数据使用授权" checked={authorization.dataUsageAuthorized} onChange={(event) => setAuthorization((current) => ({ ...current, dataUsageAuthorized: event.target.checked }))} /><span><strong>数据使用授权</strong><small>我拥有本次上传视频的合法数据使用权</small></span></label>
              <label><input type="checkbox" aria-label="我已按隐私规范检查人脸、门牌、屏幕账号、定位等信息" checked={authorization.privacyConfirmed} onChange={(event) => setAuthorization((current) => ({ ...current, privacyConfirmed: event.target.checked }))} /><span><strong>隐私信息检查</strong><small>已检查人脸、门牌、屏幕账号、定位等信息</small></span></label>
              <label><input type="checkbox" aria-label="我确认发现敏感内容时已遮挡、重采或按要求处理" checked={authorization.sensitiveContentConfirmed} onChange={(event) => setAuthorization((current) => ({ ...current, sensitiveContentConfirmed: event.target.checked }))} /><span><strong>敏感内容处理</strong><small>发现敏感内容时已遮挡、重采或按要求处理</small></span></label>
            </div>
          </section>

          <section className="upload-step-card" aria-label="上传视频文件">
            <div className="upload-step-heading">
              <span>3</span>
              <div><h2>选择并上传视频</h2><p>可一次选择多个文件，每个文件会显示独立上传进度。</p></div>
            </div>
            <div className="upload-step-body">
              <button
                className="upload-dropzone"
                type="button"
                aria-label={authorizationComplete ? undefined : "请先完成上方三项授权确认"}
                disabled={!authorizationComplete}
                onClick={() => inputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  acceptFiles(Array.from(event.dataTransfer.files));
                }}
              >
                <span><CloudUpload size={27} /></span>
                <strong>{authorizationComplete ? "点击选择或拖拽视频到这里" : "完成前两步后即可选择视频"}</strong>
                <small>MOV、MP4 格式 · 单文件最大 2 GiB · 支持批量上传</small>
                <em>{authorizationComplete ? "选择视频文件" : "当前不可上传"}</em>
              </button>
              {error && <div className="inline-alert inline-alert-error" role="alert"><XCircle size={16} />{error}</div>}
            </div>
          </section>

          {activeUploads.length > 0 && <div className="upload-queue" aria-live="polite"><div className="card-heading"><div><h2>可恢复上传</h2><p>刷新前未完成的任务，可重新选择原文件继续上传</p></div></div>{activeUploads.map((item) => <div className="upload-item" key={item.submission.id}><span><FileVideo size={18} /></span><div><strong>{item.submission.fileName}</strong><small>{item.upload.partCount} 个分片 · 需要选择同名同大小文件</small></div><button className="table-action" onClick={() => chooseResumeFile(item)}>继续上传</button></div>)}</div>}
          <div className="upload-queue" aria-live="polite">
            <div className="card-heading"><div><h2>本次上传</h2><p>{uploads.length ? `${uploads.length} 个视频上传任务` : "选择文件后在此查看上传进度"}</p></div></div>
            {uploads.length ? uploads.map((item) => (
              <div className="upload-item" key={item.key}>
                <span><FileVideo size={18} /></span>
                <div>
                  <strong>{item.name}</strong>
                  <small>
                    {item.status === "hashing"
                      ? "正在计算文件校验值"
                      : item.status === "uploading"
                        ? `正在上传 ${item.progress}%`
                        : item.status === "queued"
                          ? "上传完成，等待媒体处理"
                          : item.status === "paused"
                            ? item.error ?? "已暂停，可继续上传"
                          : item.error ?? "上传失败，请重试"}
                  </small>
                  <i
                    role="progressbar"
                    aria-label={`${item.name} 上传进度`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={item.progress}
                  ><b style={{ width: `${item.progress}%` }} /></i>
                </div>
                {item.status === "uploading" ? <button className="table-action" onClick={() => pauseUpload(item.key)}>暂停</button> : null}
                {item.status === "paused" && item.session ? <button className="table-action" onClick={() => continueUpload(item)}>继续</button> : null}
                {item.status === "queued" ? <CheckCircle2 className="upload-icon-ok" size={18} /> : item.status === "failed" ? <XCircle className="upload-icon-failed" size={18} /> : item.status === "paused" ? <Info className="upload-icon-paused" size={18} /> : <CloudUpload className="upload-icon-active" size={18} />}
              </div>
            )) : <div className="empty-inline">暂无待上传文件</div>}
          </div>
        </div>
        <aside className="content-card upload-guide-card upload-sticky-guide">
          {selectedTask && (
            <div className="selected-task-summary">
              <small>本次任务来源</small>
              <strong>{selectedTask.title}</strong>
              <span>{selectedTask.sceneName} · V{selectedTask.revision}</span>
              <em>{selectedTask.pricePointsPerMinute !== null ? `${selectedTask.pricePointsPerMinute} 元/小时` : "按全局规则计费"}</em>
            </div>
          )}
          <div className="card-heading"><div><h2>上传前检查</h2><p>符合要求的数据更容易通过质检</p></div></div>
          <ul className="check-list"><li><ShieldCheck size={16} /><span><strong>第一视角连续拍摄</strong><small>保持双手和主要操作对象始终可见</small></span></li><li><ShieldCheck size={16} /><span><strong>画面清晰稳定</strong><small>避免过曝、严重晃动和长时间遮挡</small></span></li><li><ShieldCheck size={16} /><span><strong>单一完整任务</strong><small>从准备到收尾保留完整动作链路</small></span></li></ul>
          <div className="tip-box"><Info size={16} /><span><strong>隐私提示</strong>上传前请确认画面中不包含人脸、门牌、屏幕账号等敏感信息。</span></div>
        </aside>
      </section>
    </div>
  );
}
