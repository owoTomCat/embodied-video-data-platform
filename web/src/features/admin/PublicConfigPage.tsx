"use client";

import { Globe2, RefreshCw, Save } from "lucide-react";
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
  const [form, setForm] = useState(
    unavailablePublicSiteSnapshot.config,
  );

  useEffect(() => {
    let active = true;
    getPublicSiteSnapshot()
      .then((result) => {
        if (!active) return;
        setSnapshot(result);
        setForm(result.config);
        setMode("live");
      })
      .catch(() => {
        if (!active) return;
        setSnapshot(unavailablePublicSiteSnapshot);
        setForm(unavailablePublicSiteSnapshot.config);
        setMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const next = await publishPublicSiteSnapshot(form);
      setSnapshot(next);
      setForm(next.config);
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

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">公开脱敏汇总</p>
          <h1>公开数据配置</h1>
          <span>控制官网展示的指标、场景和商务联系入口</span>
        </div>
      </div>
      <div className="audit-summary">
        <Globe2 size={18} />
        <span>
          <strong>{modeLabel}</strong>
          <small>
            公开页面只展示汇总指标和场景占比，不暴露原始视频、成员、团队或对象存储地址。
          </small>
        </span>
      </div>
      <div className="public-config-grid">
        <form className="content-card profile-form" onSubmit={save}>
          <div className="card-heading">
            <div>
              <h2>首页指标</h2>
              <p>指标由已完成质检数据生成，保存时会重新生成快照</p>
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
          <label>
            <span>主推场景名称</span>
            <input
              value={form.primarySceneName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  primarySceneName: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>主推场景说明</span>
            <input
              value={form.primarySceneDescription}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  primarySceneDescription: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>商务联系文案</span>
            <textarea
              value={form.ctaCopy}
              rows={3}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  ctaCopy: event.target.value,
                }))
              }
            />
          </label>
          <button className="button button-primary" type="submit" disabled={saving || mode === "unavailable"}>
            {saving ? <RefreshCw size={16} /> : <Save size={16} />}
            {saving ? "正在生成快照" : "保存公开配置"}
          </button>
        </form>
        <aside className="content-card config-preview">
          <span>官网预览</span>
          <h2>让每一段视频，<br />成为可用的具身数据</h2>
          <div>
            <strong>{formatNumber(metrics.deliverableVideoCount)}</strong>
            <small>可交付视频</small>
          </div>
          <p>{form.ctaCopy}</p>
        </aside>
      </div>
      <section className="content-card table-card">
        <div className="card-heading">
          <div>
            <h2>公开场景占比</h2>
            <p>仅展示聚合后的场景名称、说明和占比</p>
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
