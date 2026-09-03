"use client";

import {
  ArrowRight,
  Camera,
  Library,
  Loader2,
  Map as MapIcon,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useInteractions } from "../../interactions/InteractionContext";
import {
  createCollectorLibrary,
  deleteCollectorLibrary,
  getGuidePhotoUrl,
  guideTaskErrorMessage,
  listLibrariesByCategory,
  listSceneClassification,
  listSceneLevel1,
} from "../../scene-guide/client/sceneGuideApi";
import {
  isSupportedPhoto,
  photoSizeError,
  uploadGuidePhoto,
} from "../../scene-guide/client/photoUpload";
import type {
  CollectorLibrary,
  GuideSceneClassification,
  Level1Scene,
} from "../../scene-guide/contracts";

export function TaskHallPage({ navigate }: { navigate(path: string): void }) {
  const { notify } = useInteractions();
  const [level1, setLevel1] = useState<Level1Scene[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [libraries, setLibraries] = useState<CollectorLibrary[]>([]);
  const [mode, setMode] = useState<"loading" | "live" | "unavailable">("loading");
  const [reloadKey, setReloadKey] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [selectedSubScenes, setSelectedSubScenes] = useState<string[]>([]);
  const [formDescription, setFormDescription] = useState("");
  const [photos, setPhotos] = useState<Array<{ file: File; url: string }>>([]);

  // 加载一级大场景
  useEffect(() => {
    let active = true;
    listSceneLevel1()
      .then((items) => {
        if (!active) return;
        setLevel1(items);
        if (items.length > 0) setActiveCategory(items[0]!.categoryKey);
      })
      .catch(() => {
        if (!active) return;
        setMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  // 加载当前大类下的场景库
  useEffect(() => {
    if (!activeCategory) return;
    let active = true;
    listLibrariesByCategory(activeCategory)
      .then((items) => {
        if (!active) return;
        setLibraries(items);
        setMode("live");
      })
      .catch(() => {
        if (!active) return;
        setMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, [activeCategory, reloadKey]);

  const [classification, setClassification] = useState<GuideSceneClassification[]>([]);
  useEffect(() => {
    let active = true;
    listSceneClassification()
      .then((items) => {
        if (active) setClassification(items);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const activeLevel1 = level1.find((item) => item.categoryKey === activeCategory) ?? null;
  const subScenes = useMemo(
    () => classification.filter((item) => item.enabled && item.level1Name === activeLevel1?.name),
    [classification, activeLevel1],
  );

  function toggleSubScene(id: string) {
    setSelectedSubScenes((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  function resetForm() {
    setFormName("");
    setSelectedSubScenes([]);
    setFormDescription("");
    setPhotos((current) => {
      current.forEach((photo) => URL.revokeObjectURL(photo.url));
      return [];
    });
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

  async function handleCreate() {
    if (!activeCategory) return;
    if (!formName.trim()) {
      notify("error", "请填写场景库名称");
      return;
    }
    if (selectedSubScenes.length === 0) {
      notify("error", "请至少选择一个二级场景");
      return;
    }
    setSaving(true);
    try {
      const photoRefs = [];
      for (const photo of photos) {
        const objectKey = await uploadGuidePhoto(photo.file);
        photoRefs.push({
          objectKey,
          contentType: photo.file.type || "image/jpeg",
          name: photo.file.name,
        });
      }
      const created = await createCollectorLibrary({
        name: formName.trim(),
        categoryKey: activeCategory,
        subSceneIds: selectedSubScenes,
        description: formDescription.trim() || undefined,
        ...(photoRefs.length ? { photoRefs } : {}),
      });
      setCreateOpen(false);
      resetForm();
      setReloadKey((current) => current + 1);
      notify("success", "场景库已创建");
      navigate(`/collector/scenes/${created.id}`);
    } catch (error) {
      notify("error", guideTaskErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(library: CollectorLibrary) {
    if (!window.confirm(`确定删除场景库「${library.name}」？其下所有任务卡将一并删除。`)) {
      return;
    }
    setDeletingId(library.id);
    try {
      await deleteCollectorLibrary(library.id);
      setLibraries((current) => current.filter((item) => item.id !== library.id));
      notify("success", "场景库已删除");
    } catch (error) {
      notify("error", guideTaskErrorMessage(error));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">众包采集入口</p>
          <h1>任务大厅</h1>
          <span>先选一个大场景分类，再进入你的场景库拍照生成任务卡并采集</span>
        </div>
      </div>

      {mode === "unavailable" ? (
        <div className="empty-state">
          <Library size={28} />
          <strong>场景服务暂不可用</strong>
          <span>请稍后重试</span>
        </div>
      ) : (
        <>
          {/* 一级大场景分栏 */}
          <section className="task-hall-scene-levels" aria-label="大场景分类">
            {level1.map((scene) => (
              <button
                type="button"
                key={scene.categoryKey}
                className={`task-hall-level${activeCategory === scene.categoryKey ? " active" : ""}`}
                aria-pressed={activeCategory === scene.categoryKey}
                onClick={() => setActiveCategory(scene.categoryKey)}
              >
                <span className="task-hall-level-icon"><MapIcon size={18} /></span>
                <strong>{scene.name}</strong>
              </button>
            ))}
          </section>

          {/* 该大类下的场景库 + 新建入口 */}
          <div className="task-hall-toolbar">
            <div className="task-hall-toolbar-title">
              <strong>{activeLevel1?.name}</strong>
              <span>{libraries.length} 个场景库</span>
            </div>
            <button type="button" className="button button-primary button-small" onClick={() => setCreateOpen(true)}>
              <Plus size={14} />拍照新建场景库
            </button>
          </div>

          {mode === "loading" ? (
            <div className="empty-state"><span>正在读取场景库…</span></div>
          ) : libraries.length === 0 ? (
            <div className="empty-state">
              <Camera size={28} />
              <strong>该分类下还没有场景库</strong>
              <span>点击「拍照新建场景库」，拍摄环境照片生成你的私有场景</span>
            </div>
          ) : (
            <div className="task-hall-grid">
              {libraries.map((library) => (
                <article className="content-card task-card" key={library.id}>
                  {library.coverObjectKey ? (
                    <SceneCoverPhoto objectKey={library.coverObjectKey} />
                  ) : (
                    <div className="scene-library-cover scene-library-cover-empty">
                      <Camera size={22} />
                    </div>
                  )}
                  <div className="task-card-head">
                    <div>
                      <p className="task-card-eyebrow"><span>{library.categoryName}</span></p>
                      <h2>{library.name}</h2>
                    </div>
                    <span className="task-card-tag">{library.taskCount} 张任务卡</span>
                  </div>
                  <p className="task-desc">
                    {library.description || `包含 ${library.subScenes.map((s) => s.level2Name).join("、")}`}
                  </p>
                  <div className="task-card-foot">
                    <div className="task-card-actions">
                      <button
                        type="button"
                        className="button button-ghost button-small"
                        disabled={deletingId === library.id}
                        onClick={() => void handleDelete(library)}
                        aria-label={`删除场景库 ${library.name}`}
                      >
                        <Trash2 size={14} />删除
                      </button>
                      <button
                        type="button"
                        className="button button-primary button-small"
                        onClick={() => navigate(`/collector/scenes/${library.id}`)}
                      >
                        进入场景库<ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {createOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="拍照新建场景库">
            <div className="modal-body">
              <div className="card-heading">
                <div><h2>拍照新建场景库</h2><p>拍摄该场景的环境照片，首张作为场景库卡片封面</p></div>
                <button type="button" className="icon-button" aria-label="关闭" onClick={() => { setCreateOpen(false); resetForm(); }}>×</button>
              </div>

              <label className="form-label"><span>场景库名称</span>
                <input value={formName} onChange={(event) => setFormName(event.target.value)} placeholder="如：我家厨房" />
              </label>

              <label className="form-label"><span>二级场景（可多选）</span>
                <div className="guide-checkbox-grid">
                  {subScenes.map((scene) => (
                    <label key={scene.id} className="guide-checkbox">
                      <input
                        type="checkbox"
                        checked={selectedSubScenes.includes(scene.id)}
                        onChange={() => toggleSubScene(scene.id)}
                      />
                      <span>{scene.level2Name}</span>
                    </label>
                  ))}
                  {subScenes.length === 0 && <span className="form-message">当前分类暂无二级场景</span>}
                </div>
              </label>

              <label className="form-label"><span>环境照片（首张做封面）</span>
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
              </label>

              <label className="form-label"><span>描述（可选）</span>
                <textarea rows={2} value={formDescription} onChange={(event) => setFormDescription(event.target.value)} />
              </label>

              <div className="modal-actions">
                <button type="button" className="button button-secondary" onClick={() => { setCreateOpen(false); resetForm(); }}>取消</button>
                <button type="button" className="button button-primary" disabled={saving} onClick={() => void handleCreate()}>
                  {saving ? <><Loader2 className="spin" size={14} />创建中…</> : "创建场景库"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 场景库封面图：从 MinIO 取预签名 URL 展示
function SceneCoverPhoto({ objectKey }: { objectKey: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    getGuidePhotoUrl(objectKey)
      .then((result) => {
        if (active) setUrl(result.url);
      })
      .catch(() => {
        if (active) setUrl(null);
      });
    return () => {
      active = false;
    };
  }, [objectKey]);
  if (!url) return <div className="scene-library-cover scene-library-cover-empty"><Camera size={22} /></div>;
  return <div className="scene-library-cover"><img src={url} alt="场景库封面" /></div>;
}
