import { describe, expect, it } from "vitest";

import { renderQualityLabPage } from "../src/quality-lab/page.js";

describe("quality lab page", () => {
  it("emits syntactically valid browser scripts for both modes", () => {
    for (const mode of ["quality", "fused"] as const) {
      const html = renderQualityLabPage(mode);
      const script = html.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
      expect(script).toBeTruthy();
      expect(() => Function(script ?? "")).not.toThrow();
    }
  });

  it("contains only the local upload queue and result workflow", () => {
    const html = renderQualityLabPage();

    expect(html).toContain('type="file"');
    expect(html).toContain("multiple");
    expect(html).toContain('accept="video/mp4,video/quicktime,.mp4,.mov"');
    expect(html).toContain('id="drop-zone"');
    expect(html).toContain('id="queue-list"');
    expect(html).toContain('id="results-list"');
    expect(html).toContain("下载整批 JSON");
    expect(html).toContain('fetch("/api/jobs")');
    expect(html).toContain("任务 ID");
    expect(html).toContain("调用诊断");
    expect(html).toContain("删除记录");
  });

  it("keeps the API key server-side and omits the obsolete pass/fail copy", () => {
    const html = renderQualityLabPage();

    expect(html).not.toContain("QWEN_API_KEY");
    expect(html).not.toMatch(/API\s*Key\s*<input/iu);
    expect(html).not.toContain("60 分通过");
    expect(html).not.toContain("质量不通过");
  });

  it("runs two browser jobs at a time and renders user values with textContent", () => {
    const html = renderQualityLabPage();

    expect(html).toContain("while(state.running<2)");
    expect(html).toContain("state.running+=1");
    expect(html).toContain("void processEntry(entry)");
    expect(html).toContain("state.running-=1");
    expect(html).toContain("最多双并发");
    expect(html).toContain("textContent");
    expect(html).not.toContain("innerHTML");
  });

  it("rehydrates 30-day server history and keeps task IDs in exports", () => {
    const html = renderQualityLabPage();

    expect(html).toContain("async function loadHistory");
    expect(html).toContain("jobId:job.id");
    expect(html).toContain("taskId:entry.jobId");
    expect(html).toContain("diagnostics:entry.diagnostics");
    expect(html).toContain("async function watchHistory");
    expect(html).toMatch(/void\s+watchHistory\(\)/u);
  });

  it("renders technical result enums with Chinese labels", () => {
    const html = renderQualityLabPage();

    expect(html).toContain('scored:"已评分"');
    expect(html).toContain('hard_reject:"硬性否决"');
    expect(html).toContain('BROKEN_UNPLAYABLE:"视频损坏或无法播放"');
    expect(html).toContain('critical:"严重"');
    expect(html).toContain("evaluationStatusLabel(result.evaluationStatus)");
    expect(html).toContain("reasonLabel(issue.reason_code)");
    expect(html).toContain("severityLabel(issue.severity)");
  });

  it("uses model-independent stage labels and keeps old history readable", () => {
    const html = renderQualityLabPage();

    expect(html).toContain('initial_review:"初审"');
    expect(html).toContain('secondary_review:"复核"');
    expect(html).toContain('flash_review:"初审（历史）"');
    expect(html).toContain('plus_review:"复核（历史）"');
    expect(html).toContain('"initial_review","secondary_review"');
  });

  it("selects history cards, shows their total score, and renders one detail", () => {
    const html = renderQualityLabPage();

    expect(html).toContain("selectedId");
    expect(html).toContain("selectEntry(entry)");
    expect(html).toContain('node("div","queue-score"');
    expect(html).toContain("entry.result.finalScore");
    expect(html).toContain("const selected=selectedEntry()");
    expect(html).not.toContain("for(const entry of completed)");
  });

  it("loads and publishes the system prompt from the page", () => {
    const html = renderQualityLabPage();

    expect(html).toContain('id="prompt-editor"');
    expect(html).toContain('id="save-prompt"');
    expect(html).toContain('fetch("/api/prompt")');
    expect(html).toContain('fetch("/api/prompt",{method:"PUT"');
    expect(html).toContain("只影响保存后新开始的任务");
  });

  it("shows each task upload time in the history card and detail", () => {
    const html = renderQualityLabPage();

    expect(html).toContain("function formatDateTime(value)");
    expect(html).toContain('"queue-upload-time","上传时间 · "+formatDateTime(entry.createdAt)');
    expect(html).toContain('"result-upload-time","上传时间 · "+formatDateTime(entry.createdAt)');
  });

  it("keeps the 4010 baseline page separate from the fused experiment", () => {
    const html = renderQualityLabPage("quality");

    expect(html).toContain("原业务 AI 质检实验页");
    expect(html).toContain("4010 · 原业务质检");
    expect(html).toContain('const labMode = "quality"');
    expect(html).not.toContain('id="annotation-meta"');
  });

  it("renders structured candidate annotations on the 4011 fused page", () => {
    const html = renderQualityLabPage("fused");

    expect(html).toContain("融合 AI 标注实验页");
    expect(html).toContain("4011 · 融合标注");
    expect(html).toContain('const labMode = "fused"');
    expect(html).toContain('id="annotation-meta"');
    expect(html).toContain('id="annotation-prompt-editor"');
    expect(html).toContain("链路 1 · 原业务质检 Prompt");
    expect(html).toContain("链路 2 · 现有融合标注 Prompt");
    expect(html).toContain('fetch("/api/annotation-prompt")');
    expect(html).toContain("function renderAnnotation(card,result)");
    expect(html).toContain("result.candidateAnnotation");
    expect(html).toContain("融合结构化标注");
    expect(html).toContain("候选新标签");
    expect(html).toContain("fused-annotation-history.json");
  });
});
