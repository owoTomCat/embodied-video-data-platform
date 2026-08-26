import { describe, expect, it } from "vitest";

import {
  GENERIC_TASK_TEMPLATE,
  PRESET_SCENES,
  TASK_TYPE_LABELS,
  findPresetSceneByName,
  presetSceneSummaries,
} from "../src/tasks/preset-scenes.js";

describe("preset-scenes catalog", () => {
  it("exposes exactly the agreed five preset scenes", () => {
    expect(PRESET_SCENES.map((scene) => scene.name)).toEqual([
      "家庭-厨房",
      "家庭-客厅",
      "家庭-卧室",
      "办公室",
      "工厂",
    ]);
  });

  it("keeps scene keys unique and stable", () => {
    const keys = PRESET_SCENES.map((scene) => scene.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(PRESET_SCENES[0]!.key).toBe("family-kitchen");
  });

  it("fills every scene with description, requirements and QC notes", () => {
    for (const scene of PRESET_SCENES) {
      expect(scene.tagline.trim().length).toBeGreaterThan(4);
      expect(scene.defaultTitle.trim().length).toBeGreaterThan(4);
      expect(scene.description.trim().length).toBeGreaterThan(50);
      expect(scene.requirements.length).toBeGreaterThanOrEqual(4);
      for (const requirement of scene.requirements) {
        expect(requirement.trim().length).toBeGreaterThan(10);
      }
      expect(scene.qualityNotes.length).toBeGreaterThanOrEqual(2);
      for (const note of scene.qualityNotes) {
        expect(note.trim().length).toBeGreaterThan(10);
      }
    }
  });

  it("finds scenes by name and returns a serializable summary", () => {
    const kitchen = findPresetSceneByName("家庭-厨房");
    expect(kitchen?.key).toBe("family-kitchen");
    const summaries = presetSceneSummaries();
    expect(summaries).toHaveLength(PRESET_SCENES.length);
    expect(summaries[0]).toMatchObject({
      key: "family-kitchen",
      name: "家庭-厨房",
    });
  });

  it("provides a generic task template that is not bound to a scene", () => {
    expect(GENERIC_TASK_TEMPLATE.sceneName).toBe("通用");
    expect(GENERIC_TASK_TEMPLATE.defaultTitle).toContain("通用任务");
    expect(GENERIC_TASK_TEMPLATE.description.length).toBeGreaterThan(50);
    expect(GENERIC_TASK_TEMPLATE.requirements.length).toBeGreaterThanOrEqual(4);
  });

  it("maps every task type to a Chinese label", () => {
    expect(TASK_TYPE_LABELS.generic).toBe("通用任务");
    expect(TASK_TYPE_LABELS.preset).toBe("预设场景");
    expect(TASK_TYPE_LABELS.custom).toBe("自定义");
  });
});
