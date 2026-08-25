"use client";

import { Archive, Boxes, Database, Download, HardDrive, Link2, PackageCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MetricCard } from "../../components/MetricCard";
import { SubmissionTable } from "../../components/SubmissionTable";
import { isActivePassedSubmission } from "../../domain/calculations";
import {
  createDeliveryArchiveTask,
  deliveryArchiveUrl,
  deliveryManifestUrl,
  deliveryZipArchiveUrl,
  getDeliveryArchiveDownloadLink,
  getDeliveryArchiveTask,
  getDeliveryDownloadLinks,
  listDeliveryArchiveTasks,
  listDeliveryPackages,
  previewDeliveryPackage,
} from "../../delivery/client/deliveryPackageApi";
import type {
  BackendDeliveryArchiveDownloadLink,
  BackendDeliveryArchiveFormat,
  BackendDeliveryArchiveTask,
  BackendDeliveryDownloadLinks,
  BackendDeliveryPackage,
  BackendDeliveryPreview,
} from "../../delivery/contracts";
import { useInteractions } from "../../interactions/InteractionContext";
import { DeliveryPackageModal } from "./DeliveryPackageModal";
import { loadAllSubmissions } from "../../submissions/client/submissionApi";
import { backendSubmissionToDomain } from "../../submissions/submissionMapper";
import type { Submission } from "../../domain/types";

function archiveStatusLabel(status: BackendDeliveryArchiveTask["status"]): string {
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "processing") return "准备中";
  return "排队中";
}

function formatBytes(value: string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function isDeliverableAsset(item: Submission): boolean {
  return item.settlementStatus === "settled" && isActivePassedSubmission(item);
}

function isCurrentMonth(timestamp: number): boolean {
  const current = new Date();
  const target = new Date(timestamp);
  return (
    current.getFullYear() === target.getFullYear() &&
    current.getMonth() === target.getMonth()
  );
}

function sumDeliveryBytes(
  packages: BackendDeliveryPackage[],
  preview: BackendDeliveryPreview | null,
): string {
  const packaged = packages.reduce(
    (total, item) => total + Number(item.totalSizeBytes),
    0,
  );
  const pending = Number(preview?.totalSizeBytes ?? "0");
  return String(Math.max(0, packaged + pending));
}

export function AssetsPage() {
  const { notify } = useInteractions();
  const [packageOpen, setPackageOpen] = useState(false);
  const [packages, setPackages] = useState<BackendDeliveryPackage[]>([]);
  const [preview, setPreview] = useState<BackendDeliveryPreview | null>(null);
  const [downloadLinks, setDownloadLinks] =
    useState<BackendDeliveryDownloadLinks | null>(null);
  const [archiveTasks, setArchiveTasks] = useState<
    Record<string, BackendDeliveryArchiveTask[]>
  >({});
  const [archiveDownloadLink, setArchiveDownloadLink] =
    useState<BackendDeliveryArchiveDownloadLink | null>(null);
  const [loadingLinksFor, setLoadingLinksFor] = useState<string | null>(null);
  const [preparingArchiveFor, setPreparingArchiveFor] = useState<string | null>(
    null,
  );
  const [loadingArchiveLinkFor, setLoadingArchiveLinkFor] = useState<
    string | null
  >(null);
  const [backendMode, setBackendMode] = useState<"loading" | "live" | "unavailable">(
    "loading",
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [assets, setAssets] = useState<Submission[]>([]);
  const totalPackageAssets = useMemo(
    () => packages.reduce((total, item) => total + item.assetCount, 0),
    [packages],
  );
  const monthlyPackageCount = useMemo(
    () => packages.filter((item) => isCurrentMonth(item.createdAt)).length,
    [packages],
  );
  const totalDeliveryBytes = useMemo(
    () => sumDeliveryBytes(packages, preview),
    [packages, preview],
  );
  const loadArchiveTasks = useCallback(
    async (nextPackages: BackendDeliveryPackage[]) => {
      const entries = await Promise.all(
        nextPackages.map(async (deliveryPackage) => [
          deliveryPackage.id,
          await listDeliveryArchiveTasks(deliveryPackage.id),
        ] as const),
      );
      setArchiveTasks(Object.fromEntries(entries));
    },
    [],
  );

  useEffect(() => {
    let active = true;
    Promise.all([listDeliveryPackages(), previewDeliveryPackage()])
      .then(([nextPackages, nextPreview]) => {
        if (!active) return;
        setPackages(nextPackages);
        setPreview(nextPreview);
        setBackendMode("live");
        void loadArchiveTasks(nextPackages).catch(() => undefined);
      })
      .catch(() => {
        if (!active) return;
        setPackages([]);
        setPreview(null);
        setBackendMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, [loadArchiveTasks]);

  useEffect(() => {
    let active = true;
    loadAllSubmissions({ status: "all" })
      .then((result) => {
        if (!active) return;
        setAssets(
          result
            .map(backendSubmissionToDomain)
            .filter(isDeliverableAsset),
        );
      })
      .catch(() => {
        if (!active) return;
        setAssets([]);
      });
    return () => {
      active = false;
    };
  }, []);

  function handleCreated(deliveryPackage: BackendDeliveryPackage) {
    setPackages((current) => [deliveryPackage, ...current]);
    setArchiveTasks((current) => ({ ...current, [deliveryPackage.id]: [] }));
    setPreview({ assetCount: 0, totalSizeBytes: "0" });
    setBackendMode("live");
  }

  async function handleLoadLinks(id: string) {
    setLoadingLinksFor(id);
    try {
      const links = await getDeliveryDownloadLinks(id);
      setDownloadLinks(links);
      notify("success", "下载链接已生成");
    } catch {
      notify("error", "下载链接生成失败，请稍后重试");
    } finally {
      setLoadingLinksFor(null);
    }
  }

  async function handlePrepareArchive(
    id: string,
    format: BackendDeliveryArchiveFormat,
  ) {
    const operationId = `${id}:${format}`;
    setPreparingArchiveFor(operationId);
    try {
      const task = await createDeliveryArchiveTask(id, format);
      setArchiveTasks((current) => ({
        ...current,
        [id]: [task, ...(current[id] ?? [])],
      }));
      notify("success", `${format.toUpperCase()} 归档已开始准备`);
      await pollArchiveTask(id, task.id);
    } catch {
      notify("error", "归档准备失败，请稍后重试");
    } finally {
      setPreparingArchiveFor(null);
    }
  }

  async function pollArchiveTask(id: string, taskId: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      const task = await getDeliveryArchiveTask(id, taskId);
      setArchiveTasks((current) => ({
        ...current,
        [id]: [task, ...(current[id] ?? []).filter((item) => item.id !== task.id)],
      }));
      if (task.status === "completed") {
        notify("success", `${task.format.toUpperCase()} 归档已准备好`);
        return;
      }
      if (task.status === "failed") {
        notify("error", task.failureMessage ?? "归档准备失败，请稍后重试");
        return;
      }
    }
  }

  async function handleLoadArchiveLink(task: BackendDeliveryArchiveTask) {
    setLoadingArchiveLinkFor(task.id);
    try {
      const link = await getDeliveryArchiveDownloadLink(task.packageId, task.id);
      setArchiveDownloadLink(link);
      notify("success", "归档下载链接已生成");
    } catch {
      notify("error", "归档下载链接生成失败，请稍后重试");
    } finally {
      setLoadingArchiveLinkFor(null);
    }
  }

  return (
    <div className="page-stack">
      <div className="page-heading"><div><p className="page-kicker">已锁定可交付数据</p><h1>数据资产</h1><span>仅包含质检通过且完成结算锁定的视频资产</span></div><button ref={triggerRef} className="button button-primary" onClick={() => setPackageOpen(true)}>创建交付包</button></div>
      <div className="metric-grid"><MetricCard label="待交付资产" value={String(preview?.assetCount ?? assets.length)} detail="已锁定且未入包" icon={Archive}/><MetricCard label="已入包资产" value={String(totalPackageAssets)} detail={`${packages.length} 个交付包`} icon={Database} tone="green"/><MetricCard label="本月交付包" value={String(monthlyPackageCount)} detail="可导出清单" icon={Boxes} tone="violet"/><MetricCard label="存储占用" value={formatBytes(totalDeliveryBytes)} detail="待交付与已入包合计" icon={HardDrive} tone="amber"/></div>
      <div className="audit-summary"><Boxes size={18}/><span><strong>{backendMode === "live" ? "交付包数据已同步" : backendMode === "loading" ? "正在读取交付包" : "交付包数据暂不可用"}</strong><small>{backendMode === "live" ? "创建交付包后可在线下载清单与资产链接，归档过程全程可追踪。" : backendMode === "loading" ? "页面会在接口返回后切换为真实数据。" : "数据服务暂不可用，请稍后重试。"}</small></span></div>
      <section className="content-card table-card"><div className="card-heading"><div><h2>交付包</h2><p>已持久化的资产包、下载清单、短期资产链接和归档准备状态</p></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>交付包</th><th>资产数</th><th>创建人</th><th>状态</th><th>归档任务</th><th/></tr></thead><tbody>{packages.map((deliveryPackage) => {
        const tasks = archiveTasks[deliveryPackage.id] ?? [];
        const latestTask = tasks[0];
        const zipTask = tasks.find((task) => task.format === "zip");
        const tarTask = tasks.find((task) => task.format === "tar");
        const zipReady = zipTask?.status === "completed";
        const tarReady = tarTask?.status === "completed";
        const zipBusy = Boolean(zipTask && (zipTask.status === "queued" || zipTask.status === "processing"));
        const tarBusy = Boolean(tarTask && (tarTask.status === "queued" || tarTask.status === "processing"));
        const preparingZip = preparingArchiveFor === `${deliveryPackage.id}:zip`;
        const preparingTar = preparingArchiveFor === `${deliveryPackage.id}:tar`;
        return (
          <tr key={deliveryPackage.id}>
            <td><strong>{deliveryPackage.name}</strong><br/><small>{deliveryPackage.id}</small></td>
            <td>{deliveryPackage.assetCount} 条</td>
            <td>{deliveryPackage.createdByName}</td>
            <td>已就绪</td>
            <td>{latestTask ? <span className="archive-progress"><strong>{latestTask.format.toUpperCase()} · {archiveStatusLabel(latestTask.status)}</strong><small>{latestTask.processedAssetCount}/{latestTask.assetCount} 条 · {latestTask.progressPercent}%</small><i><b style={{ width: `${latestTask.progressPercent}%` }} /></i>{latestTask.status === "failed" && latestTask.failureMessage ? <em>{latestTask.failureMessage}</em> : null}{latestTask.status === "completed" ? <button className="table-action" type="button" onClick={() => void handleLoadArchiveLink(latestTask)} disabled={loadingArchiveLinkFor === latestTask.id}><Download size={14}/>{loadingArchiveLinkFor === latestTask.id ? "生成中" : "归档链接"}</button> : null}</span> : "暂无归档任务"}</td>
            <td><div className="row-actions"><a className="table-action" href={deliveryManifestUrl(deliveryPackage.id)}><Download size={14}/>下载清单</a>{zipReady ? <a className="table-action" href={deliveryZipArchiveUrl(deliveryPackage.id)}><Archive size={14}/>下载 ZIP</a> : <button className="table-action" type="button" onClick={() => void handlePrepareArchive(deliveryPackage.id, "zip")} disabled={preparingZip || zipBusy} title={zipBusy ? "ZIP 归档正在准备中" : undefined}><PackageCheck size={14}/>{preparingZip || zipBusy ? "准备中" : "准备 ZIP"}</button>}{tarReady ? <a className="table-action" href={deliveryArchiveUrl(deliveryPackage.id)}><Archive size={14}/>下载 TAR</a> : <button className="table-action" type="button" onClick={() => void handlePrepareArchive(deliveryPackage.id, "tar")} disabled={preparingTar || tarBusy} title={tarBusy ? "TAR 归档正在准备中" : undefined}><PackageCheck size={14}/>{preparingTar || tarBusy ? "准备中" : "准备 TAR"}</button>}<button className="table-action" type="button" onClick={() => void handleLoadLinks(deliveryPackage.id)} disabled={loadingLinksFor === deliveryPackage.id}><Link2 size={14}/>{loadingLinksFor === deliveryPackage.id ? "生成中" : "下载链接"}</button></div></td>
          </tr>
        );
      })}</tbody></table>{packages.length === 0 && <div className="empty-state"><Archive size={26} /><strong>暂无交付包</strong><span>创建交付包后，已锁定资产会在这里汇总</span></div>}</div></section>
      {archiveDownloadLink ? (
        <section className="content-card table-card">
          <div className="card-heading"><div><h2>归档下载链接</h2><p>{archiveDownloadLink.task.fileName} · {new Date(archiveDownloadLink.expiresAt).toLocaleString("zh-CN", { hour12: false })} 前有效</p></div></div>
          <div className="table-scroll"><table className="data-table"><thead><tr><th>归档文件</th><th>格式</th><th>大小</th><th/></tr></thead><tbody><tr><td><strong>{archiveDownloadLink.task.fileName}</strong><br/><small>{archiveDownloadLink.task.archiveObjectKey}</small></td><td>{archiveDownloadLink.task.format.toUpperCase()}</td><td>{formatBytes(archiveDownloadLink.task.archiveSizeBytes ?? "0")}</td><td><a className="table-action" href={archiveDownloadLink.url} target="_blank" rel="noreferrer"><Download size={14}/>下载归档</a></td></tr></tbody></table></div>
        </section>
      ) : null}
      {downloadLinks ? (
        <section className="content-card table-card">
          <div className="card-heading"><div><h2>资产下载链接</h2><p>{downloadLinks.package.name} · {downloadLinks.links.length} 条{downloadLinks.links[0]?.expiresAt ? ` · ${new Date(downloadLinks.links[0].expiresAt).toLocaleString("zh-CN", { hour12: false })} 前有效` : ""}</p></div></div>
          <div className="table-scroll"><table className="data-table"><thead><tr><th>文件</th><th>提交编号</th><th>大小</th><th/></tr></thead><tbody>{downloadLinks.links.map((link) => <tr key={link.packageItemId}><td><strong>{link.fileName}</strong><br/><small>{link.objectKey}</small></td><td>{link.submissionId}</td><td>{formatBytes(link.sizeBytes)}</td><td><a className="table-action" href={link.url} target="_blank" rel="noreferrer"><Download size={14}/>下载视频</a></td></tr>)}</tbody></table></div>
        </section>
      ) : null}
      <section className="content-card table-card"><div className="card-heading"><div><h2>最近入库资产</h2><p>展示后端已锁定资产条件</p></div></div><SubmissionTable submissions={assets} showOwner /></section>
      <DeliveryPackageModal open={packageOpen} onClose={() => setPackageOpen(false)} returnFocusRef={triggerRef} preview={preview} onCreated={handleCreated} />
    </div>
  );
}
