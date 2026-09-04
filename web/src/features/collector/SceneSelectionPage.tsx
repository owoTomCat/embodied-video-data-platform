"use client";

import { ArrowRight, Camera, Library, Plus, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { BackButton } from "../../components/BackButton";
import { Modal } from "../../components/Modal";
import { useInteractions } from "../../interactions/InteractionContext";
import {
  createCollectorLibrary,
  guideTaskErrorMessage,
  listLibrariesByTask,
  listScenes,
} from "../../scene-guide/client/sceneGuideApi";
import type { CollectorLibrary, GuideScene } from "../../scene-guide/contracts";
import { getCollectorTask } from "../../tasks/client/taskApi";
import type { CollectionTaskForCollector } from "../../tasks/contracts";

/** 通用任务（不限场景）默认绑定的“通用”场景名称 */
const GENERIC_SCENE_NAME = "通用";

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
  const [task, setTask] = useState<CollectionTaskForCollector | null>(null);
  const [mode, setMode] = useState<"loading" | "live" | "unavailable">("loading");

  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formName, setFormName] = useState("");
  const [selectedSceneId, setSelectedSceneId] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  function load() {
    setMode("loading");
    // 任务实体用于决定新建库时可选的场景；获取失败则回退为「展示全部启用场景」。
    const librariesP = listLibrariesByTask(taskId);
    const scenesP = listScenes();
    const taskP = getCollectorTask(taskId).catch(() => null);
    Promise.all([librariesP, scenesP])
      .then(([libs, scn]) => {
        setLibraries(libs);
        setScenes(scn);
        setMode("live");
      })
      .catch(() => setMode("unavailable"));
    taskP.then((loaded) => setTask(loaded));
  }

  useEffect(() => {
    let active = true;
    const librariesP = listLibrariesByTask(taskId);
    const scenesP = listScenes();
    const taskP = getCollectorTask(taskId).catch(() => null);
    Promise.all([librariesP, scenesP])
      .then(([libs, scn]) => {
        if (!active) return;
        setLibraries(libs);
        setScenes(scn);
        setMode("live");
      })
      .catch(() => {
        if (active) setMode("unavailable");
      });
    taskP.then((loaded) => {
      if (active) setTask(loaded);
    });
    return () => {
      active = false;
    };
  }, [taskId]);

  // 可选场景（启用中）
  const enabledScenes = scenes.filter((scene) => scene.enabled);
  // 「通用」场景：默认兜底场景，找不到则回退到 generic 大类下的第一个场景
  const genericScene =
    enabledScenes.find(
      (scene) => scene.categoryKey === "generic" && scene.name === GENERIC_SCENE_NAME,
    ) ??
    enabledScenes.find((scene) => scene.categoryKey === "generic") ??
    null;
  // 新建库时可选场景 + 默认选中（按任务类型驱动；自定义任务类型已移除）
  let modalScenes = enabledScenes;
  let lockedScene = false;
  let defaultSceneId = "";
  if (task) {
    if (task.taskType === "scene_type") {
      // 多目标场景任务：只允许选择该任务可选场景
      const targetIds = new Set((task.sceneTargets ?? []).map((item) => item.sceneId));
      const scoped = enabledScenes.filter((scene) => targetIds.has(scene.id));
      const byCategory = enabledScenes.filter(
        (scene) => scene.categoryKey === task.categoryKey,
      );
      modalScenes =
        scoped.length > 0 ? scoped : byCategory.length > 0 ? byCategory : enabledScenes;
      defaultSceneId = "";
    } else {
      // 通用任务：默认「通用」场景，可在全部场景中调整
      modalScenes = enabledScenes;
      defaultSceneId = genericScene?.id ?? "";
    }
  }

  function openCreate() {
    setSelectedSceneId(defaultSceneId);
    setCreateOpen(true);
  }

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
        <BackButton fallbackPath="/collector/tasks" navigate={navigate} />
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
            onClick={openCreate}
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
          scenes={modalScenes}
          locked={lockedScene}
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
  locked,
  saving,
  name,
  sceneId,
  onName,
  onScene,
  onCancel,
  onCreate,
}: {
  scenes: GuideScene[];
  locked: boolean;
  saving: boolean;
  name: string;
  sceneId: string;
  onName(v: string): void;
  onScene(v: string): void;
  onCancel(): void;
  onCreate(): void;
}) {
  const boundScene = locked ? scenes[0] : undefined;
  return (
    <Modal open title="快速新建场景库" onClose={onCancel}>
      <div className="modal-form">
        <label className="form-label">
          <span>场景库名称</span>
          <input value={name} onChange={(event) => onName(event.target.value)} maxLength={120} placeholder="如：我家厨房" />
        </label>
        <label className="form-label">
          <span>场景（单选）</span>
          {locked && boundScene ? (
            <div className="scene-bound-value" role="status">
              {boundScene.name}
              <small>已绑定任务场景，无需选择</small>
            </div>
          ) : (
            <select value={sceneId} onChange={(event) => onScene(event.target.value)}>
              <option value="">请选择场景…</option>
              {scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>{scene.name}</option>
              ))}
            </select>
          )}
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
