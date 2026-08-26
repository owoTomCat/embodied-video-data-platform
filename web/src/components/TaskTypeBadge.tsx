import type { CollectionTaskType } from "../tasks/contracts";

const typeTone: Record<CollectionTaskType, "info" | "success" | "neutral"> = {
  generic: "info",
  preset: "success",
  custom: "neutral",
};

const typeLabel: Record<CollectionTaskType, string> = {
  generic: "通用",
  preset: "预设",
  custom: "自定义",
};

/** 任务类型徽标：通用=蓝 / 预设=绿 / 自定义=中性 */
export function TaskTypeBadge({
  type,
  label,
  showText = false,
}: {
  type: CollectionTaskType;
  /** 自定义展示文案（默认用类型短标签） */
  label?: string;
  showText?: boolean;
}) {
  const tone = typeTone[type] ?? "neutral";
  const text = label ?? typeLabel[type] ?? "自定义";
  return (
    <span className={`task-type-badge task-type-badge-${tone}`}>
      {text}
      {showText ? ` · ${typeLabel[type]}` : null}
    </span>
  );
}

export { typeLabel as taskTypeLabel };
