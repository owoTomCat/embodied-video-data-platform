"use client";

import { ArrowLeft, ArrowRight, Camera, Library, Plus, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Modal } from "../../components/Modal";
import { useInteractions } from "../../interactions/InteractionContext";
import {
  createCollectorLibrary,
  guideTaskErrorMessage,
  listLibrariesByTask,
  listScenes,
} from "../../scene-guide/client/sceneGuideApi";
import type { CollectorLibrary, GuideScene } from "../../scene-guide/contracts";

export function SceneSelectionPage({
  taskId,
  navigate,
}: {
  taskId: string;
  navigate(path: string): void;
}) {
  const { notify } = useInteractions();
  const [libraries, setLibraries] = useState<CollectorLibrary[]>([]);
  const [scenes, setScenes] = useState<GuideScene[]>([]);
  const [mode, setMode] = useState<"loading" | "live" | "unavailable">("loading");

  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formName, setFormName] = useState("");
  const [selectedSceneId, setSelectedSceneId] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  function load() {
    setMode("loading");
    // 这里的 taskId 来自任务大厅的 collection_task；此处通过 getGuideTask 拿不到任务实体，
    // 用 listLibrariesByTask 直接拿该任务下的库即可；任务名从库/场景推断。
    Promise.all([
      listLibrariesByTask(taskId),
      listScenes(),
    ])
      .then(([libs, scn]) => {
        setLibraries(libs);
        setScenes(scn);
        setMode("live");
      })
      .catch(() => setMode("unavailable"));
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      listLibrariesByTask(taskId),
      listScenes(),
    ])
      .then(([libs, scn]) => {
        if (!active) return;
        setLibraries(libs);
        setScenes(scn);
        setMode("live");
      })
      .catch(() => {
        if (active) setMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, [taskId]);

  // 可选场景：过滤到与库相同的分类（库已有 categoryKey，优先用库的分类；这里简单展示全部启用场景）
  const availableScenes = scenes.filter((scene) => scene.enabled);

  async function handleCreate() {
    if (!formName.trim()) {
      notify("error", "请填写场景库名称");
      return;
    }
    if (!selectedSceneId) {
      notify("error", "请选择一个场景");
      return;
    }
    setSaving(true);
    try {
      await createCollectorLibrary({
        name: formName.trim(),
        sceneId: selectedSceneId,
        collectionTaskId: taskId,
      });
      setCreateOpen(false);
      setFormName("");
      setSelectedSceneId("");
      setMode("loading");
      load();
      notify("success", "场景库已创建");
    } catch (error) {
      notify("error", guideTaskErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">选择采集场景</p>
          <h1>去采集</h1>
          <span>选择或新建一个场景库，进入后拍照生成任务卡并采集</span>
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => navigate("/collector/tasks")}
        >
          <ArrowLeft size={14} />返回任务大厅
        </button>
      </div>

      {mode === "unavailable" ? (
        <div className="empty-state">
          <Library size={28} />
          <strong>场景服务暂不可用</strong>
          <button type="button" className="button button-secondary button-small" onClick={load}>
            <RefreshCw size={14} />重试
          </button>
        </div>
      ) : (
        <div className="task-hall-grid">
          {/* 左上角【+】快速新建场景 */}
          <button
            type="button"
            ref={triggerRef}
            className="content-card task-card scene-create-card"
            onClick={() => setCreateOpen(true)}
          >
            <div className="scene-create-inner">
              <Plus size={26} />
              <span>快速新建场景</span>
              <small>拍摄环境照片生成你的私有场景</small>
            </div>
          </button>

          {libraries.map((library) => (
            <article className="content-card task-card" key={library.id}>
              <div className="task-card-head">
                <div>
                  <p className="task-card-eyebrow">
                    <span>{library.categoryName}</span>
                  </p>
                  <h2>{library.name}</h2>
                </div>
                <span className="task-card-tag">{library.taskCount} 张任务卡</span>
              </div>
              <p className="task-desc">
                {library.scene ? `场景：${library.scene.name}` : "（未设置场景）"}
              </p>
              <div className="task-card-foot">
                <button
                  type="button"
                  className="button button-primary button-small"
                  onClick={() => navigate(`/collector/scenes/${library.id}`)}
                >
                  进入场景库<ArrowRight size={14} />
                </button>
              </div>
            </article>
          ))}

          {libraries.length === 0 && <div className="empty-state" style={{ gridColumn: "1 / -1" }}><Camera size={28} /><strong>该任务下还没有场景库</strong><span>点击左上角「+」快速创建</span></div>}
        </div>
      )}

      {createOpen && (
        <CreateSceneModal
          scenes={availableScenes}
          saving={saving}
          name={formName}
          sceneId={selectedSceneId}
          onName={setFormName}
          onScene={setSelectedSceneId}
          onCancel={() => setCreateOpen(false)}
          onCreate={() => void handleCreate()}
        />
      )}
    </div>
  );
}

function CreateSceneModal({
  scenes,
  saving,
  name,
  sceneId,
  onName,
  onScene,
  onCancel,
  onCreate,
}: {
  scenes: GuideScene[];
  saving: boolean;
  name: string;
  sceneId: string;
  onName(v: string): void;
  onScene(v: string): void;
  onCancel(): void;
  onCreate(): void;
}) {
  return (
    <Modal open title="快速新建场景库" onClose={onCancel}>
      <div className="modal-form">
        <label className="form-label">
          <span>场景库名称</span>
          <input value={name} onChange={(event) => onName(event.target.value)} maxLength={120} placeholder="如：我家厨房" />
        </label>
        <label className="form-label">
          <span>场景（单选）</span>
          <select value={sceneId} onChange={(event) => onScene(event.target.value)}>
            <option value="">请选择场景…</option>
            {scenes.map((scene) => (
              <option key={scene.id} value={scene.id}>{scene.name}</option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onCancel}>取消</button>
          <button type="button" className="button button-primary" disabled={saving} onClick={onCreate}>
            {saving ? "创建中…" : "创建场景库"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
