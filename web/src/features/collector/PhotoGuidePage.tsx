"use client";

import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  Loader2,
  Map as MapIcon,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { StatusBadge } from "../../components/StatusBadge";
import { useInteractions } from "../../interactions/InteractionContext";
import { listTasksForCollector } from "../../tasks/client/taskApi";
import type { CollectionTaskForCollector } from "../../tasks/contracts";
import {
  generateGuideTask,
  guideTaskErrorMessage,
  listMyGuideTasks,
  submitEditedCard,
} from "../../scene-guide/client/sceneGuideApi";
import type {
  GuideTask,
  GuideTaskCard,
} from "../../scene-guide/contracts";
import {
  isSupportedPhoto,
  photoSizeError,
  uploadGuidePhoto,
} from "../../scene-guide/client/photoUpload";

type Step = "pick" | "photo" | "preview" | "done";

const SELECTED_TASK_STORAGE_KEY = "evdp:selectedTaskId";

function emptyCard(): GuideTaskCard {
  return {
    target_objects: [],
    steps: [],
    end_condition: "",
    success_criteria: [],
    fail_criteria: [],
  };
}

export function PhotoGuidePage({ navigate }: { navigate(path: string): void }) {
  const { notify } = useInteractions();
  const [tasks, setTasks] = useState<CollectionTaskForCollector[]>([]);
  const [taskMode, setTaskMode] = useState<"loading" | "live" | "unavailable">("loading");
  const [taskReloadKey, setTaskReloadKey] = useState(0);

  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [step, setStep] = useState<Step>("pick");
  const [photos, setPhotos] = useState<Array<{ file: File; url: string; objectKey?: string; uploaded?: boolean }>>([]);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<GuideTask | null>(null);
  const [editing, setEditing] = useState(false);
  const [editedCard, setEditedCard] = useState<GuideTaskCard | null>(null);
  const [existing, setExisting] = useState<GuideTask[]>([]);

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const sceneTasks = useMemo(
    () => tasks.filter((task) => task.taskType === "scene_type"),
    [tasks],
  );

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
        setTaskMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, [taskReloadKey]);

  useEffect(() => {
    let active = true;
    listMyGuideTasks()
      .then((items) => {
        if (active) setExisting(items);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const taskCard = result?.taskCard ?? null;

  function chooseTask(taskId: string) {
    setSelectedTaskId(taskId);
    setStep("photo");
  }

  async function handleAddPhoto(files: File[]) {
    const supported = files.filter(isSupportedPhoto);
    const errored = files
      .map(photoSizeError)
      .find((message): message is string => Boolean(message));
    if (errored) {
      notify("error", errored);
      return;
    }
    setPhotos((current) => {
      const room = 5 - current.length;
      const next = supported.slice(0, room).map((file) => ({
        file,
        url: URL.createObjectURL(file),
      }));
      return [...current, ...next];
    });
  }

  function removePhoto(index: number) {
    setPhotos((current) => {
      const next = [...current];
      const [removed] = next.splice(index, 1);
      if (removed) URL.revokeObjectURL(removed.url);
      return next;
    });
  }

  async function handleGenerate() {
    if (photos.length === 0) {
      notify("error", "请先添加至少一张环境照片");
      return;
    }
    if (!selectedTask) {
      notify("error", "请先选择场景型任务");
      return;
    }
    setGenerating(true);
    try {
      const photoRefs = [];
      for (const photo of photos) {
        const objectKey = await uploadGuidePhoto(photo.file);
        photoRefs.push({
          objectKey,
          contentType: photo.file.type || "image/jpeg",
          name: photo.file.name,
          sizeBytes: photo.file.size,
        });
      }
      const guide = await generateGuideTask({
        sceneTypeTaskId: selectedTask.id,
        photoRefs,
      });
      setResult(guide);
      setEditedCard(null);
      setEditing(false);
      setStep("preview");
      notify("success", "已识别环境物体并生成任务卡");
    } catch (error) {
      notify("error", guideTaskErrorMessage(error));
    } finally {
      setGenerating(false);
    }
  }

  function startEdit() {
    setEditing(true);
    setEditedCard(
      result?.taskCard ? structuredClone(result.taskCard) : emptyCard(),
    );
  }

  async function handleSaveEdited() {
    if (!result || !editedCard) return;
    if (
      !editedCard.target_objects.length ||
      !editedCard.steps.length ||
      !editedCard.end_condition
    ) {
      notify("error", "任务卡至少需要目标物体、步骤和结束条件");
      return;
    }
    setSubmitting(true);
    try {
      const updated = await submitEditedCard(result.id, {
        sceneName: selectedTask?.sceneName ?? "",
        card: editedCard,
      });
      setResult(updated);
      setEditing(false);
      setStep("done");
      notify("success", "任务卡已提交，待管理员审核");
    } catch (error) {
      notify("error", guideTaskErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  function handleNoEdit() {
    setEditing(false);
    setStep("done");
  }

  function goUpload() {
    if (!result || !selectedTask) return;
    sessionStorage.setItem(SELECTED_TASK_STORAGE_KEY, selectedTask.id);
    navigate("/collector/upload");
  }

  function reset() {
    setPhotos((current) => {
      current.forEach((photo) => URL.revokeObjectURL(photo.url));
      return [];
    });
    setResult(null);
    setEditedCard(null);
    setEditing(false);
    setStep("pick");
    setSelectedTaskId("");
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">AI 拍照指导</p>
          <h1>场景型任务 · 拍照生成任务卡</h1>
          <span>拍摄环境照片 → 识别环境物体 → 生成结构化任务卡 → 按卡采集</span>
        </div>
      </div>

      {(step === "pick" || step === "photo") && (
        <ol className="upload-progress-steps" aria-label="指导步骤">
          <li className={selectedTask ? "complete" : "active"}>
            <span>{selectedTask ? <CheckCircle2 size={16} /> : "1"}</span>
            <div><strong>选择场景型任务</strong><small>确认采集场景</small></div>
          </li>
          <li className={step === "photo" && photos.length ? "active" : ""}>
            <span>{photos.length ? <CheckCircle2 size={16} /> : "2"}</span>
            <div><strong>拍摄环境照片</strong><small>1~5 张识别环境物体</small></div>
          </li>
          <li>
            <span>3</span>
            <div><strong>生成任务卡</strong><small>AI 识别并生成操作指引</small></div>
          </li>
        </ol>
      )}

      {/* Step 1: 选择场景型任务 */}
      {step === "pick" && (
        <section className="content-card upload-flow-card">
          <div className="card-heading">
            <div><h2>选择一个场景型任务</h2><p>仅展示已发布的场景型任务，拍照指导会按场景生成任务卡</p></div>
          </div>
          {taskMode === "loading" ? (
            <p className="modal-hint task-load-state"><RefreshCw className="spin" size={16} />正在读取任务…</p>
          ) : taskMode === "unavailable" ? (
            <div className="empty-state"><span>任务服务暂不可用</span></div>
          ) : sceneTasks.length === 0 ? (
            <div className="empty-state"><Camera size={26} /><strong>暂无场景型任务</strong><span>管理员发布场景型任务后可在此使用拍照指导</span></div>
          ) : (
            <div className="task-hall-grid">
              {sceneTasks.map((task) => (
                <article className="content-card task-card" key={task.id}>
                  <div className="task-card-head">
                    <div>
                      <p className="task-card-eyebrow"><span>场景：{task.sceneName}</span></p>
                      <h2>{task.title}</h2>
                    </div>
                    <StatusBadge label={task.status === "paused" ? "已暂停" : "进行中"} tone={task.status === "paused" ? "warning" : "success"} />
                  </div>
                  <p className="task-desc">
                    {task.normalizedRequirements?.scene_description ?? (task.description || "（任务未提供说明）")}
                  </p>
                  <div className="task-card-foot">
                    <div className="task-price">
                      <Camera size={16} />
                      <span><strong>环境拍照指导</strong><small>识别物体并生成操作卡</small></span>
                    </div>
                    <button
                      type="button"
                      className="button button-primary button-small"
                      disabled={task.status !== "published"}
                      onClick={() => chooseTask(task.id)}
                    >
                      下一步<ArrowRight size={14} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Step 2: 上传环境照片 */}
      {step === "photo" && selectedTask && (
        <section className="content-card upload-flow-card">
          <div className="card-heading">
            <div><h2>拍摄环境照片</h2><p>拍摄/上传 1~5 张该场景的环境照片，用于识别环境物体（如冰箱、灶台、抹布等）</p></div>
            <div className="selected-task-summary">
              <small>当前场景</small>
              <strong>{selectedTask.title}</strong>
              <span>{selectedTask.sceneName}</span>
            </div>
          </div>
          <div className="guide-photo-grid">
            {photos.map((photo, index) => (
              <div className="guide-photo-tile" key={`${photo.file.name}-${index}`}>
                <img src={photo.url} alt={`环境照片 ${index + 1}`} />
                <button type="button" className="guide-photo-remove" aria-label={`移除照片 ${index + 1}`} onClick={() => removePhoto(index)}>
                  <X size={14} />
                </button>
              </div>
            ))}
            {photos.length < 5 && (
              <label className="guide-photo-add" role="button" aria-label="添加环境照片">
                <Upload size={22} />
                <span>添加照片</span>
                <em>{photos.length}/5</em>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="file-input"
                  onChange={(event) => void handleAddPhoto(Array.from(event.target.files ?? []))}
                />
              </label>
            )}
          </div>
          <div className="guide-photo-actions">
            <button type="button" className="button button-secondary" onClick={() => setStep("pick")}>
              <ArrowLeft size={14} />返回
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => void handleGenerate()}
              disabled={photos.length === 0 || generating}
            >
              {generating ? <><Loader2 className="spin" size={14} />识别并生成中…</> : <><Sparkles size={14} />AI 识别并生成任务卡</>}
            </button>
          </div>
        </section>
      )}

      {/* Step 3: 预览 / 编辑任务卡 */}
      {step === "preview" && result && (
        <section className="content-card upload-flow-card">
          <div className="card-heading">
            <div><h2>任务卡预览</h2><p>AI 根据环境物体生成的采集任务卡，可编辑后提交审核</p></div>
            <StatusBadge label="AI 生成" tone="info" />
          </div>

          {result.envObjects.length > 0 && (
            <div className="guide-env-objects">
              <p className="guide-subtitle"><MapIcon size={14} />识别到的环境物体</p>
              <div className="guide-env-object-list">
                {result.envObjects.map((object, index) => (
                  <span className="guide-env-object" key={`${object.name}-${index}`}>{object.name}</span>
                ))}
              </div>
            </div>
          )}

          {!editing && taskCard ? (
            <div className="guide-card-preview">
              <div className="guide-card-panel">
                <p className="guide-panel-title">
                  <Camera size={15} />目标物体
                  <em className="guide-panel-count">{taskCard.target_objects.length} 个</em>
                </p>
                <div className="guide-target-list">
                  {taskCard.target_objects.map((object, index) => (
                    <span className="guide-target-chip" key={`${object.name}-${index}`}>
                      <ShieldCheck size={14} />
                      <strong>{object.name}</strong>
                      {object.action ? <small>{object.action}</small> : null}
                    </span>
                  ))}
                </div>
              </div>
              <div className="guide-card-panel">
                <p className="guide-panel-title">
                  <RefreshCw size={15} />操作步骤
                  <em className="guide-panel-count">{taskCard.steps.length} 步</em>
                </p>
                <ol className="guide-steps-list">
                  {taskCard.steps.map((stepText, index) => (
                    <li key={index}><span>{index + 1}</span>{stepText}</li>
                  ))}
                </ol>
              </div>
              <div className="guide-card-panel">
                <p className="guide-panel-title"><CheckCircle2 size={15} />结束条件</p>
                <p className="guide-end-condition">{taskCard.end_condition}</p>
              </div>
              <div className="guide-card-criteria">
                <div className="guide-criterion-panel guide-success">
                  <p className="guide-panel-title guide-crite-title-success">
                    <CheckCircle2 size={15} />成功判定
                  </p>
                  <ul className="guide-crite-list">
                    {taskCard.success_criteria.map((item, index) => (
                      <li key={index}><CheckCircle2 size={14} /><span>{item}</span></li>
                    ))}
                  </ul>
                </div>
                <div className="guide-criterion-panel guide-fail">
                  <p className="guide-panel-title guide-crite-title-fail">
                    <X size={15} />失败判定
                  </p>
                  <ul className="guide-crite-list">
                    {taskCard.fail_criteria.map((item, index) => (
                      <li key={index}><X size={14} /><span>{item}</span></li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="guide-card-actions">
                <button type="button" className="button button-secondary" onClick={() => setStep("photo")}>
                  <ArrowLeft size={14} />重拍
                </button>
                <button type="button" className="button button-secondary" onClick={startEdit}>
                  <Pencil size={14} />编辑后提交审核
                </button>
                <button type="button" className="button button-primary" onClick={handleNoEdit}>
                  直接按卡采集<ArrowRight size={14} />
                </button>
              </div>
            </div>
          ) : editing && editedCard ? (
            <div className="guide-card-edit">
              <label className="form-label"><span>目标物体</span>
                <input
                  className="normalize-item-text"
                  value={editedCard.target_objects.map((o) => `${o.name}${o.action ? `:${o.action}` : ""}`).join("；")}
                  onChange={(event) => {
                    const parts = event.target.value.split("；").map((value) => value.trim()).filter(Boolean);
                    setEditedCard((current) => current ? { ...current, target_objects: parts.map((part) => {
                      const [name, ...rest] = part.split(":");
                      return { name: name.trim(), ...(rest.length ? { action: rest.join(":").trim() } : {}) };
                    }) } : current);
                  }}
                />
              </label>
              <label className="form-label"><span>操作步骤（每行一步）</span>
                <textarea
                  className="normalize-item-text"
                  rows={5}
                  value={editedCard.steps.map((s) => s).join("\n")}
                  onChange={(event) => setEditedCard((current) => current ? { ...current, steps: event.target.value.split("\n").map((v) => v.trim()).filter(Boolean) } : current)}
                />
              </label>
              <label className="form-label"><span>结束条件</span>
                <input
                  className="normalize-item-text"
                  value={editedCard.end_condition}
                  onChange={(event) => setEditedCard((current) => current ? { ...current, end_condition: event.target.value } : current)}
                />
              </label>
              <label className="form-label"><span>成功判定（每行一条）</span>
                <textarea
                  className="normalize-item-text"
                  rows={3}
                  value={editedCard.success_criteria.join("\n")}
                  onChange={(event) => setEditedCard((current) => current ? { ...current, success_criteria: event.target.value.split("\n").map((v) => v.trim()).filter(Boolean) } : current)}
                />
              </label>
              <label className="form-label"><span>失败判定（每行一条）</span>
                <textarea
                  className="normalize-item-text"
                  rows={3}
                  value={editedCard.fail_criteria.join("\n")}
                  onChange={(event) => setEditedCard((current) => current ? { ...current, fail_criteria: event.target.value.split("\n").map((v) => v.trim()).filter(Boolean) } : current)}
                />
              </label>
              <div className="guide-card-actions">
                <button type="button" className="button button-secondary" onClick={() => setEditing(false)}>取消</button>
                <button type="button" className="button button-primary" onClick={() => void handleSaveEdited()} disabled={submitting}>
                  {submitting ? <><Loader2 className="spin" size={14} />提交中…</> : "提交审核"}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      )}

      {/* Step 4: 完成 */}
      {step === "done" && result && (
        <section className="content-card upload-flow-card">
          <div className="card-heading">
            <div><h2>{editing ? "已提交审核" : "任务卡就绪"}</h2>
              <p>
                {editing
                  ? "任务卡已提交，等待管理员审核后即可采集。"
                  : "任务卡已生成，可直接进入采集上传流程。"}
              </p>
            </div>
            <StatusBadge
              label={editing ? "待审核" : "可直接采集"}
              tone={editing ? "warning" : "success"}
            />
          </div>
          {!editing && taskCard && (
            <div className="guide-card-preview">
              <div className="guide-card-panel">
                <p className="guide-panel-title"><RefreshCw size={15} />操作步骤</p>
                <ol className="guide-steps-list">
                  {taskCard.steps.map((stepText, index) => (
                    <li key={index}><span>{index + 1}</span>{stepText}</li>
                  ))}
                </ol>
              </div>
              <div className="guide-card-panel">
                <p className="guide-panel-title"><CheckCircle2 size={15} />结束条件</p>
                <p className="guide-end-condition">{taskCard.end_condition}</p>
              </div>
            </div>
          )}
          <div className="guide-card-actions">
            <button type="button" className="button button-secondary" onClick={reset}>再来一张</button>
            <button type="button" className="button button-primary" onClick={goUpload}>
              进入采集上传<ArrowRight size={14} />
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
