"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Modal } from "../../components/Modal";
import { useIdentity } from "../../auth/client/IdentityContext";
import * as api from "../../wallet/client/walletApi";
import { shanghaiTime, withdrawalLabels, type WithdrawalDetail, type WithdrawalRecipient } from "../../wallet/contracts";

const eventLabels: Record<string, string> = {
  "withdrawal.submitted": "提交提现申请",
  "withdrawal.claimed": "领取打款任务",
  "withdrawal.assigned": "交接负责人",
  "withdrawal.exported": "导出收款信息",
  "withdrawal.recipient_revealed": "查看完整收款信息",
  "withdrawal.evidence_uploaded": "上传凭证",
  "withdrawal.evidence_downloaded": "读取凭证",
  "withdrawal.registered": "登记转账并提交复核",
  "withdrawal.returned": "复核退回调查",
  "withdrawal.investigating": "转入异常核实",
  "withdrawal.unpaid_evidence": "记录未付或退回依据",
  "withdrawal.paid": "确认付款完成",
  "withdrawal.rejected": "拒绝申请并释放预留",
  "withdrawal.failed": "核实未付或退回并释放预留",
};

export function WithdrawalDetailPanel({ id, onClose, onChanged, returnFocusRef }: { id: string; onClose(): void; onChanged(): void; returnFocusRef: RefObject<HTMLElement | null> }) {
  const { currentAccount } = useIdentity();
  const [detail, setDetail] = useState<WithdrawalDetail | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [recipient, setRecipient] = useState<WithdrawalRecipient | null>(null);
  const [reason, setReason] = useState("");
  const [assignee, setAssignee] = useState("");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [note, setNote] = useState("");
  const [proofIds, setProofIds] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [single, setSingle] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    api.getWithdrawal(id).then(value => { if (mounted.current) setDetail(value); }).catch(error => { if (mounted.current) setError(error instanceof Error ? error.message : "详情读取失败"); });
    return () => { mounted.current = false; };
  }, [id]);
  async function run(action: () => Promise<unknown>, mutation = true) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await action();
      if (!mounted.current) return;
      if (mutation) {
        setRecipient(null); setProofIds([]); setConfirmed(false); setSingle(false); setReason("");
        onChanged();
        setDetail(null);
        setDetail(await api.getWithdrawal(id));
        setMessage("操作已保存；请以最新状态和审计记录为准。");
      }
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof api.WalletApiError && error.status === 409) {
        setRecipient(null); setDetail(null); setProofIds([]); setConfirmed(false); setSingle(false); onChanged();
        try { setDetail(await api.getWithdrawal(id)); setError("申请已被其他操作更新。已重新打开最新详情，请重新核对，勿重复转账。"); }
        catch { setError("状态冲突，最新详情读取失败。请关闭后刷新重新打开，勿重复操作。"); }
      } else setError(error instanceof Error ? error.message : "操作失败，未确认成功");
    } finally { if (mounted.current) setBusy(false); }
  }
  const row = detail?.request;
  const mine = row?.assigneeId === currentAccount.id;
  const independent = !!row && row.assigneeId !== currentAccount.id && row.registeredById !== currentAccount.id && !detail?.registrations.some(item => item.registeredById === currentAccount.id);
  const reviewAllowed = independent || (!!detail?.singleConfirmationAllowed && single);
  const terminal = !!row && ["paid", "rejected", "failed"].includes(row.status);
  const canRegister = mine && (row?.status === "processing" || row?.status === "investigating");
  const canUpload = canRegister || (row?.status === "investigating" && independent);
  const canReveal = !!row && row.status !== "pending" && (row.status !== "processing" || mine);
  const transferTime = paidAt ? new Date(`${paidAt}+08:00`).getTime() : NaN;
  const validTime = !!row && Number.isFinite(transferTime) && transferTime >= new Date(row.createdAt).getTime();
  const mode = single && detail?.singleConfirmationAllowed ? "single" : "independent";
  async function registerTransfer() {
    if (!row || !validTime) return;
    if (transferTime > Date.now()) { setError("实际转账时间不能晚于当前时间。"); return; }
    await run(() => api.registerWithdrawal(id, { transferReference: reference.trim(), paidAt: new Date(transferTime).toISOString(), evidenceIds: proofIds, note: note.trim() || undefined, revision: row.revision }));
  }
  function close() { if (!busy) { setRecipient(null); onClose(); } }
  return <Modal open title="提现处理详情" onClose={close} returnFocusRef={returnFocusRef} className="payout-detail-modal">
    <div aria-busy={busy}>
      {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      {!row || !detail ? <p role="status">{error ? "详情不可用，请关闭重试。" : "正在读取详情…"}</p> : <>
        <h3>{row.id} · {withdrawalLabels[row.status]}</h3>
        <p>{row.ownerName ?? row.ownerId} / {row.teamName ?? "未分配团队"} · {row.amount.toFixed(2)} 元</p>
        <p>提交 {shanghaiTime(row.createdAt)}；经办人 {row.assigneeName ?? "未分配"}{row.assignedAt && `（${shanghaiTime(row.assignedAt)}）`}</p>
        <p>平台不发起支付，也不验证银行到账。登记和退回复核均不是再次付款指令；结果未知时资金继续预留。</p>
        <p>{row.reviewMode === "legacy" ? "历史人工确认记录，未经本复核流程" : row.reviewMode === "single" ? "单人确认，未经独立复核" : row.reviewMode === "independent" ? "已独立复核" : row.status === "failed" ? "已确认未付 / 退回" : row.status === "rejected" ? "申请已拒绝，无需付款复核" : "尚未完成付款复核"}{row.reviewedAt && ` · ${shanghaiTime(row.reviewedAt)}`}</p>
        <section><h3>收款快照</h3><p>{row.method === "bank" ? "银行账户" : "支付宝"} · {row.nameMasked} · {row.accountMasked}</p>
          <p>完整信息仅用于本申请核对；每次查看均记录审计，关闭详情即清除。</p>
          <button className="button button-secondary" disabled={busy || !canReveal || !!recipient} onClick={() => run(async () => { const value = await api.revealWithdrawalRecipient(id); if (mounted.current) setRecipient(value.recipient); }, false)}>授权查看完整收款信息（记录审计）</button>
          {!canReveal && <p>待领取申请须先领取；处理中仅当前经办人可查看。</p>}
          {recipient && <div><p>{recipient.name} · {recipient.account} · {recipient.bankName}</p><button className="button button-secondary" disabled={busy} onClick={() => run(async () => { await navigator.clipboard.writeText(recipient.account); setMessage("账号已复制，请核对本申请金额及收款人。"); }, false)}>复制收款账号</button><button className="button button-secondary" disabled={busy} onClick={() => setRecipient(null)}>隐藏完整信息</button></div>}
        </section>
        {!terminal && <fieldset disabled={busy} className="modal-form"><legend>处理操作</legend>
          {row.status === "pending" && <button className="button button-secondary" onClick={() => run(() => api.claimWithdrawals([id]))}>领取申请</button>}
          <label>原因（不要填写完整收款账号）<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} /></label>
            <label>交接给在职管理员<select value={assignee} onChange={event => setAssignee(event.target.value)}><option value="">选择经办人</option>{detail.admins.map(admin => <option key={admin.id} value={admin.id}>{admin.displayName}</option>)}</select></label>
            <button className="button button-secondary" disabled={!reason.trim() || !assignee || assignee === row.assigneeId} onClick={() => run(() => api.assignWithdrawal(id, { assigneeId: assignee, reason: reason.trim(), revision: row.revision }))}>确认交接（保留全部历史）</button>
            {row.status === "pending" && <button className="button button-secondary" disabled={!reason.trim()} onClick={() => run(() => api.rejectWithdrawal(id, reason.trim()))}>拒绝申请并释放预留</button>}
            {(row.status === "processing" || row.status === "review_pending") && <button className="button button-secondary" disabled={!reason.trim() || (row.status === "processing" && !mine)} onClick={() => run(() => api.investigateWithdrawal(id, { reason: reason.trim(), revision: row.revision }))}>结果未知，转入调查并保持预留</button>}
          {(row.status === "review_pending" || (row.status === "investigating" && detail.registrations.length > 0)) && <>
            {!independent && <p>不能独立复核自己登记或经办的申请。</p>}
            {detail.singleConfirmationAllowed && <label className="checkbox-field"><input type="checkbox" checked={single} onChange={event => setSingle(event.target.checked)} />当前仅一名在职管理员；我明确选择单人确认，未经独立复核</label>}
          </>}
          {row.status === "review_pending" && <><button className="button button-secondary" disabled={!reviewAllowed} onClick={() => run(() => api.reviewWithdrawal(id, { decision: "approve", mode, revision: row.revision }))}>复核通过并记为已付款</button><button className="button button-secondary" disabled={!reviewAllowed || !reason.trim()} onClick={() => run(() => api.reviewWithdrawal(id, { decision: "return", mode, reason: reason.trim(), revision: row.revision }))}>退回调查（不释放预留，不要求重付）</button></>}
          {canRegister && <><label>实际转账参考号<input value={reference} onChange={event => setReference(event.target.value)} maxLength={120} /></label><label>实际转账时间（上海 UTC+08:00）<input type="datetime-local" step="1" value={paidAt} onChange={event => setPaidAt(event.target.value)} /></label><label>登记备注<textarea value={note} onChange={event => setNote(event.target.value)} maxLength={500} /></label><p>只登记已发生的转账。时间须介于申请提交和当前时间之间；更正追加新记录，旧记录不可修改。</p></>}
          {canUpload && <label>上传凭证（JPEG / PNG / PDF，最多 5 MiB）<input type="file" accept="image/jpeg,image/png,application/pdf" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; if (file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "application/pdf"].includes(file.type)) { setError("请选择不超过 5 MiB 的 JPEG、PNG 或 PDF 文件。"); return; } void run(async () => { const evidence = await api.uploadWithdrawalEvidence(id, file); if (mounted.current) { setDetail(current => current ? { ...current, evidence: [...current.evidence, evidence] } : current); setProofIds(current => current.length < 5 ? [...current, evidence.id] : current); } }, false); }} /></label>}
          {(canRegister || row.status === "investigating") && <><p>为本次处理选择 1–5 份本申请凭证，可复用交接前的历史凭证。上传不等于登记成功。</p>{detail.evidence.map(item => <label className="checkbox-field" key={item.id}><input type="checkbox" checked={proofIds.includes(item.id)} disabled={!proofIds.includes(item.id) && proofIds.length >= 5} onChange={event => setProofIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} />{item.originalFileName}</label>)}</>}
          {canRegister && <button className="button button-secondary" disabled={!reference.trim() || !validTime || !proofIds.length} onClick={registerTransfer}>登记实际转账并提交复核</button>}
          {row.status === "investigating" && <><label className="checkbox-field"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />已核对证据，确认未转账或资金已实际退回，不是结果未知</label><button className="button button-secondary" disabled={!confirmed || !reason.trim() || !proofIds.length || (detail.registrations.length > 0 ? !reviewAllowed : !mine)} onClick={() => run(() => api.resolveUnpaidWithdrawal(id, { reason: reason.trim(), fundsNotTransferred: true, evidenceIds: proofIds, revision: row.revision, ...(detail.registrations.length ? { mode } : {}) }))}>确认未付 / 已退回并释放预留</button></>}
        </fieldset>}
        <section><h3>不可变转账登记</h3>{!detail.registrations.length && <p>尚无登记</p>}{detail.registrations.map(item => <article key={item.id}><h4>{item.transferReference}</h4><p>实际转账 {shanghaiTime(item.paidAt)} · 登记人 {item.registeredByName} · 登记 {shanghaiTime(item.createdAt)}</p><p>{item.note}</p><p>凭证：{item.evidenceIds.map(id => detail.evidence.find(proof => proof.id === id)?.originalFileName ?? id).join("、")}</p></article>)}</section>
        <section><h3>私有凭证</h3>{detail.evidence.map(item => <div key={item.id}><p>{item.originalFileName} · {item.sizeBytes} 字节 · {shanghaiTime(item.createdAt)}<small className="row-sub">SHA-256: {item.sha256}</small></p><button className="button button-secondary" disabled={busy} onClick={() => run(async () => { const blob = await api.downloadWithdrawalEvidence(id, item.id); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = item.originalFileName; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }, false)}>下载凭证 {item.originalFileName}（记录审计）</button></div>)}</section>
        <section><h3>审计时间线</h3><ol>{detail.timeline.map(item => <li key={item.id}>{shanghaiTime(item.createdAt)} · {item.actorName} · {eventLabels[item.action] ?? item.action}{item.reason && ` · ${item.reason}`}{item.assignment && <p>经办人：{item.assignment.fromName ?? item.assignment.fromId ?? "未分配"} → {item.assignment.toName ?? item.assignment.toId}</p>}{item.registrationId && <p>关联登记：{item.registrationId}</p>}{item.evidenceIds.length > 0 && <p>关联凭证：{item.evidenceIds.map(proofId => detail.evidence.find(proof => proof.id === proofId)?.originalFileName ?? proofId).join("、")}</p>}</li>)}</ol></section>
      </>}
      {busy && <p role="status">处理中，请勿重复操作…</p>}
    </div>
  </Modal>;
}
