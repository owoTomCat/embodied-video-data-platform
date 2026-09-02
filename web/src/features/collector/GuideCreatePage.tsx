"use client";

import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  Loader2,
  Map as MapIcon,
  RefreshCw,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { StatusBadge } from "../../components/StatusBadge";
import { useInteractions } from "../../interactions/InteractionContext";
import {
  generateGuideTasks,
  getCollectorLibrary,
  guideTaskErrorMessage,
} from "../../scene-guide/client/sceneGuideApi";
import type { GuideTask } from "../../scene-guide/contracts";
import {
  isSupportedPhoto,
  photoSizeError,
  uploadGuidePhoto,
} from "../../scene-guide/client/photoUpload";
import { GuideCardView } from "./GuideCardView";

type Step = "photo" | "generated";

export function GuideCreatePage({
  libraryId,
  navigate,
}: {
  libraryId: string;
  navigate(path: string): void;
}) {
  const { notify } = useInteractions();
  const [libraryName, setLibraryName] = useState("");
  const [photos, setPhotos] = useState<Array<{ file: File; url: string }>>([]);
  const [step, setStep] = useState<Step>("photo");
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GuideTask[]>([]);

  useEffect(() => {
    let active = true;
    getCollectorLibrary(libraryId)
      .then((result) => {
        if (active) setLibraryName(result.name);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [libraryId]);

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
      const tasks = await generateGuideTasks({ sceneLibraryId: libraryId, photoRefs });
      setGenerated(tasks);
      setStep("generated");
      notify("success", `已生成 ${tasks.length} 张任务卡`);
    } catch (error) {
      notify("error", guideTaskErrorMessage(error));
    } finally {
      setGenerating(false);
    }
  }

  function goLibrary() {
    navigate(`/collector/scenes/${libraryId}`);
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">AI 拍照指导</p>
          <h1>在「{libraryName || "场景库"}」拍照生成任务卡</h1>
          <span>拍摄环境照片 → 识别环境物体 → 自动拆分生成 3-5 张任务卡</span>
        </div>
      </div>

      <ol className="upload-progress-steps" aria-label="生成步骤">
        <li className={photos.length ? "complete" : "active"}>
          <span>{photos.length ? <CheckCircle2 size={16} /> : "1"}</span>
          <div><strong>拍摄环境照片</strong><small>1~5 张识别环境物体</small></div>
        </li>
        <li className={step === "generated" ? "active" : ""}>
          <span>{step === "generated" ? <CheckCircle2 size={16} /> : "2"}</span>
          <div><strong>生成任务卡</strong><small>AI 按物体拆分 3-5 张</small></div>
        </li>
      </ol>

      {step === "photo" && (
        <section className="content-card upload-flow-card">
          <div className="card-heading">
            <div><h2>拍摄环境照片</h2><p>拍摄/上传 1~5 张该场景的环境照片，用于识别环境物体并拆分成多个任务</p></div>
            <span className="task-card-tag">{libraryName}</span>
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
            <button type="button" className="button button-secondary" onClick={goLibrary}>
              <ArrowLeft size={14} />返回
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => void handleGenerate()}
              disabled={photos.length === 0 || generating}
            >
              {generating ? <><Loader2 className="spin" size={14} />识别并拆分中…</> : <><Sparkles size={14} />AI 识别并生成任务卡</>}
            </button>
          </div>
        </section>
      )}

      {step === "generated" && (
        <section className="content-card upload-flow-card">
          <div className="card-heading">
            <div><h2>已生成任务卡</h2><p>根据识别到的环境物体拆分成 {generated.length} 张任务卡，点击进入采集</p></div>
            <StatusBadge label={`${generated.length} 张`} tone="success" />
          </div>
          <div className="task-scene-grid">
            {generated.map((task) => (
              <article className="content-card task-card" key={task.id} style={{ minHeight: "auto" }}>
                <div className="task-card-head">
                  <div>
                    <p className="task-card-eyebrow"><MapIcon size={13} />任务卡 {task.taskIndex + 1}</p>
                    <h2>{task.title ?? "采集任务"}</h2>
                  </div>
                  <StatusBadge label="AI 生成" tone="info" />
                </div>
                <GuideCardView card={task.taskCard} />
                <div className="task-card-foot">
                  <button
                    type="button"
                    className="button button-primary button-small"
                    onClick={() => goLibrary()}
                  >
                    返回场景库<ArrowRight size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
