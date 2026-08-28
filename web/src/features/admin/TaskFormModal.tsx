"use client";

import {
  Armchair,
  Building2,
  ChefHat,
  Factory,
  FolderOpen,
  LayoutGrid,
  PenLine,
  Sparkles,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { getLabelSet } from "../../ai-quality/client/aiQualityApi";
import { Modal } from "../../components/Modal";
import { listSceneCategoryPricing } from "../../scene-pricing/client/scenePricingApi";
import { listTaskTypeCatalog } from "../../tasks/client/taskApi";
import type {
  CollectionTask,
  CollectionTaskType,
  CreateTaskInput,
  PresetScene,
  UpdateTaskInput,
} from "../../tasks/contracts";

const GENERIC_SCENE_NAME = "通用";

const presetIcons: Record<string, typeof ChefHat> = {
  "family-kitchen": ChefHat,
  "family-living": Armchair,
  "family-bedroom": LayoutGrid,
  office: Building2,
  factory: Factory,
};

function taskTypeLabel(type: CollectionTaskType): string {
  if (type === "generic") return "通用任务";
  if (type === "preset") return "预设场景";
  return "自定义";
}

export function TaskFormModal({
  open,
  mode,
  task,
  onCreate,
  onUpdate,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  mode: "create" | "edit";
  task?: CollectionTask;
  onCreate(input: CreateTaskInput): Promise<CollectionTask>;
  onUpdate(id: string, input: UpdateTaskInput): Promise<CollectionTask>;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const [taskType, setTaskType] = useState<CollectionTaskType>(
    mode === "create" ? "generic" : (task?.taskType ?? "custom"),
  );
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [sceneName, setSceneName] = useState(
    task?.sceneName ??
      (mode === "create" ? GENERIC_SCENE_NAME : ""),
  );
  const [rawRequirements, setRawRequirements] = useState(
    task?.rawRequirements ?? "",
  );
  const [price, setPrice] = useState(
    task?.pricePointsPerMinute !== null && task?.pricePointsPerMinute !== undefined
      ? String(task.pricePointsPerMinute)
      : "",
  );
  const [presetScenes, setPresetScenes] = useState<PresetScene[]>([]);
  const [priceByCategory, setPriceByCategory] = useState<Record<string, number>>({});
  const [genericTemplate, setGenericTemplate] = useState<
    { sceneName: string; defaultTitle: string; description: string; requirements: string[] } | null
  >(null);
  const [sceneSuggestions, setSceneSuggestions] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const activeSuggestionRef = useRef(false);

  const sceneOptions = useMemo(() => {
    const options = new Set<string>();
    for (const name of sceneSuggestions) options.add(name);
    if (sceneName.trim()) options.add(sceneName.trim());
    return [...options];
  }, [sceneName, sceneSuggestions]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    Promise.all([listTaskTypeCatalog(), getLabelSet(), listSceneCategoryPricing()])
      .then(([catalog, labelSet, categories]) => {
        if (!active) return;
        setPresetScenes(catalog.presetScenes);
        setGenericTemplate(catalog.generic);
        const byKey = Object.fromEntries(
          categories.map((item) => [item.categoryKey, item.pricePerHour]),
        );
        setPriceByCategory(byKey);
        setSceneSuggestions(
          labelSet.labels
            .filter((label) => label.type === "scene" && label.enabled)
            .map((label) => label.name),
        );
        // 创建模式默认选中通用任务：待目录加载后填充模板内容
        if (mode === "create" && !title.trim()) {
          applyTemplate("generic", catalog.generic, byKey);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function applyTemplate(
    kind: "generic" | PresetScene,
    template?: { defaultTitle: string; description: string; requirements: string[] },
    priceMap?: Record<string, number>,
  ) {
    const source =
      template ??
      (kind === "generic" ? genericTemplate : kind);
    if (!source) return;
    setTitle(source.defaultTitle);
    setDescription(source.description);
    setRawRequirements(source.requirements.join("\n"));
    setSceneName(kind === "generic" ? GENERIC_SCENE_NAME : kind.name);
    // 自动带出场景大类默认价（元/小时）：通用任务按「通用」类，预设场景按其所属大类
    const categoryKey = kind === "generic" ? "generic" : kind.categoryKey;
    const defaultPrice = (priceMap ?? priceByCategory)[categoryKey];
    if (defaultPrice !== undefined && defaultPrice > 0) {
      setPrice(String(defaultPrice));
    }
  }

  function selectType(next: CollectionTaskType, preset?: PresetScene) {
    const sameAsCurrent =
      next === taskType &&
      (next !== "preset" || preset?.name === sceneName);
    if (mode === "edit" && sameAsCurrent) return;
    setTaskType(next);
    setError("");
    if (next === "generic") {
      applyTemplate("generic");
    } else if (next === "preset" && preset) {
      applyTemplate(preset);
    } else {
      // 自定义：从通用/预设切过来时清空被占用的场景名与自动带出的默认价，让管理员自行填写
      if (
        sceneName === GENERIC_SCENE_NAME ||
        presetScenes.some((scene) => scene.name === sceneName)
      ) {
        setSceneName("");
      }
      setPrice("");
    }
  }

  function close() {
    if (submittingRef.current) return;
    setError("");
    onClose();
  }

  function pickScene(name: string) {
    setSceneName(name);
    activeSuggestionRef.current = false;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    const trimmedScene = sceneName.trim();
    if (taskType === "custom" && !trimmedScene) {
      setError("自定义任务请填写场景名称");
      return;
    }
    if (!trimmedScene) {
      setError("请选择任务类型或填写场景名称");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError("");

    const parsedPrice =
      price.trim() === "" ? null : Number(price);
    const fields = {
      title: title.trim(),
      description: description.trim(),
      sceneName: trimmedScene,
      taskType,
      rawRequirements: rawRequirements.trim(),
      ...(parsedPrice !== null && Number.isFinite(parsedPrice)
        ? { pricePointsPerMinute: parsedPrice }
        : { pricePointsPerMinute: null }),
    };

    try {
      if (mode === "create") {
        await onCreate(fields);
      } else if (task) {
        await onUpdate(task.id, fields);
      }
      submittingRef.current = false;
      setSubmitting(false);
      onClose();
    } catch (reason) {
      submittingRef.current = false;
      setSubmitting(false);
      setError(reason instanceof Error ? reason.message : "保存失败，请重试");
    }
  }

  const filteredSceneOptions = sceneOptions.filter((name) =>
    name.toLowerCase().includes(sceneName.trim().toLowerCase()),
  );
  const selectedPreset = presetScenes.find((scene) => scene.name === sceneName);

  return (
    <Modal
      open={open}
      title={mode === "create" ? "创建采集任务" : "编辑采集任务"}
      className="task-form-modal"
      onClose={close}
      returnFocusRef={returnFocusRef}
      initialFocusRef={firstInputRef}
    >
      <form className="modal-form" onSubmit={submit}>
        <p className="task-form-intro">
          先选择任务类型（通用任务 / 预设场景 / 自定义），再确认标题、说明与要求；保存后可进行 AI
          规范化并确认，最后发布给数采人员。
        </p>

        <section className="task-form-section task-type-section">
          <div className="task-form-section-title">
            <span>1</span>
            <div><strong>任务类型</strong><small>决定任务在数采端如何归类与质检判定</small></div>
          </div>

          <button
            type="button"
            className={`task-type-option task-type-generic${taskType === "generic" ? " active" : ""}`}
            onClick={() => selectType("generic")}
            aria-pressed={taskType === "generic"}
          >
            <span className="task-type-generic-icon"><Sparkles size={20} /></span>
            <span className="task-type-option-copy">
              <strong>通用任务</strong>
              <small>不绑定具体场景的综合类任务，适合跨场景或探索性采集</small>
            </span>
            <span className="task-type-option-check">{taskType === "generic" ? "✓" : ""}</span>
          </button>

          <div className="task-type-group-heading">预设场景</div>
          <div className="task-type-preset-grid" role="group" aria-label="预设场景">
            {presetScenes.map((scene) => {
              const Icon = presetIcons[scene.key] ?? FolderOpen;
              const selected = taskType === "preset" && sceneName === scene.name;
              return (
                <button
                  key={scene.key}
                  type="button"
                  className={`task-type-preset-card${selected ? " active" : ""}`}
                  onClick={() => selectType("preset", scene)}
                  aria-pressed={selected}
                  title={scene.tagline}
                >
                  <span className="task-type-preset-icon"><Icon size={17} /></span>
                  <strong>{scene.name}</strong>
                  <small>{scene.tagline}</small>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className={`task-type-option task-type-custom${taskType === "custom" ? " active" : ""}`}
            onClick={() => selectType("custom")}
            aria-pressed={taskType === "custom"}
          >
            <span className="task-type-custom-icon"><PenLine size={18} /></span>
            <span className="task-type-option-copy">
              <strong>自定义任务</strong>
              <small>手工填写场景名称与要求，全新场景发布时自动加入标签字典</small>
            </span>
            <span className="task-type-option-check">{taskType === "custom" ? "✓" : ""}</span>
          </button>

          {taskType === "custom" && (
            <label className="form-label task-scene-field">
              <span>场景名称 <em>必填</em></span>
              <input
                value={sceneName}
                onChange={(event) => {
                  setSceneName(event.target.value);
                  activeSuggestionRef.current = false;
                }}
                onBlur={() => {
                  activeSuggestionRef.current = false;
                }}
                placeholder="例如：仓库库房"
                required
                maxLength={120}
              />
              <small className="field-help">可选择已有标签；新场景发布时自动加入字典</small>
              {sceneName.trim() && filteredSceneOptions.length > 0 && (
                <ul className="suggestion-list">
                  {filteredSceneOptions.slice(0, 8).map((name) => (
                    <li key={name}>
                      <button
                        type="button"
                        onClick={() => pickScene(name)}
                        onMouseDown={(event) => {
                          activeSuggestionRef.current = true;
                          event.preventDefault();
                        }}
                      >
                        {name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </label>
          )}
          {taskType === "generic" && (
            <p className="task-type-note">
              通用任务场景固定为「通用」：AI 质检不校验特定场景，重点判定任务真实性与完整度。
            </p>
          )}
          {taskType === "preset" && selectedPreset && (
            <p className="task-type-note">
              已选择预设场景「{selectedPreset.name}」，标题、说明与要求已按该场景模板填充，可继续调整。
            </p>
          )}
        </section>

        <section className="task-form-section">
          <div className="task-form-section-title">
            <span>2</span>
            <div><strong>基础信息</strong><small>用于任务大厅识别和归类</small></div>
          </div>
          <div className="task-form-grid">
            <label className="form-label">
              <span>任务标题 <em>必填</em></span>
              <input
                ref={firstInputRef}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：厨房做饭场景数据采集"
                required
                maxLength={120}
              />
              <small className="field-counter">{title.length}/120</small>
            </label>
            <div className="task-form-static-scene">
              <span>任务类型</span>
              <strong>
                {taskTypeLabel(taskType)}
                {taskType !== "custom" ? ` · ${sceneName || "通用"}` : ""}
              </strong>
            </div>
          </div>
        </section>

        <section className="task-form-section">
          <div className="task-form-section-title">
            <span>3</span>
            <div><strong>采集说明与要求</strong><small>这些内容会直接影响数采理解与 AI 质检</small></div>
          </div>
          <div className="task-form-grid">
            <label className="form-label">
              <span>面向数采人员的任务说明</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="说明采集目标、拍摄方式、完成标准和常见误区"
                rows={4}
                maxLength={20000}
              />
            </label>
            <label className="form-label">
              <span>原始任务要求 <em>必填</em></span>
              <textarea
                value={rawRequirements}
                onChange={(event) => setRawRequirements(event.target.value)}
                placeholder="建议分条填写，例如：\n1. 必须使用第一人称视角；\n2. 双手与主要操作对象全程可见；\n3. 不得出现人脸、门牌号等隐私信息。"
                rows={7}
                required
                maxLength={20000}
              />
              <small className="field-help">保存后可通过“规范化”整理成硬性要求与一般要求</small>
            </label>
          </div>
        </section>

        <section className="task-form-section task-form-price-section">
          <div className="task-form-section-title">
            <span>4</span>
            <div><strong>计费方式</strong><small>按有效时长 × 单价（元/小时）× 质量系数结算；预设场景已自动带出场景大类默认价，可修改</small></div>
          </div>
          <label className="form-label task-price-field">
            <span>每小时单价（元）</span>
            <div className="input-with-suffix">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max="10000"
                step="0.01"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                placeholder="例如：20"
              />
              <span>元 / 小时</span>
            </div>
          </label>
          {taskType === "preset" && selectedPreset && priceByCategory[selectedPreset.categoryKey] !== undefined && (
            <p className="task-type-note">
              已按「{selectedPreset.categoryKey === "family" ? "家庭" : selectedPreset.categoryKey === "office" ? "办公室" : selectedPreset.categoryKey === "factory" ? "工厂" : "通用"}」大类默认价 {priceByCategory[selectedPreset.categoryKey].toFixed(2)} 元/小时带出，可修改。
            </p>
          )}
        </section>

        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={close}>
            取消
          </button>
          <button type="submit" className="button button-primary" disabled={submitting}>
            {submitting ? "保存中…" : "保存"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
