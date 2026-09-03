"use client";

import {
  Boxes,
  Map,
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
  UpdateTaskInput,
} from "../../tasks/contracts";

const GENERIC_SCENE_NAME = "通用";

function taskTypeLabel(type: CollectionTaskType): string {
  if (type === "generic") return "通用任务";
  if (type === "scene_type") return "场景型任务";
  if (type === "preset") return "场景库场景";
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
  const [targetMinutes, setTargetMinutes] = useState(
    task && task.targetDurationSeconds != null
      ? String(task.targetDurationSeconds / 60)
      : "",
  );
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
    Promise.all([
      listTaskTypeCatalog(),
      getLabelSet(),
      listSceneCategoryPricing(),
    ])
      .then(([catalog, labelSet, categories]) => {
        if (!active) return;
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

  /** 选中场景库场景：场景名取场景库名称，单价带出该场景类别的定价（元/小时） */
  function applyTemplate(
    kind: "generic",
    template?: { defaultTitle: string; description: string; requirements: string[] },
    priceMap?: Record<string, number>,
  ) {
    const source = template ?? genericTemplate;
    if (!source) return;
    setTitle(source.defaultTitle);
    setDescription(source.description);
    setRawRequirements(source.requirements.join("\n"));
    setSceneName(GENERIC_SCENE_NAME);
    // 通用任务按「通用」大类默认价带出
    const defaultPrice = (priceMap ?? priceByCategory).generic;
    if (defaultPrice !== undefined && defaultPrice > 0) {
      setPrice(String(defaultPrice));
    }
  }

  function selectType(next: CollectionTaskType) {
    if (mode === "edit" && next === taskType) return;
    setTaskType(next);
    setError("");
    if (next === "generic") {
      applyTemplate("generic");
    } else if (next === "custom" || next === "scene_type") {
      // 自定义/场景型：清空自动带出的场景名与默认价，由管理员填写场景名（场景型=二级场景）与各自参数
      if (sceneName === GENERIC_SCENE_NAME) {
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
    const parsedTargetMinutes = targetMinutes.trim() === "" ? null : Number(targetMinutes);
    const fields = {
      title: title.trim(),
      description: description.trim(),
      sceneName: trimmedScene,
      taskType,
      sceneLibraryId: null,
      ...(taskType === "scene_type" && parsedTargetMinutes !== null
        ? { targetDurationSeconds: Math.max(1, Math.round(parsedTargetMinutes * 60)) }
        : {}),
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
          先选择任务类型（通用任务 / 场景型任务 / 场景库场景 / 自定义），再确认标题、说明与要求；保存后可进行 AI
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

          <button
            type="button"
            className={`task-type-option task-type-scene${taskType === "scene_type" ? " active" : ""}`}
            onClick={() => selectType("scene_type")}
            aria-pressed={taskType === "scene_type"}
          >
            <span className="task-type-scene-icon"><Map size={18} /></span>
            <span className="task-type-option-copy">
              <strong>场景型任务</strong>
              <small>平台按二级场景补量：设置目标时长，用于场景数据存量均衡</small>
            </span>
            <span className="task-type-option-check">{taskType === "scene_type" ? "✓" : ""}</span>
          </button>

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

          {(taskType === "custom" || taskType === "scene_type") && (
            <label className="form-label task-scene-field">
              <span>{taskType === "scene_type" ? "二级场景名称" : "场景名称"} <em>必填</em></span>
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
              <small className="field-help">{taskType === "scene_type" ? "填写所属二级场景（如 家庭卧室 / 家庭厨房），用于场景存量归口" : "可选择已有标签；新场景发布时自动加入字典"}</small>
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
            <div><strong>计费方式</strong><small>按有效时长 × 单价（元/小时）× 质量系数结算；场景库场景已自动带出该场景类别的默认价，可修改</small></div>
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
          {taskType === "scene_type" && (
            <label className="form-label task-price-field">
              <span>目标时长（分钟）</span>
              <div className="input-with-suffix">
                <input
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="1"
                  value={targetMinutes}
                  onChange={(event) => setTargetMinutes(event.target.value)}
                  placeholder="例如：120"
                />
                <span>分钟</span>
              </div>
              <small className="field-help">该场景型任务计划补充的有效时长；用于场景存量均衡看板的缺口计算</small>
            </label>
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
