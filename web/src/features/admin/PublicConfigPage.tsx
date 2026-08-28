"use client";

import { Globe2, RefreshCw, Save, Sparkles } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import {
  getPublicSiteSnapshot,
  publishPublicSiteSnapshot,
} from "../../public-site/client/publicSiteApi";
import type { PublicSiteSnapshot } from "../../public-site/contracts";
import { unavailablePublicSiteSnapshot } from "../../public-site/demoPublicSite";
import { useInteractions } from "../../interactions/InteractionContext";

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatHours(seconds: number): string {
  if (seconds > 0 && seconds < 3_600) {
    return `${Math.round(seconds / 60).toLocaleString("zh-CN")} 分钟`;
  }
  return `${Math.round(seconds / 3_600).toLocaleString("zh-CN")} 小时`;
}

export function PublicConfigPage() {
  const { notify } = useInteractions();
  const [snapshot, setSnapshot] = useState<PublicSiteSnapshot>(
    unavailablePublicSiteSnapshot,
  );
  const [mode, setMode] = useState<
    "loading" | "live" | "unavailable"
  >("loading");
  const [saving, setSaving] = useState(false);
  const [ctaCopy, setCtaCopy] = useState(
    unavailablePublicSiteSnapshot.config.ctaCopy,
  );

  useEffect(() => {
    let active = true;
    getPublicSiteSnapshot()
      .then((result) => {
        if (!active) return;
        setSnapshot(result);
        setCtaCopy(result.config.ctaCopy);
        setMode("live");
      })
      .catch(() => {
        if (!active) return;
        setSnapshot(unavailablePublicSiteSnapshot);
        setCtaCopy(unavailablePublicSiteSnapshot.config.ctaCopy);
        setMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!ctaCopy.trim()) {
      notify("error", "请填写商务联系文案");
      return;
    }
    setSaving(true);
    try {
      const next = await publishPublicSiteSnapshot({ ctaCopy: ctaCopy.trim() });
      setSnapshot(next);
      setCtaCopy(next.config.ctaCopy);
      setMode("live");
      notify("success", `公开配置已发布为 V${next.revision}`);
    } catch (error) {
      notify(
        "error",
        error instanceof Error ? error.message : "公开配置保存失败",
      );
    } finally {
      setSaving(false);
    }
  }

  const metrics = snapshot.metrics;
  const modeLabel =
    mode === "live"
      ? `后端脱敏快照 V${snapshot.revision}`
      : mode === "loading"
        ? "正在读取公开快照"
        : "公开快照服务不可用";
  const primaryScene = snapshot.sceneBreakdown[0];

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">公开脱敏汇总</p>
          <h1>公开数据配置</h1>
          <span>指标与场景占比直接同步后台数据，仅商务文案可配置</span>
        </div>
      </div>
      <div className="audit-summary">
        <Globe2 size={18} />
        <span>
          <strong>{modeLabel}</strong>
          <small>
            公开页面只展示汇总指标和场景占比，不暴露原始视频、成员、团队或对象存储地址。
            保存配置时由后台重新聚合生成快照。
          </small>
        </span>
      </div>
      <div className="public-config-grid">
        <form className="content-card profile-form" onSubmit={save}>
          <div className="card-heading">
            <div>
              <h2>首页指标</h2>
              <p>由后台按质检结果聚合生成，保存快照时自动刷新，无需手工维护</p>
            </div>
            <Globe2 size={18} />
          </div>
          <div className="form-grid">
            <label>
              <span>可交付视频</span>
              <input value={formatNumber(metrics.deliverableVideoCount)} readOnly />
            </label>
            <label>
              <span>有效数据时长</span>
              <input value={formatHours(metrics.effectiveDurationSeconds)} readOnly />
            </label>
            <label>
              <span>高频作业场景</span>
              <input value={formatNumber(metrics.sceneCount)} readOnly />
            </label>
            <label>
              <span>质量通过率</span>
              <input value={`${metrics.qualityPassRate.toFixed(1)}%`} readOnly />
            </label>
          </div>

          <div className="card-heading public-config-subheading">
            <div>
              <h2>主推场景</h2>
              <p>自动取后台最高频场景（与公开首页「高频场景」保持一致），无需填写</p>
            </div>
          </div>
          <div className="public-primary-scene">
            <label>
              <span>场景名称</span>
              <input
                value={snapshot.config.primarySceneName}
                readOnly
                aria-label="主推场景名称"
              />
            </label>
            <label>
              <span>场景说明</span>
              <input
                value={snapshot.config.primarySceneDescription}
                readOnly
                aria-label="主推场景说明"
              />
            </label>
            {primaryScene && (
              <p className="public-config-hint">
                当前最高频场景「{primaryScene.name}」占 {primaryScene.share.toFixed(primaryScene.share % 1 === 0 ? 0 : 1)}
                % · {formatNumber(primaryScene.videoCount)} 条可交付视频
              </p>
            )}
          </div>

          <div className="card-heading public-config-subheading">
            <div>
              <h2>商务联系文案</h2>
              <p>展示在公开首页底部的行动引导区（唯一可手工配置项）</p>
            </div>
          </div>
          <label>
            <span>商务联系文案</span>
            <textarea
              value={ctaCopy}
              rows={3}
              onChange={(event) => setCtaCopy(event.target.value)}
              maxLength={160}
              placeholder="例如：为你的具身智能项目准备下一批高质量数据"
            />
          </label>
          <button className="button button-primary" type="submit" disabled={saving || mode === "unavailable"}>
            {saving ? <RefreshCw size={16} /> : <Save size={16} />}
            {saving ? "正在生成快照" : "保存公开配置"}
          </button>
        </form>
        <aside className="content-card config-preview public-config-preview">
          <span className="config-preview-tag">官网预览 · 与公开首页同源</span>
          <div className="config-preview-hero">
            <div className="eyebrow"><Sparkles size={14} /> AI 驱动的数据生产流水线</div>
            <h2>让每一段视频，<br />成为可用的具身数据</h2>
            <div className="config-preview-scene">
              <small>高频场景</small>
              <strong>{primaryScene?.name ?? snapshot.config.primarySceneName}</strong>
              <span>{primaryScene?.description ?? snapshot.config.primarySceneDescription}</span>
            </div>
            <div className="config-preview-metrics">
              <div><strong>{formatNumber(metrics.deliverableVideoCount)}</strong><small>可交付视频</small></div>
              <div><strong>{formatHours(metrics.effectiveDurationSeconds)}</strong><small>有效数据时长</small></div>
              <div><strong>{metrics.qualityPassRate.toFixed(1)}%</strong><small>质量通过率</small></div>
            </div>
            <p className="config-preview-cta">{ctaCopy || "（请填写商务联系文案）"}</p>
          </div>
        </aside>
      </div>
      <section className="content-card table-card">
        <div className="card-heading">
          <div>
            <h2>公开场景占比</h2>
            <p>仅展示聚合后的场景名称、说明和占比（后台真实数据，保存快照时刷新）</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>场景</th>
                <th>说明</th>
                <th>可交付视频</th>
                <th>占比</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.sceneBreakdown.map((scene) => (
                <tr key={scene.name}>
                  <td><strong>{scene.name}</strong></td>
                  <td>{scene.description}</td>
                  <td>{formatNumber(scene.videoCount)} 条</td>
                  <td>{scene.share.toFixed(scene.share % 1 === 0 ? 0 : 1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
