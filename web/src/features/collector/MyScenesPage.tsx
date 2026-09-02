"use client";

import {
  ArrowRight,
  Camera,
  Library,
  Loader2,
  Map as MapIcon,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useInteractions } from "../../interactions/InteractionContext";
import {
  createCollectorLibrary,
  deleteCollectorLibrary,
  guideTaskErrorMessage,
  listMyLibraries,
  listSceneClassification,
} from "../../scene-guide/client/sceneGuideApi";
import type {
  CollectorLibrary,
  GuideSceneClassification,
} from "../../scene-guide/contracts";

export function MyScenesPage({ navigate }: { navigate(path: string): void }) {
  const { notify } = useInteractions();
  const [mode, setMode] = useState<"loading" | "live" | "unavailable">("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [libraries, setLibraries] = useState<CollectorLibrary[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [categoryKey, setCategoryKey] = useState("");
  const [selectedSubScenes, setSelectedSubScenes] = useState<string[]>([]);
  const [formDescription, setFormDescription] = useState("");

  useEffect(() => {
    let active = true;
    listMyLibraries()
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
  }, [reloadKey]);

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

  const subScenes = useMemo(
    () => classification.filter((item) => item.enabled),
    [classification],
  );

  function toggleSubScene(id: string) {
    setSelectedSubScenes((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  async function handleCreate() {
    if (!formName.trim()) {
      notify("error", "请填写场景库名称");
      return;
    }
    if (!categoryKey) {
      notify("error", "请选择场景类别");
      return;
    }
    if (selectedSubScenes.length === 0) {
      notify("error", "请至少选择一个二级场景");
      return;
    }
    setSaving(true);
    try {
      await createCollectorLibrary({
        name: formName.trim(),
        categoryKey,
        subSceneIds: selectedSubScenes,
        description: formDescription.trim() || undefined,
      });
      setCreateOpen(false);
      setFormName("");
      setCategoryKey("");
      setSelectedSubScenes([]);
      setFormDescription("");
      setReloadKey((current) => current + 1);
      notify("success", "场景库已创建");
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
          <p className="page-kicker">我的采集场景</p>
          <h1>我的场景库</h1>
          <span>管理你负责采集的场景，在场景库下拍照生成多个私有任务卡</span>
        </div>
        <button type="button" className="button button-primary" onClick={() => setCreateOpen(true)}>
          <Plus size={14} />新建场景库
        </button>
      </div>

      {mode === "unavailable" ? (
        <div className="empty-state">
          <Library size={28} />
          <strong>场景库服务暂不可用</strong>
          <span>请稍后重试</span>
        </div>
      ) : mode === "loading" ? (
        <div className="empty-state"><span>正在读取场景库…</span></div>
      ) : libraries.length === 0 ? (
        <div className="empty-state">
          <Camera size={28} />
          <strong>还没有场景库</strong>
          <span>新建一个场景库，即可拍照生成私有任务卡</span>
        </div>
      ) : (
        <div className="task-hall-grid">
          {libraries.map((library) => (
            <article className="content-card task-card" key={library.id}>
              <div className="task-card-head">
                <div>
                  <p className="task-card-eyebrow"><span>类别：{library.categoryName}</span></p>
                  <h2>{library.name}</h2>
                </div>
                <span className="task-card-tag">{library.taskCount} 张任务卡</span>
              </div>
              <p className="task-desc">
                {library.description || `包含 ${library.subScenes.length} 个二级场景`}
              </p>
              <div className="guide-env-object-list">
                {library.subScenes.map((scene) => (
                  <span className="guide-env-object" key={scene.id}>{scene.level2Name}</span>
                ))}
              </div>
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

      {createOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="新建场景库">
            <div className="modal-body">
              <div className="card-heading">
                <div><h2>新建场景库</h2><p>从场景体系中选一级类别与二级子场景</p></div>
                <button type="button" className="icon-button" aria-label="关闭" onClick={() => setCreateOpen(false)}>×</button>
              </div>
              <label className="form-label"><span>场景库名称</span>
                <input value={formName} onChange={(event) => setFormName(event.target.value)} placeholder="如：我家厨房" />
              </label>
              <label className="form-label"><span>场景类别（一级）</span>
                <select value={categoryKey} onChange={(event) => {
                  setCategoryKey(event.target.value);
                  setSelectedSubScenes([]);
                }}>
                  <option value="">请选择…</option>
                  {[
                    { key: "family", name: "家庭" },
                    { key: "office", name: "办公室" },
                    { key: "factory", name: "工厂" },
                    { key: "generic", name: "通用" },
                  ].map((item) => (
                    <option key={item.key} value={item.key}>{item.name}</option>
                  ))}
                </select>
              </label>
              <label className="form-label"><span>二级子场景（可多选）</span>
                <div className="guide-checkbox-grid">
                  {subScenes.map((scene) => (
                    <label key={scene.id} className="guide-checkbox">
                      <input
                        type="checkbox"
                        checked={selectedSubScenes.includes(scene.id)}
                        onChange={() => toggleSubScene(scene.id)}
                      />
                      <span>{scene.level1Name}-{scene.level2Name}</span>
                    </label>
                  ))}
                </div>
              </label>
              <label className="form-label"><span>描述（可选）</span>
                <textarea rows={2} value={formDescription} onChange={(event) => setFormDescription(event.target.value)} />
              </label>
              <div className="modal-actions">
                <button type="button" className="button button-secondary" onClick={() => setCreateOpen(false)}>取消</button>
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
