"use client";

import { Map, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Modal } from "../../components/Modal";
import { StatusBadge } from "../../components/StatusBadge";
import { useInteractions } from "../../interactions/InteractionContext";
import {
  createScene,
  deleteScene,
  getSceneInventory,
  listSceneLibrary,
  listScenes,
  updateScene,
  type SceneInventoryItem,
} from "../../scene-system/client/sceneSystemApi";
import type {
  Scene,
  SceneLibraryItem,
} from "../../scene-system/contracts";
import { listSceneCategoryPricing } from "../../scene-pricing/client/scenePricingApi";
import type { SceneCategoryPricing } from "../../scene-pricing/contracts";

type SceneModalState = {
  mode: "create" | "edit";
  item?: Scene;
};

function formatInventoryMinutes(seconds: number): string {
  if (seconds <= 0) return "0 分钟";
  return `${Math.round((seconds / 60) * 10) / 10} 分钟`;
}

export function SceneSystemPage() {
  const { notify } = useInteractions();
  const [mode, setMode] = useState<"loading" | "live" | "unavailable">("loading");
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [categories, setCategories] = useState<SceneCategoryPricing[]>([]);
  const [library, setLibrary] = useState<SceneLibraryItem[]>([]);
  const [inventory, setInventory] = useState<SceneInventoryItem[]>([]);
  const [sceneModal, setSceneModal] = useState<SceneModalState>();
  const [deletingId, setDeletingId] = useState<string>();
  const sceneTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      listScenes(),
      listSceneCategoryPricing(),
      listSceneLibrary(),
      getSceneInventory(),
    ])
      .then(([nextScenes, nextCategories, nextLibrary, nextInventory]) => {
        if (!active) return;
        setScenes(nextScenes);
        setCategories(nextCategories);
        setLibrary(nextLibrary);
        setInventory(nextInventory);
        setMode("live");
      })
      .catch(() => {
        if (!active) return;
        setMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  const categoryName = (key: string) =>
    categories.find((item) => item.categoryKey === key)?.name ?? key;

  async function handleCreateScene(input: {
    name: string;
    categoryKey: string;
    description?: string;
  }) {
    const item = await createScene(input);
    setScenes((current) => [...current, item]);
    setSceneModal(undefined);
    notify("success", `已新增场景「${item.name}」`);
  }

  async function handleUpdateScene(
    id: string,
    input: { name?: string; description?: string; enabled?: boolean },
  ) {
    const item = await updateScene(id, input);
    setScenes((current) =>
      current.map((entry) => (entry.id === id ? item : entry)),
    );
    setSceneModal(undefined);
    notify("success", "场景已更新");
  }

  async function handleToggleScene(item: Scene) {
    try {
      const next = await updateScene(item.id, { enabled: !item.enabled });
      setScenes((current) =>
        current.map((entry) => (entry.id === next.id ? next : entry)),
      );
      notify("success", item.enabled ? "场景已停用" : "场景已启用");
    } catch (reason) {
      notify("error", reason instanceof Error ? reason.message : "操作失败");
    }
  }

  async function handleDeleteScene(item: Scene) {
    if (!window.confirm(`确认删除场景「${item.name}」？`)) {
      return;
    }
    setDeletingId(item.id);
    try {
      await deleteScene(item.id);
      setScenes((current) => current.filter((entry) => entry.id !== item.id));
      notify("success", "场景已删除");
    } catch (reason) {
      notify("error", reason instanceof Error ? reason.message : "删除失败");
    } finally {
      setDeletingId(undefined);
    }
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">场景 · 场景库 · 场景存量</p>
          <h1>场景体系</h1>
          <span>场景为单层结构，每个场景归属一个计费大类；场景库管理实际采集场景</span>
        </div>
        <span className="live-pill">
          <i />
          {mode === "live"
            ? "已同步"
            : mode === "loading"
              ? "读取中"
              : "暂不可用"}
        </span>
      </div>

      {mode === "unavailable" && (
        <p className="form-message">场景体系服务暂不可用，请稍后重试。</p>
      )}

      {/* 场景存量看板 */}
      <section className="content-card table-card">
        <div className="card-heading">
          <div><h2>场景存量看板</h2><p>各场景当前合格有效时长 vs 目标时长（场景型任务目标之和），缺口大的优先补量</p></div>
        </div>
        <div className="table-scroll"><table className="data-table">
          <thead><tr><th>场景</th><th>当前存量</th><th>目标时长</th><th>缺口</th><th>场景型任务数</th><th>状态</th></tr></thead>
          <tbody>
            {inventory.map((item) => (
              <tr key={item.sceneName}>
                <td><strong>{item.sceneName || "（空白场景）"}</strong></td>
                <td className="nowrap-cell">{formatInventoryMinutes(item.currentSeconds)}</td>
                <td className="nowrap-cell">{item.type === "scene_type" ? formatInventoryMinutes(item.targetSeconds) : "—"}</td>
                <td className="nowrap-cell">
                  {item.shortfallSeconds > 0 ? <strong className="money-in">{formatInventoryMinutes(item.shortfallSeconds)}</strong> : <span className="muted">已达标</span>}
                </td>
                <td>{item.taskCount > 0 ? `${item.taskCount} 个` : <span className="muted">—</span>}</td>
                <td>{item.shortfallSeconds > 0 ? <StatusBadge label="需补量" tone="warning" /> : <StatusBadge label="达标" tone="success" />}</td>
              </tr>
            ))}
            {inventory.length === 0 && <tr><td colSpan={6}><div className="empty-state compact-empty"><Map size={18} /><span>暂无场景存量数据</span></div></td></tr>}
          </tbody>
        </table></div>
      </section>

      {/* 场景管理 */}
      <section className="content-card table-card">
        <div className="card-heading">
          <div><h2>场景</h2><p>单层场景字典：每个场景归属一个计费大类（大类价格在结算与钱包页维护）</p></div>
          <button
            ref={sceneTriggerRef}
            className="button button-secondary"
            disabled={mode === "unavailable"}
            onClick={() => setSceneModal({ mode: "create" })}
          >
            <Plus size={15} />新增场景
          </button>
        </div>
        <div className="table-scroll"><table className="data-table">
          <thead><tr><th>场景</th><th>计费大类</th><th>说明</th><th>状态</th><th /></tr></thead>
          <tbody>
            {scenes.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.name}</strong></td>
                <td><span className="scene-group-code">{categoryName(item.categoryKey)}</span></td>
                <td><small className="field-help">{item.description || "—"}</small></td>
                <td>{item.enabled ? <StatusBadge label="启用" tone="success" /> : <StatusBadge label="停用" tone="neutral" />}</td>
                <td>
                  <span className="row-actions">
                    <button className="table-action" onClick={() => setSceneModal({ mode: "edit", item })}>编辑</button>
                    <button className="table-action" disabled={deletingId === item.id} onClick={() => void handleToggleScene(item)}>{item.enabled ? "停用" : "启用"}</button>
                    <button className="table-action" disabled={deletingId === item.id} onClick={() => void handleDeleteScene(item)}>删除</button>
                  </span>
                </td>
              </tr>
            ))}
            {scenes.length === 0 && <tr><td colSpan={5}>暂无场景，点击「新增场景」创建。</td></tr>}
          </tbody>
        </table></div>
      </section>

      {/* 场景库（只读） */}
      <section className="content-card table-card">
        <div className="card-heading">
          <div><h2>场景库</h2><p>数采个人场景库（只读统一视图）；建库由数采在任务大厅完成</p></div>
        </div>
        <div className="table-scroll"><table className="data-table">
          <thead><tr><th>场景</th><th>场景类别</th><th>子场景</th><th>说明</th><th>状态</th></tr></thead>
          <tbody>
            {library.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.name}</strong><small className="field-help">{item.id}</small></td>
                <td><span className="scene-group-code">{item.categoryName}</span></td>
                <td>
                  {item.subScenes.length > 0
                    ? item.subScenes.map((sub) => <span key={sub.id} className="tag-chip">{sub.name}</span>)
                    : <span className="muted">未设置子场景</span>}
                </td>
                <td><small className="field-help">{item.description || "—"}</small></td>
                <td>{item.enabled ? <StatusBadge label="启用" tone="success" /> : <StatusBadge label="停用" tone="neutral" />}</td>
              </tr>
            ))}
            {library.length === 0 && <tr><td colSpan={5}>暂无场景库。</td></tr>}
          </tbody>
        </table></div>
      </section>

      {sceneModal && (
        <SceneModal
          state={sceneModal}
          categories={categories}
          onClose={() => setSceneModal(undefined)}
          returnFocusRef={sceneTriggerRef}
          onCreate={(input) => void handleCreateScene(input)}
          onUpdate={(id, input) => void handleUpdateScene(id, input)}
        />
      )}
    </div>
  );
}

function SceneModal({
  state,
  categories,
  onClose,
  returnFocusRef,
  onCreate,
  onUpdate,
}: {
  state: SceneModalState;
  categories: SceneCategoryPricing[];
  onClose(): void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  onCreate(input: { name: string; categoryKey: string; description?: string }): void;
  onUpdate(id: string, input: { name?: string; description?: string; enabled?: boolean }): void;
}) {
  const [name, setName] = useState(state.item?.name ?? "");
  const [categoryKey, setCategoryKey] = useState(
    state.item?.categoryKey ?? categories[0]?.categoryKey ?? "family",
  );
  const [description, setDescription] = useState(state.item?.description ?? "");
  const [error, setError] = useState("");

  function submit() {
    if (!name.trim()) {
      setError("请填写场景名称");
      return;
    }
    if (state.mode === "create") {
      onCreate({ name: name.trim(), categoryKey, description: description.trim() });
    } else if (state.item) {
      onUpdate(state.item.id, { name: name.trim(), description: description.trim() });
    }
  }

  return (
    <Modal open title={state.mode === "create" ? "新增场景" : "编辑场景"} onClose={onClose} returnFocusRef={returnFocusRef}>
      <form className="modal-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <label>
          场景名称
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="例如：厨房" required />
        </label>
        {state.mode === "create" ? (
          <label>
            计费大类
            <select value={categoryKey} onChange={(event) => setCategoryKey(event.target.value)}>
              {categories.map((item) => (
                <option key={item.categoryKey} value={item.categoryKey}>{item.name}</option>
              ))}
            </select>
            <small className="field-help">计费大类决定计费（在结算与钱包页按大类调价）</small>
          </label>
        ) : (
          <label>
            计费大类
            <input value={categoryName(categories, state.item?.categoryKey)} disabled />
          </label>
        )}
        <label>
          场景描述
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={2000} placeholder="描述该场景下的操作内容" />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose}>取消</button>
          <button type="submit" className="button button-primary">{state.mode === "create" ? "新增" : "保存"}</button>
        </div>
      </form>
    </Modal>
  );
}

function categoryName(categories: SceneCategoryPricing[], key?: string): string {
  if (!key) return "—";
  return categories.find((item) => item.categoryKey === key)?.name ?? key;
}
