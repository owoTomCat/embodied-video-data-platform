"use client";

import {
  Map,
  Plus,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Modal } from "../../components/Modal";
import { StatusBadge } from "../../components/StatusBadge";
import { useInteractions } from "../../interactions/InteractionContext";
import {
  createSceneClassification,
  createSceneLevel1,
  createSceneLibrary,
  deleteSceneClassification,
  deleteSceneLevel1,
  deleteSceneLibrary,
  listLevel1Scenes,
  listSceneClassification,
  listSceneLibrary,
  updateSceneClassification,
  updateSceneLevel1,
  updateSceneLibrary,
} from "../../scene-system/client/sceneSystemApi";
import type {
  Level1Scene,
  SceneClassification,
  SceneLibraryItem,
} from "../../scene-system/contracts";

type Level1ModalState = {
  mode: "create" | "edit";
  item?: Level1Scene;
};

type ClassificationModalState = {
  mode: "create" | "edit";
  presetLevel1Code?: string;
  item?: SceneClassification;
};

type LibraryModalState = {
  mode: "create" | "edit";
  item?: SceneLibraryItem;
};

export function SceneSystemPage() {
  const { notify } = useInteractions();
  const [mode, setMode] = useState<"loading" | "live" | "unavailable">("loading");
  const [level1, setLevel1] = useState<Level1Scene[]>([]);
  const [classification, setClassification] = useState<SceneClassification[]>([]);
  const [library, setLibrary] = useState<SceneLibraryItem[]>([]);
  const [level1Modal, setLevel1Modal] = useState<Level1ModalState>();
  const [classificationModal, setClassificationModal] =
    useState<ClassificationModalState>();
  const [libraryModal, setLibraryModal] = useState<LibraryModalState>();
  const [deletingId, setDeletingId] = useState<string>();
  // 分类表搜索
  const [classificationQuery, setClassificationQuery] = useState("");
  // 场景库 Tab + 筛选
  const [libraryTab, setLibraryTab] = useState<string>("all");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryStatus, setLibraryStatus] = useState<"all" | "enabled" | "disabled">("all");
  const level1TriggerRef = useRef<HTMLButtonElement>(null);
  const classificationTriggerRef = useRef<HTMLButtonElement>(null);
  const libraryTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      listLevel1Scenes(),
      listSceneClassification(),
      listSceneLibrary(),
    ])
      .then(([nextLevel1, nextClassification, nextLibrary]) => {
        if (!active) return;
        setLevel1(nextLevel1);
        setClassification(nextClassification);
        setLibrary(nextLibrary);
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

  const filteredClassification = useMemo(() => {
    const query = classificationQuery.trim().toLowerCase();
    if (!query) return classification;
    return classification.filter(
      (item) =>
        item.level1Name.toLowerCase().includes(query) ||
        item.level2Name.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query),
    );
  }, [classification, classificationQuery]);

  const grouped = useMemo(() => {
    return level1.map((level) => ({
      level,
      items: filteredClassification.filter(
        (item) => item.level1Code === level.code && item.enabled,
      ),
      disabled: filteredClassification.filter(
        (item) => item.level1Code === level.code && !item.enabled,
      ),
    }));
  }, [level1, filteredClassification]);

  const filteredLibrary = useMemo(() => {
    let rows = library;
    if (libraryTab !== "all") {
      const key = level1.find((level) => level.code === libraryTab)?.categoryKey;
      rows = rows.filter((item) => item.categoryKey === key);
    }
    const query = libraryQuery.trim().toLowerCase();
    if (query) {
      rows = rows.filter(
        (item) =>
          item.name.toLowerCase().includes(query) ||
          item.categoryName.toLowerCase().includes(query) ||
          item.subScenes.some((sub) => sub.level2Name.toLowerCase().includes(query)),
      );
    }
    if (libraryStatus === "enabled") rows = rows.filter((item) => item.enabled);
    if (libraryStatus === "disabled") rows = rows.filter((item) => !item.enabled);
    return rows;
  }, [library, libraryTab, libraryQuery, libraryStatus, level1]);

  async function handleCreateLevel1(input: {
    code: string;
    name: string;
    description?: string;
    sortOrder?: number;
  }) {
    const item = await createSceneLevel1(input);
    setLevel1((current) => [...current, item].sort((a, b) => a.sortOrder - b.sortOrder));
    setLevel1Modal(undefined);
    notify("success", `已新增一级场景「${item.code} ${item.name}」并创建计费大类`);
  }

  async function handleUpdateLevel1(
    id: string,
    input: { name?: string; description?: string; sortOrder?: number; enabled?: boolean },
  ) {
    const item = await updateSceneLevel1(id, input);
    setLevel1((current) =>
      current.map((entry) => (entry.id === id ? item : entry)),
    );
    setLevel1Modal(undefined);
    notify("success", "一级场景已更新");
  }

  async function handleToggleLevel1(item: Level1Scene) {
    try {
      const next = await updateSceneLevel1(item.id, { enabled: !item.enabled });
      setLevel1((current) =>
        current.map((entry) => (entry.id === next.id ? next : entry)),
      );
      notify("success", item.enabled ? "一级场景已停用" : "一级场景已启用");
    } catch (reason) {
      notify("error", reason instanceof Error ? reason.message : "操作失败");
    }
  }

  async function handleDeleteLevel1(item: Level1Scene) {
    if (!window.confirm(`确认删除一级场景「${item.code} ${item.name}」？其计费大类将一并删除。`)) {
      return;
    }
    setDeletingId(item.id);
    try {
      await deleteSceneLevel1(item.id);
      setLevel1((current) => current.filter((entry) => entry.id !== item.id));
      notify("success", "一级场景已删除");
    } catch (reason) {
      notify("error", reason instanceof Error ? reason.message : "删除失败");
    } finally {
      setDeletingId(undefined);
    }
  }

  async function handleCreateClassification(input: {
    level1Code: string;
    level2Name: string;
    description?: string;
  }) {
    const item = await createSceneClassification(input);
    setClassification((current) => [...current, item]);
    setClassificationModal(undefined);
    notify("success", `已新增二级场景「${item.level1Name}-${item.level2Name}」`);
  }

  async function handleUpdateClassification(
    id: string,
    input: { level2Name?: string; description?: string; enabled?: boolean },
  ) {
    const item = await updateSceneClassification(id, input);
    setClassification((current) =>
      current.map((entry) => (entry.id === id ? item : entry)),
    );
    setClassificationModal(undefined);
    notify("success", "二级场景已更新");
  }

  async function handleToggleClassification(item: SceneClassification) {
    try {
      const next = await updateSceneClassification(item.id, {
        enabled: !item.enabled,
      });
      setClassification((current) =>
        current.map((entry) => (entry.id === next.id ? next : entry)),
      );
      notify("success", item.enabled ? "二级场景已停用" : "二级场景已启用");
    } catch (reason) {
      notify("error", reason instanceof Error ? reason.message : "操作失败");
    }
  }

  async function handleDeleteClassification(item: SceneClassification) {
    if (!window.confirm(`确认删除二级场景「${item.level1Name}-${item.level2Name}」？`)) {
      return;
    }
    setDeletingId(item.id);
    try {
      await deleteSceneClassification(item.id);
      setClassification((current) => current.filter((entry) => entry.id !== item.id));
      notify("success", "二级场景已删除");
    } catch (reason) {
      notify("error", reason instanceof Error ? reason.message : "删除失败");
    } finally {
      setDeletingId(undefined);
    }
  }

  async function handleCreateLibrary(input: {
    name: string;
    categoryKey: string;
    subSceneIds: string[];
    description?: string;
  }) {
    const item = await createSceneLibrary(input);
    setLibrary((current) => [item, ...current]);
    setLibraryModal(undefined);
    notify("success", `已新增场景「${item.name}」`);
  }

  async function handleUpdateLibrary(
    id: string,
    input: {
      name?: string;
      categoryKey?: string;
      subSceneIds?: string[];
      description?: string;
      enabled?: boolean;
    },
  ) {
    const item = await updateSceneLibrary(id, input);
    setLibrary((current) =>
      current.map((entry) => (entry.id === id ? item : entry)),
    );
    setLibraryModal(undefined);
    notify("success", "场景已更新");
  }

  async function handleToggleLibrary(item: SceneLibraryItem) {
    try {
      const next = await updateSceneLibrary(item.id, { enabled: !item.enabled });
      setLibrary((current) =>
        current.map((entry) => (entry.id === next.id ? next : entry)),
      );
      notify("success", item.enabled ? "场景已停用" : "场景已启用");
    } catch (reason) {
      notify("error", reason instanceof Error ? reason.message : "操作失败");
    }
  }

  async function handleDeleteLibrary(item: SceneLibraryItem) {
    if (!window.confirm(`确认删除场景「${item.name}」？`)) {
      return;
    }
    setDeletingId(item.id);
    try {
      await deleteSceneLibrary(item.id);
      setLibrary((current) => current.filter((entry) => entry.id !== item.id));
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
          <p className="page-kicker">一级场景 · 场景分类表 · 场景库</p>
          <h1>场景体系</h1>
          <span>一级场景可管理并关联计费大类；分类表按「一级编码 + 一级场景 + 二级场景 + 场景描述」维护；场景库管理实际采集场景</span>
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

      {/* 一级场景管理 */}
      <section className="content-card">
        <div className="card-heading">
          <div><h2>一级场景</h2><p>一级场景与计费大类 1:1 关联（新增时自动创建计费行，默认 20 元/小时，可在结算与钱包页调整）</p></div>
          <button
            ref={level1TriggerRef}
            className="button button-secondary"
            disabled={mode === "unavailable"}
            onClick={() => setLevel1Modal({ mode: "create" })}
          >
            <Plus size={15} />新增一级场景
          </button>
        </div>
        <div className="scene-level1-grid">
          {level1.map((level) => (
            <div className="content-card scene-level1-card" key={level.id}>
              <div className="scene-level1-head">
                <span className="scene-group-code">{level.code}</span>
                <strong>{level.name}</strong>
                <em className="scene-level1-billing">计费 {level.categoryKey}</em>
              </div>
              <p className="scene-level1-desc">{level.description || "暂无描述"}</p>
              <div className="scene-level1-meta">
                <span>{level.level2Count} 个二级场景</span>
                <span>{level.libraryCount} 个场景库引用</span>
                {!level.enabled && <StatusBadge label="停用" tone="neutral" />}
              </div>
              <div className="scene-level1-actions">
                <button className="table-action" onClick={() => setClassificationModal({ mode: "create", presetLevel1Code: level.code })}>
                  <Plus size={13} />新增二级场景
                </button>
                <button className="table-action" onClick={() => setLevel1Modal({ mode: "edit", item: level })}>编辑</button>
                <button className="table-action" disabled={deletingId === level.id} onClick={() => void handleToggleLevel1(level)}>{level.enabled ? "停用" : "启用"}</button>
                <button className="table-action" disabled={deletingId === level.id} onClick={() => void handleDeleteLevel1(level)}>删除</button>
              </div>
            </div>
          ))}
          {level1.length === 0 && <p className="form-message">暂无一级场景，点击「新增一级场景」创建。</p>}
        </div>
      </section>

      {/* 场景分类表 */}
      <section className="content-card">
        <div className="card-heading">
          <div><h2>场景分类表</h2><p>二级场景为一级下的细分（每个一级至少 3 个）</p></div>
          <div className="scene-search-box">
            <Search size={15} />
            <input
              aria-label="搜索二级场景"
              value={classificationQuery}
              onChange={(event) => setClassificationQuery(event.target.value)}
              placeholder="搜索一级/二级场景或描述…"
            />
          </div>
        </div>
        {classificationQuery.trim() && (
          <p className="field-help">
            搜索到 {filteredClassification.length} 个二级场景（共 {classification.length} 个）
          </p>
        )}
        <div className="scene-classification-grid">
          {grouped.map(({ level, items, disabled }) => (
            <div className="content-card scene-group" key={level.code}>
              <div className="scene-group-head">
                <span className="scene-group-code">{level.code}</span>
                <strong>{level.name}</strong>
                <em>{items.length + disabled.length} 个二级</em>
                <button
                  className="table-action"
                  onClick={() => setClassificationModal({ mode: "create", presetLevel1Code: level.code })}
                >
                  <Plus size={13} />新增
                </button>
              </div>
              <ul className="scene-group-list">
                {[...items, ...disabled].map((item) => (
                  <li key={item.id}>
                    <div className="scene-group-item-main">
                      <strong>{item.level2Name}</strong>
                      <small>{item.description || "暂无描述"}</small>
                    </div>
                    <span className="row-actions">
                      {!item.enabled && <StatusBadge label="停用" tone="neutral" />}
                      <button className="table-action" onClick={() => setClassificationModal({ mode: "edit", item })}>编辑</button>
                      <button className="table-action" disabled={deletingId === item.id} onClick={() => void handleToggleClassification(item)}>{item.enabled ? "停用" : "启用"}</button>
                      <button className="table-action" disabled={deletingId === item.id} onClick={() => void handleDeleteClassification(item)}>删除</button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* 场景库 */}
      <section className="content-card table-card">
        <div className="card-heading">
          <div><h2>场景库</h2><p>每个外包人员的实际采集场景：场景类别（一级）+ 包含的子场景（二级）；任务创建从此处选场景并自动带出类别定价</p></div>
          <button
            ref={libraryTriggerRef}
            className="button button-secondary"
            disabled={mode === "unavailable"}
            onClick={() => setLibraryModal({ mode: "create" })}
          >
            <Plus size={15} />新增场景
          </button>
        </div>
        <div className="scene-library-toolbar">
          <div className="scene-library-tabs" role="tablist" aria-label="场景库类别筛选">
            <button
              type="button"
              role="tab"
              aria-selected={libraryTab === "all"}
              className={`scene-library-tab${libraryTab === "all" ? " active" : ""}`}
              onClick={() => setLibraryTab("all")}
            >
              全部 {library.length}
            </button>
            {level1.map((level) => (
              <button
                key={level.code}
                type="button"
                role="tab"
                aria-selected={libraryTab === level.code}
                className={`scene-library-tab${libraryTab === level.code ? " active" : ""}`}
                onClick={() => setLibraryTab(level.code)}
              >
                {level.name} {library.filter((item) => item.categoryKey === level.categoryKey).length}
              </button>
            ))}
          </div>
          <div className="scene-library-filters">
            <div className="scene-search-box">
              <Search size={15} />
              <input
                aria-label="搜索场景库"
                value={libraryQuery}
                onChange={(event) => setLibraryQuery(event.target.value)}
                placeholder="搜索场景/子场景…"
              />
            </div>
            <select
              aria-label="场景状态筛选"
              value={libraryStatus}
              onChange={(event) => setLibraryStatus(event.target.value as typeof libraryStatus)}
            >
              <option value="all">全部状态</option>
              <option value="enabled">启用</option>
              <option value="disabled">停用</option>
            </select>
          </div>
        </div>
        <div className="table-scroll"><table className="data-table">
          <thead><tr><th>场景</th><th>场景类别</th><th>子场景</th><th>说明</th><th>状态</th><th/></tr></thead>
          <tbody>
            {filteredLibrary.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.name}</strong><small className="field-help">{item.id}</small></td>
                <td><span className="scene-group-code">{item.categoryName}</span></td>
                <td>
                  {item.subScenes.length > 0
                    ? item.subScenes.map((sub) => <span key={sub.id} className="tag-chip">{sub.level2Name}</span>)
                    : <span className="muted">未设置子场景</span>}
                </td>
                <td><small className="field-help">{item.description || "—"}</small></td>
                <td>{item.enabled ? <StatusBadge label="启用" tone="success" /> : <StatusBadge label="停用" tone="neutral" />}</td>
                <td>
                  <span className="row-actions">
                    <button className="table-action" onClick={() => setLibraryModal({ mode: "edit", item })}>编辑</button>
                    <button className="table-action" disabled={deletingId === item.id} onClick={() => void handleToggleLibrary(item)}>{item.enabled ? "停用" : "启用"}</button>
                    <button className="table-action" disabled={deletingId === item.id} onClick={() => void handleDeleteLibrary(item)}>删除</button>
                  </span>
                </td>
              </tr>
            ))}
            {filteredLibrary.length === 0 && <tr><td colSpan={6}>当前条件下没有场景，点击「新增场景」创建第一个采集场景</td></tr>}
          </tbody>
        </table></div>
      </section>

      {level1Modal && (
        <Level1Modal
          state={level1Modal}
          onClose={() => setLevel1Modal(undefined)}
          returnFocusRef={level1TriggerRef}
          onCreate={(input) => void handleCreateLevel1(input)}
          onUpdate={(id, input) => void handleUpdateLevel1(id, input)}
        />
      )}
      {classificationModal && (
        <ClassificationModal
          state={classificationModal}
          level1={level1}
          onClose={() => setClassificationModal(undefined)}
          returnFocusRef={classificationTriggerRef}
          onCreate={(input) => void handleCreateClassification(input)}
          onUpdate={(id, input) => void handleUpdateClassification(id, input)}
        />
      )}
      {libraryModal && (
        <LibraryModal
          state={libraryModal}
          level1={level1}
          classification={classification}
          onClose={() => setLibraryModal(undefined)}
          returnFocusRef={libraryTriggerRef}
          onCreate={(input) => void handleCreateLibrary(input)}
          onUpdate={(id, input) => void handleUpdateLibrary(id, input)}
        />
      )}
    </div>
  );
}

function Level1Modal({
  state,
  onClose,
  returnFocusRef,
  onCreate,
  onUpdate,
}: {
  state: Level1ModalState;
  onClose(): void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  onCreate(input: { code: string; name: string; description?: string; sortOrder?: number }): void;
  onUpdate(id: string, input: { name?: string; description?: string; sortOrder?: number; enabled?: boolean }): void;
}) {
  const [code, setCode] = useState(state.item?.code ?? "");
  const [name, setName] = useState(state.item?.name ?? "");
  const [description, setDescription] = useState(state.item?.description ?? "");
  const [error, setError] = useState("");

  function submit() {
    if (!name.trim()) {
      setError("请填写一级场景名称");
      return;
    }
    if (state.mode === "create") {
      if (!/^[A-Za-z0-9]{2,8}$/u.test(code.trim())) {
        setError("一级编码需为 2-8 位字母或数字（如 F02、H01）");
        return;
      }
      onCreate({ code: code.trim().toUpperCase(), name: name.trim(), description: description.trim() });
    } else if (state.item) {
      onUpdate(state.item.id, { name: name.trim(), description: description.trim() });
    }
  }

  return (
    <Modal open title={state.mode === "create" ? "新增一级场景" : "编辑一级场景"} onClose={onClose} returnFocusRef={returnFocusRef}>
      <form className="modal-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <label>
          一级编码
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            maxLength={8}
            placeholder="例如：H01"
            disabled={state.mode === "edit"}
            required
          />
          <small className="field-help">{state.mode === "create" ? "2-8 位字母或数字；创建后不可修改，计费大类自动取编码小写" : "编码创建后不可修改"}</small>
        </label>
        <label>
          一级场景名称
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder="例如：医院" required />
        </label>
        <label>
          描述
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={2000} placeholder="描述该一级场景范围" />
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

function ClassificationModal({
  state,
  level1,
  onClose,
  returnFocusRef,
  onCreate,
  onUpdate,
}: {
  state: ClassificationModalState;
  level1: Level1Scene[];
  onClose(): void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  onCreate(input: { level1Code: string; level2Name: string; description?: string }): void;
  onUpdate(id: string, input: { level2Name?: string; description?: string; enabled?: boolean }): void;
}) {
  const [level1Code, setLevel1Code] = useState(
    state.item?.level1Code ?? state.presetLevel1Code ?? level1[0]?.code ?? "F01",
  );
  const [level2Name, setLevel2Name] = useState(state.item?.level2Name ?? "");
  const [description, setDescription] = useState(state.item?.description ?? "");
  const [error, setError] = useState("");

  function submit() {
    if (!level2Name.trim()) {
      setError("请填写二级场景名称");
      return;
    }
    if (state.mode === "create") {
      onCreate({ level1Code, level2Name: level2Name.trim(), description: description.trim() });
    } else if (state.item) {
      onUpdate(state.item.id, {
        level2Name: level2Name.trim(),
        description: description.trim(),
      });
    }
  }

  return (
    <Modal open title={state.mode === "create" ? "新增二级场景" : "编辑二级场景"} onClose={onClose} returnFocusRef={returnFocusRef}>
      <form className="modal-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <label>
          一级场景
          {state.mode === "create" ? (
            <select value={level1Code} onChange={(event) => setLevel1Code(event.target.value)}>
              {level1.map((level) => (
                <option key={level.code} value={level.code}>{level.code} · {level.name}</option>
              ))}
            </select>
          ) : (
            <input value={`${state.item?.level1Code} · ${state.item?.level1Name}`} disabled />
          )}
        </label>
        <label>
          二级场景名称
          <input value={level2Name} onChange={(event) => setLevel2Name(event.target.value)} maxLength={80} placeholder="例如：厨房" required />
        </label>
        <label>
          场景描述
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={2000} placeholder="描述该二级场景下的操作内容" />
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

function LibraryModal({
  state,
  level1,
  classification,
  onClose,
  returnFocusRef,
  onCreate,
  onUpdate,
}: {
  state: LibraryModalState;
  level1: Level1Scene[];
  classification: SceneClassification[];
  onClose(): void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  onCreate(input: { name: string; categoryKey: string; subSceneIds: string[]; description?: string }): void;
  onUpdate(id: string, input: { name?: string; categoryKey?: string; subSceneIds?: string[]; description?: string; enabled?: boolean }): void;
}) {
  const [name, setName] = useState(state.item?.name ?? "");
  const [categoryKey, setCategoryKey] = useState(
    state.item?.categoryKey ?? level1[0]?.categoryKey ?? "family",
  );
  const [subSceneIds, setSubSceneIds] = useState<string[]>(
    state.item?.subSceneIds ?? [],
  );
  const [description, setDescription] = useState(state.item?.description ?? "");
  const [error, setError] = useState("");

  const selectedLevel = level1.find((level) => level.categoryKey === categoryKey);
  const availableSubScenes = classification.filter(
    (item) =>
      item.enabled && item.level1Code === (selectedLevel?.code ?? "F01"),
  );

  function toggleSubScene(id: string) {
    setSubSceneIds((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );
  }

  function submit() {
    if (!name.trim()) {
      setError("请填写场景名称");
      return;
    }
    if (state.mode === "create") {
      onCreate({ name: name.trim(), categoryKey, subSceneIds, description: description.trim() });
    } else if (state.item) {
      onUpdate(state.item.id, { name: name.trim(), categoryKey, subSceneIds, description: description.trim() });
    }
  }

  return (
    <Modal open title={state.mode === "create" ? "新增场景" : "编辑场景"} onClose={onClose} returnFocusRef={returnFocusRef}>
      <form className="modal-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <label>
          场景名称
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="例如：采集员A家" required />
          <small className="field-help">场景名称建议体现采集主体与环境，如「采集员A家」</small>
        </label>
        <label>
          场景类别（一级）
          <select value={categoryKey} onChange={(event) => { setCategoryKey(event.target.value); setSubSceneIds([]); }}>
            {level1.map((level) => (
              <option key={level.code} value={level.categoryKey}>{level.code} · {level.name}</option>
            ))}
          </select>
          <small className="field-help">场景类别决定计费（在结算与钱包页按大类调价）</small>
        </label>
        <fieldset className="scene-sub-picker">
          <legend>包含的子场景（二级，可多选）</legend>
          {availableSubScenes.length > 0 ? (
            <div className="scene-sub-options">
              {availableSubScenes.map((item) => (
                <label key={item.id} className="scene-sub-option">
                  <input type="checkbox" checked={subSceneIds.includes(item.id)} onChange={() => toggleSubScene(item.id)} />
                  <span>{item.level2Name}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="form-message">该类别下暂无启用中的二级场景，请先在场景分类表中新增。</p>
          )}
        </fieldset>
        <label>
          说明
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} maxLength={2000} placeholder="场景说明（可选）" />
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
