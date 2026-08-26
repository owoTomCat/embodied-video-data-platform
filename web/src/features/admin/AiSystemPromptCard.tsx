"use client";

import { Bot, CheckCircle2, Save } from "lucide-react";
import { useEffect, useState } from "react";

import {
  getAiQualityPrompt,
  updateAiQualityPrompt,
} from "../../ai-quality/client/aiQualityApi";
import type { AiQualityPrompt } from "../../ai-quality/contracts";

function createdAt(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function AiSystemPromptCard({
  onPromptChange,
}: {
  onPromptChange?(prompt: AiQualityPrompt): void;
}) {
  const [prompt, setPrompt] = useState<AiQualityPrompt>();
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    void getAiQualityPrompt()
      .then((loaded) => {
        if (!active) return;
        setPrompt(loaded);
        setDraft(loaded.systemPrompt);
        onPromptChange?.(loaded);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "加载失败");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onPromptChange, reloadKey]);

  async function save() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const updated = await updateAiQualityPrompt(draft);
      setPrompt(updated);
      setDraft(updated.systemPrompt);
      onPromptChange?.(updated);
      setMessage(`版本 ${updated.revision} 已发布，仅影响之后新开始的任务`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="content-card ai-prompt-card">
      <div className="card-heading">
        <div><h2>AI 系统提示词</h2><p>管理正式视频质检采用的判断规则</p></div>
        <Bot size={19} />
      </div>
      {loading ? (
        <div className="empty-state"><strong>正在加载提示词</strong></div>
      ) : prompt ? (
        <>
          <div className="ai-prompt-meta">
            <div><small>当前版本</small><strong>V{prompt.revision}</strong></div>
            <div><small>初检模型</small><strong>{prompt.initialModel}</strong></div>
            <div><small>条件复核</small><strong>{prompt.reviewModel}</strong></div>
            <div><small>内容指纹</small><strong>{prompt.contentSha256.slice(0, 12)}</strong></div>
          </div>
          <label className="ai-prompt-editor">
            <span>系统提示词正文</span>
            <textarea
              aria-label="AI 系统提示词"
              rows={18}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              spellCheck={false}
            />
          </label>
          <div className="ai-prompt-footer">
            <p>最近由 {prompt.createdByName} 修改于 {createdAt(prompt.createdAt)}。保存会创建新版本，正在执行和自动重试中的任务继续使用原快照。</p>
            <button
              className="button button-primary"
              disabled={saving || !draft.trim() || draft.trim() === prompt.systemPrompt}
              onClick={() => void save()}
            >
              {saving ? <CheckCircle2 size={16} /> : <Save size={16} />}
              {saving ? "保存中" : "发布新版本"}
            </button>
          </div>
        </>
      ) : null}
      {!loading && !prompt && (
        <div className="empty-state compact-empty">
          <strong>提示词加载失败</strong>
          <span>{error || "请检查 AI 质检服务后重试"}</span>
          <button
            className="table-action"
            type="button"
            onClick={() => {
              setLoading(true);
              setError("");
              setReloadKey((current) => current + 1);
            }}
          >
            重新加载
          </button>
        </div>
      )}
      {message && <p className="form-message success">{message}</p>}
      {error && <p className="form-message error">{error}</p>}
    </section>
  );
}
