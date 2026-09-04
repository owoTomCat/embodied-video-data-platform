"use client";

import { ChevronDown, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Scene } from "../../scene-system/contracts";

/**
 * 场景目标 ComboBox：输入即可对「当前计费大类下的场景」做模糊搜索。
 * - 选中已有场景 → onSelect(scene.id)
 * - 无匹配时回车，或点击「新增」，将当前输入作为新场景名 → onCreateNew(name)
 */
export function SceneTargetCombobox({
  scenes,
  sceneId,
  sceneName,
  onSelect,
  onCreateNew,
  onClear,
  ariaLabel,
}: {
  scenes: Scene[];
  sceneId?: string;
  sceneName?: string;
  onSelect(sceneId: string): void;
  onCreateNew(name: string): void;
  onClear(): void;
  ariaLabel: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => scenes.find((scene) => scene.id === sceneId) ?? null,
    [scenes, sceneId],
  );

  // 外部值变化时回填输入框
  useEffect(() => {
    if (selected) setQuery(selected.name);
    else if (sceneName) setQuery(sceneName);
    else setQuery("");
  }, [selected, sceneName]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => scenes.filter((scene) => scene.name.toLowerCase().includes(q)),
    [scenes, q],
  );
  const showNew =
    query.trim() !== "" &&
    !matches.some((s) => s.name.toLowerCase() === q);

  function commit(sceneIdValue: string) {
    onSelect(sceneIdValue);
    setOpen(false);
  }

  function createNew() {
    const name = query.trim();
    if (!name) return;
    onCreateNew(name);
    setOpen(false);
  }

  return (
    <div className="scene-combobox" ref={rootRef}>
      <div className="scene-combobox-input">
        <input
          aria-label={ariaLabel}
          value={query}
          placeholder="搜索或输入场景名…"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setHighlight((h) => Math.min(h + 1, matches.length + (showNew ? 0 : 0)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlight((h) => Math.max(0, h - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const optionCount = matches.length;
              if (showNew && highlight >= optionCount) {
                createNew();
              } else if (matches[highlight]) {
                commit(matches[highlight]!.id);
              } else if (showNew) {
                createNew();
              } else if (matches.length === 1) {
                commit(matches[0]!.id);
              }
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          onBlur={() => {
            // 延迟关闭，允许点击下拉项
            setTimeout(() => setOpen(false), 120);
          }}
        />
        {selected || sceneName ? (
          <button
            type="button"
            className="scene-combobox-clear"
            aria-label="清除选择"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onClear();
              setQuery("");
              setOpen(false);
            }}
          >
            <X size={13} />
          </button>
        ) : (
          <ChevronDown size={14} onClick={() => setOpen((v) => !v)} />
        )}
      </div>
      {open && (matches.length > 0 || showNew) && (
        <div className="scene-combobox-menu" role="listbox">
          {matches.map((scene, index) => (
            <button
              type="button"
              key={scene.id}
              role="option"
              aria-selected={scene.id === sceneId}
              className={`scene-combobox-option${index === highlight ? " highlight" : ""}`}
              onMouseEnter={() => setHighlight(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commit(scene.id)}
            >
              {scene.name}
            </button>
          ))}
          {showNew && (
            <button
              type="button"
              role="option"
              className={`scene-combobox-option scene-combobox-new${highlight === matches.length ? " highlight" : ""}`}
              onMouseEnter={() => setHighlight(matches.length)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={createNew}
            >
              <Plus size={13} />
              新增「{query.trim()}」
            </button>
          )}
        </div>
      )}
    </div>
  );
}
