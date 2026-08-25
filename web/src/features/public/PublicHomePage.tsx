"use client";

import { ArrowRight, Bot, CheckCircle2, Database, Fingerprint, Layers3, PlayCircle, ScanSearch, ShieldCheck, Sparkles, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { BrandMark } from "../../components/BrandMark";
import { getPublicSiteSnapshot } from "../../public-site/client/publicSiteApi";
import { unavailablePublicSiteSnapshot } from "../../public-site/demoPublicSite";
import type { PublicSiteSnapshot } from "../../public-site/contracts";

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatHours(seconds: number): string {
  if (seconds > 0 && seconds < 3_600) {
    return `${Math.round(seconds / 60).toLocaleString("zh-CN")} 分钟`;
  }
  const hours = Math.round(seconds / 3_600);
  return `${hours.toLocaleString("zh-CN")} 小时`;
}

function trendHeights(snapshot: PublicSiteSnapshot): number[] {
  if (snapshot.trend.length === 0) return [];
  const max = Math.max(...snapshot.trend.map((item) => item.value), 1);
  return snapshot.trend.map((item) => Math.max(18, Math.round((item.value / max) * 104)));
}

export function PublicHomePage({ navigate }: { navigate(path: string): void }) {
  const [snapshot, setSnapshot] = useState<PublicSiteSnapshot>(
    unavailablePublicSiteSnapshot,
  );
  const [mode, setMode] = useState<
    "loading" | "live" | "unavailable"
  >("loading");

  useEffect(() => {
    let active = true;
    getPublicSiteSnapshot()
      .then((result) => {
        if (!active) return;
        setSnapshot(result);
        setMode("live");
      })
      .catch(() => {
        if (!active) return;
        setSnapshot(unavailablePublicSiteSnapshot);
        setMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  const metrics = snapshot.metrics;
  const scenes =
    snapshot.sceneBreakdown.length > 0
      ? snapshot.sceneBreakdown
      : [{ name: "暂无数据", description: "公开快照暂不可用", videoCount: 0, share: 0 }];
  const trend = useMemo(() => trendHeights(snapshot), [snapshot]);
  const primaryScene =
    scenes[0] ?? { name: "暂无数据", description: "公开快照暂不可用", videoCount: 0, share: 0 };

  function scrollToProcess() {
    document
      .getElementById("process")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="public-site">
      <header className="public-nav">
        <BrandMark />
        <nav>
          <a href="#capabilities">数据能力</a>
          <a href="#process">生产流程</a>
          <a href="#quality">质量保障</a>
        </nav>
        <button className="button button-ghost" onClick={() => navigate("/login")}>
          登录工作台 <ArrowRight size={16} />
        </button>
      </header>
      <main>
        <section className="hero-section">
          <div className="hero-copy">
            <div className="eyebrow"><Sparkles size={15} /> AI 驱动的数据生产流水线</div>
            <h1>让每一段视频，<br /><span>成为可用的具身数据</span></h1>
            <p>从开放采集、AI 内容理解到自动质检与资产入库，用一条可追溯的数据流水线，为具身智能持续供给高质量视频数据。</p>
            <div className="hero-actions">
              <button className="button button-primary" onClick={() => navigate("/login")}>进入平台 <ArrowRight size={17} /></button>
              <button className="button button-secondary" onClick={scrollToProcess}><PlayCircle size={18} /> 了解生产流程</button>
            </div>
            <div className="hero-trust">
              <span><CheckCircle2 size={16} /> 全流程可追溯</span>
              <span><CheckCircle2 size={16} /> AI 质量评估</span>
              <span><CheckCircle2 size={16} /> 数据权限隔离</span>
            </div>
          </div>
          <div className="hero-visual" aria-label="数据生产概览">
            <div className="visual-glow" />
            <div className="hero-dashboard-card">
              <div className="mini-card-head"><span>数据生产公开概览</span><em>{mode === "live" ? "脱敏快照" : mode === "loading" ? "读取中" : "暂不可用"}</em></div>
              <div className="mini-metrics">
                <div><small>已验收视频</small><strong>{formatNumber(metrics.deliverableVideoCount)}</strong><span>{snapshot.snapshotDate}</span></div>
                <div><small>有效时长</small><strong>{formatHours(metrics.effectiveDurationSeconds)}</strong><span>累计数据</span></div>
              </div>
              <div className="mini-chart">
                {trend.map((height, index) => <i key={`${index}-${height}`} style={{ height }} />)}
              </div>
              <div className="mini-flow">
                {["上传完成", "AI 标注", "质量通过", "资产入库"].map((item, index) => <div key={item}><span>{index + 1}</span><small>{item}</small></div>)}
              </div>
            </div>
            <div className="floating-card floating-card-quality"><span>{metrics.qualityPassRate.toFixed(1)}%</span><small>质量通过率</small></div>
            <div className="floating-card floating-card-scene"><strong>高频场景</strong><span>{primaryScene.name}</span><span>{primaryScene.description}</span></div>
          </div>
        </section>
        <section className="public-metrics" id="capabilities">
          <div><strong>{formatNumber(metrics.deliverableVideoCount)}</strong><span>可交付视频</span></div>
          <div><strong>{formatHours(metrics.effectiveDurationSeconds)}</strong><span>有效数据时长</span></div>
          <div><strong>{formatNumber(metrics.sceneCount)}</strong><span>高频作业场景</span></div>
          <div><strong>{metrics.qualityPassRate.toFixed(1)}%</strong><span>质量通过率</span></div>
        </section>
        <section className="public-content-section public-scenes">
          <div className="public-section-heading"><span>DATA CAPABILITIES</span><h2>覆盖真实世界中的高价值操作场景</h2><p>持续补充操作密度高、对象状态变化明显、可用于具身模型训练与评测的视频数据。</p></div>
          <div className="scene-showcase"><article className="scene-primary"><div><small>高频场景</small><strong>{snapshot.config.primarySceneName}</strong><span>{snapshot.config.primarySceneDescription}</span></div></article><div className="scene-list">{scenes.slice(0, 4).map((scene) => <div key={scene.name}><strong>{scene.name}</strong><span>{scene.description}</span><em>{scene.share.toFixed(scene.share % 1 === 0 ? 0 : 1)}%</em></div>)}</div></div>
        </section>
        <section className="public-content-section public-process" id="process">
          <div className="public-section-heading"><span>PRODUCTION PIPELINE</span><h2>从原始视频到可交付资产的标准流水线</h2><p>每个环节保留状态、版本和人工操作记录，形成可解释、可复核的数据闭环。</p></div>
          <div className="process-grid">{[
            [Upload, "01", "开放采集", "多角色团队协作采集，文件与成员、团队自动绑定"],
            [ScanSearch, "02", "媒体解析", "抽取时长、分辨率与画面特征，建立处理任务"],
            [Bot, "03", "AI 内容理解", "识别场景、动作、对象、工具与质量问题区间"],
            [ShieldCheck, "04", "双层质检", "AI 初筛结合平台人工复核，保留原始结论"],
            [Database, "05", "积分锁定与入库", "锁定有效时长和积分，生成可交付数据资产"],
          ].map(([Icon, step, title, copy]) => { const ProcessIcon = Icon as typeof Upload; return <article key={String(step)}><span>{String(step)}</span><i><ProcessIcon size={22} /></i><h3>{String(title)}</h3><p>{String(copy)}</p></article>; })}</div>
        </section>
        <section className="public-content-section public-quality" id="quality">
          <div className="quality-copy"><span>QUALITY & SECURITY</span><h2>质量结论有依据，数据流转有边界</h2><p>评分规则、无效区间和人工调整全部可追踪；不同角色的数据范围严格隔离，公开页面只展示脱敏汇总。</p><div><span><Fingerprint size={18} /><em><strong>全流程审计</strong><small>每次调整均保留人员、时间、原因和前后结果</small></em></span><span><Layers3 size={18} /><em><strong>版本化规则</strong><small>模型、标签、积分和质检阈值均可按版本管理</small></em></span></div></div><div className="quality-panel"><header><span>质量评估样例</span><em>已通过</em></header><strong>88<small>/ 100</small></strong><div className="quality-radar">{["画面稳定", "主体完整", "动作有效", "隐私安全"].map((item, index) => <div key={item}><span>{item}</span><i><b style={{ width: `${[91, 86, 92, 100][index]}%` }} /></i><em>{[91, 86, 92, 100][index]}</em></div>)}</div></div>
        </section>
        <section className="public-cta"><div><span>{snapshot.config.ctaCopy}</span><h2>从真实任务出发，建立可持续的数据供给</h2></div><button className="button button-primary" onClick={() => navigate("/login")}>体验完整平台 <ArrowRight size={17} /></button></section>
      </main>
      <footer className="public-footer"><BrandMark /><span>具身数据管理与 AI 质检平台</span></footer>
    </div>
  );
}
