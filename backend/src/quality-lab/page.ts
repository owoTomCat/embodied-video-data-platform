export function renderQualityLabPage(): string {
  return String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AI 视频质检实验页</title>
  <style>
    :root { color-scheme:light; --ink:#162033; --muted:#748197; --line:#e4eaf2; --blue:#3868f5; --navy:#0d1729; --green:#16885d; --amber:#b77716; --red:#c84f4a; --canvas:#f4f7fb; }
    * { box-sizing:border-box; }
    body { margin:0; color:var(--ink); background:var(--canvas); font-family:Inter,"PingFang SC","Microsoft YaHei",system-ui,sans-serif; }
    button,input { font:inherit; } button { cursor:pointer; }
    .shell { width:min(1180px,calc(100% - 36px)); margin:0 auto; padding:32px 0 64px; }
    .hero { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; padding:30px; color:#fff; background:radial-gradient(circle at 80% 10%,#244b9c 0,transparent 35%),linear-gradient(135deg,#0d1729,#152847); border-radius:22px; box-shadow:0 22px 60px rgb(16 35 73 / 18%); }
    .eyebrow { color:#81a6ff; font-size:12px; font-weight:750; letter-spacing:.08em; }
    h1 { margin:10px 0 8px; font-size:clamp(28px,4vw,43px); letter-spacing:-.04em; }
    .hero p { max-width:700px; margin:0; color:#a8b6cb; font-size:13px; line-height:1.8; }
    .health { display:flex; min-width:max-content; align-items:center; gap:9px; padding:10px 13px; color:#c4d2e7; background:rgb(255 255 255 / 7%); border:1px solid rgb(255 255 255 / 12%); border-radius:999px; font-size:11px; }
    .health i { width:8px; height:8px; background:#e3a342; border-radius:50%; box-shadow:0 0 0 5px rgb(227 163 66 / 12%); }
    .health.ready i { background:#58d29a; box-shadow:0 0 0 5px rgb(88 210 154 / 12%); }
    .grid { display:grid; margin-top:20px; grid-template-columns:minmax(300px,.78fr) minmax(0,1.22fr); gap:18px; align-items:start; }
    .panel { padding:22px; background:#fff; border:1px solid var(--line); border-radius:17px; box-shadow:0 10px 35px rgb(20 44 84 / 5%); }
    .panel h2 { margin:0; font-size:16px; }
    .panel-head { display:flex; align-items:center; justify-content:space-between; gap:16px; }
    .panel-head p { margin:6px 0 0; color:var(--muted); font-size:11px; }
    .drop-zone { display:grid; min-height:190px; margin-top:18px; padding:24px; place-items:center; text-align:center; background:#f7f9fd; border:1.5px dashed #bdcae0; border-radius:15px; transition:.16s ease; }
    .drop-zone.dragging { background:#eef3ff; border-color:var(--blue); transform:translateY(-1px); }
    .drop-zone strong { display:block; font-size:14px; }
    .drop-zone span { display:block; margin-top:8px; color:var(--muted); font-size:11px; line-height:1.6; }
    .button { display:inline-flex; min-height:40px; margin-top:16px; padding:0 16px; align-items:center; justify-content:center; color:#fff; background:var(--blue); border:0; border-radius:10px; font-size:12px; font-weight:700; }
    .button:disabled { cursor:not-allowed; opacity:.45; }
    .button.secondary { margin:0; color:#3159c4; background:#edf2ff; }
    .privacy { margin:14px 0 0; color:#8995a7; font-size:9px; line-height:1.7; }
    .queue,.results { display:grid; margin-top:17px; gap:9px; }
    .results { gap:14px; }
    .queue-empty,.result-empty { padding:22px; color:#8b96a8; text-align:center; background:#fafbfc; border-radius:11px; font-size:11px; }
    .queue-item { display:grid; padding:13px; background:#fafbfe; border:1px solid #edf0f5; border-radius:11px; grid-template-columns:minmax(0,1fr) auto; gap:7px 12px; }
    .queue-item strong { display:block; overflow:hidden; font-size:11px; text-overflow:ellipsis; white-space:nowrap; }
    .queue-meta { display:flex; align-items:center; gap:8px; color:var(--muted); font-size:9px; }
    .task-id { margin-top:4px; color:#3159c4; font:9px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; overflow-wrap:anywhere; }
    .status { display:inline-flex; padding:4px 7px; border-radius:999px; font-size:9px; font-weight:700; }
    .status.active { color:#315fd2; background:#eaf0ff; } .status.ok { color:var(--green); background:#e7f7ef; } .status.warn { color:var(--amber); background:#fff3df; } .status.bad { color:var(--red); background:#fdeaea; } .status.idle { color:#68758a; background:#eef1f5; }
    .mini-button { grid-row:1 / 3; grid-column:2; align-self:center; padding:6px 8px; color:#7b8799; background:#fff; border:1px solid var(--line); border-radius:8px; font-size:9px; }
    .result-card { padding:19px; border:1px solid var(--line); border-radius:14px; }
    .result-title { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; }
    .result-title h3 { max-width:560px; margin:0; overflow:hidden; font-size:13px; text-overflow:ellipsis; white-space:nowrap; }
    .result-title p { margin:6px 0 0; color:var(--muted); font-size:10px; }
    .score { color:var(--blue); font-size:31px; font-weight:800; letter-spacing:-.05em; }
    .score small { color:#97a1b1; font-size:11px; font-weight:600; }
    .summary-grid { display:grid; margin-top:15px; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
    .summary-grid div { padding:10px; background:#f7f9fc; border-radius:9px; }
    .summary-grid span { display:block; color:var(--muted); font-size:8px; }
    .summary-grid strong { display:block; margin-top:5px; font-size:11px; }
    .dimensions { display:grid; margin-top:13px; gap:7px; }
    .dimension { display:grid; grid-template-columns:150px 1fr 34px; align-items:center; gap:9px; color:#617087; font-size:9px; }
    .bar { height:6px; overflow:hidden; background:#edf0f5; border-radius:999px; }
    .bar i { display:block; height:100%; background:linear-gradient(90deg,#3d6cf3,#7e62e7); border-radius:inherit; }
    .dimension-cards { display:grid; margin-top:16px; gap:10px; }
    .dimension-card { padding:14px; background:#fafbfe; border:1px solid #e8edf4; border-radius:11px; }
    .dimension-head { display:flex; align-items:center; justify-content:space-between; gap:14px; }
    .dimension-head strong { font-size:11px; }
    .dimension-head span { color:#52637b; font-size:11px; font-weight:750; }
    .dimension-score { display:grid; width:min(280px,52%); grid-template-columns:minmax(68px,1fr) auto; align-items:center; gap:9px; }
    .dimension-score-track { height:6px; overflow:hidden; background:#e8edf5; border-radius:999px; }
    .dimension-score-track i { display:block; height:100%; background:linear-gradient(90deg,#3d6cf3,#7e62e7); border-radius:inherit; }
    .dimension-score-label { color:#52637b; font-size:11px; font-weight:750; white-space:nowrap; }
    .dimension-note { margin:9px 0 0; color:#718097; font-size:9px; line-height:1.65; }
    .deduction-list { display:grid; margin-top:10px; gap:7px; }
    .deduction { padding:10px 11px; background:#fff; border:1px solid #e7ebf1; border-left:3px solid #e2a03d; border-radius:7px; }
    .deduction.no-charge { border-left-color:#aab5c5; }
    .deduction-top { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
    .deduction-top strong { font-size:10px; }
    .deduction-points { color:#b66b11; font-size:10px; font-weight:800; white-space:nowrap; }
    .deduction.no-charge .deduction-points { color:#7a8798; }
    .deduction p { margin:6px 0 0; color:#66758b; font-size:9px; line-height:1.65; }
    .deduction-meta { margin-top:7px; color:#8894a5; font:8px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace; }
    .suggestion { margin-top:7px; padding-top:7px; color:#52637b; border-top:1px dashed #e3e8ef; font-size:9px; line-height:1.6; }
    .other-problems { margin-top:15px; padding:13px; background:#fff8ed; border:1px solid #f4dfbd; border-radius:9px; }
    .other-problems h4,.recommendation-section h4 { margin:0 0 8px; font-size:10px; }
    .recommendation-section { margin-top:15px; padding-top:13px; border-top:1px solid #edf0f5; }
    .issues { display:grid; margin-top:14px; gap:7px; }
    .issue { padding:10px; background:#fff8ed; border-left:3px solid #e8a744; border-radius:7px; color:#6f5a39; font-size:10px; line-height:1.6; }
    .recommendations { margin:13px 0 0; padding-left:18px; color:#5e6e83; font-size:10px; line-height:1.8; }
    details { margin-top:13px; padding-top:12px; border-top:1px solid #edf0f5; }
    summary { color:#65748a; cursor:pointer; font-size:10px; font-weight:700; }
    pre { max-height:360px; margin:10px 0 0; padding:12px; overflow:auto; color:#c8d5ed; background:var(--navy); border-radius:9px; font:10px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace; }
    .result-actions { display:flex; justify-content:flex-end; gap:8px; }
    .download { margin-top:11px; padding:7px 10px; color:#3159c4; background:#edf2ff; border:0; border-radius:8px; font-size:9px; font-weight:700; }
    .download.danger { color:var(--red); background:#fdeaea; }
    @media (max-width:820px) { .grid{grid-template-columns:1fr}.hero{align-items:flex-start;flex-direction:column}.health{min-width:0}.summary-grid{grid-template-columns:1fr}.dimension{grid-template-columns:115px 1fr 30px}.dimension-head{align-items:flex-start;flex-direction:column}.dimension-score{width:100%}.shell{width:min(100% - 22px,1180px);padding-top:12px} }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div><span class="eyebrow">LOCAL QUALITY LAB · VIDEO_QC_V2_25POINT</span><h1>AI 视频质检实验页</h1><p>使用正式千问模型、V2 评分规则和服务端复算。四个质量维度各 25 分，平台需求作为乘数影响最终综合分。</p></div>
      <div id="health" class="health"><i></i><span>正在读取模型状态</span></div>
    </section>
    <div class="grid">
      <section class="panel">
        <div class="panel-head"><div><h2>本地视频</h2><p>可一次选择多个文件，最多同时处理 2 个</p></div></div>
        <div id="drop-zone" class="drop-zone" tabindex="0" role="button"><div><strong>拖放 MP4 / MOV 到这里</strong><span>单文件最大 1 GB，不会写入正式数据库</span><button id="choose-button" class="button" type="button">选择视频</button></div></div>
        <input id="file-input" type="file" accept="video/mp4,video/quicktime,.mp4,.mov" multiple hidden />
        <p class="privacy">每个任务会从紧缺（×1.00）、推荐（×0.80）和已饱和（×0.30）三个固定档位中随机抽取平台需求状态。</p>
        <p class="privacy">视频完成、失败或取消后会删除原视频和抽帧；任务结果与脱敏调用诊断保留 30 天，刷新页面不会丢失。百炼调用可能产生模型费用。</p>
        <div id="queue-list" class="queue"></div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>检测结果</h2><p>任务 ID、评分结果和调用诊断均可下载</p></div><button id="download-all" class="button secondary" type="button" disabled>下载整批 JSON</button></div>
        <div id="results-list" class="results"></div>
      </section>
    </div>
  </main>
  <script>
    const state = { batchId:crypto.randomUUID(), queue:[], running:0, results:[], retentionDays:30 };
    const terminalStages = new Set(["completed","review_pending","system_failed","cancelled"]);
    const stageLabels = { waiting:"等待中", uploading:"上传中", queued:"排队中", media_analysis:"媒体分析", initial_review:"初审", secondary_review:"复核", flash_review:"初审（历史）", plus_review:"复核（历史）", completed:"已完成", review_pending:"待复核", system_failed:"系统失败", cancelled:"已取消" };
    const dimensionLabels = { first_person_and_composition:"第一人称与构图", hand_forearm_object_integrity:"手部、前臂与对象完整性", frame_and_video_quality:"视频与画面质量", task_authenticity_completeness:"任务真实性与完整度", task_value_uniqueness:"平台需求与稀缺度" };
    const dimensionAliases = { D1:"first_person_and_composition", D2:"hand_forearm_object_integrity", D3:"frame_and_video_quality", D4:"task_authenticity_completeness", D5:"task_value_uniqueness" };
    const qualityDimensionKeys = ["first_person_and_composition","hand_forearm_object_integrity","frame_and_video_quality","task_authenticity_completeness"];
    const evaluationStatusLabels = { scored:"已评分", hard_reject:"硬性否决", incomplete_input:"输入不完整", review_pending:"待复核", system_failed:"系统失败" };
    const severityLabels = { minor:"轻微", moderate:"中等", major:"较重", critical:"严重" };
    const reasonLabels = { BROKEN_UNPLAYABLE:"视频损坏或无法播放", EXACT_DUPLICATE:"完全重复视频", FAKE_OR_NON_TASK:"虚假或非任务内容", NON_FIRST_PERSON:"不符合第一人称视角", NO_HAND_OR_OBJECT:"手部或操作对象不可见", UNRELATED_CONTENT:"存在无关内容", PRIVACY_OR_SAFETY:"隐私、安全或合规风险", BLACK_SCREEN:"黑屏", FREEZE:"画面冻结", BLUR:"画面模糊", EXPOSURE:"曝光异常", SHAKE:"画面抖动", HAND_CROPPED:"手部被裁切", HAND_SCALE_TOO_LARGE:"操作主体占比过大", HAND_SCALE_TOO_SMALL:"操作主体占比过小", HAND_NEAR_EDGE:"手部靠近画面边缘", OBJECT_NOT_VISIBLE:"操作对象不可见", LOW_RESOLUTION:"视频分辨率不足", LOW_FPS:"视频帧率不足", TASK_INCOMPLETE:"任务未完成", REPETITIVE:"操作重复", LOW_VALUE:"任务信息价值较低", INVENTORY_SATURATED:"任务库存已饱和", HIGH_SIMILARITY:"与已有视频高度相似" };
    const subcriterionLabels = { POV:"第一人称真实性", ANGLE:"视角自然度", ORIENTATION:"横竖屏构图", ARM_ENTRY:"手臂入镜方向", COMPLETENESS:"手部与前臂完整性", EDGE:"手部贴边", SCALE:"操作区域大小", OCCLUSION:"操作遮挡", OBJECT_VISIBILITY:"操作对象可见性", RESOLUTION:"视频分辨率", FPS:"视频帧率", SHARPNESS:"画面清晰度", EXPOSURE:"画面曝光", STABILITY:"画面稳定性", CONTINUITY:"视频连续性", LEVEL:"操作价值等级", AUTHENTICITY:"任务真实性", PROGRESS:"任务连续推进", COMPLETION:"任务完成度" };
    const input = document.getElementById("file-input");
    const dropZone = document.getElementById("drop-zone");
    const queueList = document.getElementById("queue-list");
    const resultsList = document.getElementById("results-list");
    const downloadAll = document.getElementById("download-all");

    function node(tag,className,text) { const element=document.createElement(tag); if(className) element.className=className; if(text!==undefined) element.textContent=text; return element; }
    function formatBytes(value) { if(value>=1073741824) return (value/1073741824).toFixed(2)+" GB"; if(value>=1048576) return (value/1048576).toFixed(1)+" MB"; return (value/1024).toFixed(1)+" KB"; }
    function formatDuration(ms) { const seconds=Math.max(0,Math.round((ms||0)/1000)); return String(Math.floor(seconds/3600)).padStart(2,"0")+":"+String(Math.floor((seconds%3600)/60)).padStart(2,"0")+":"+String(seconds%60).padStart(2,"0"); }
    function statusTone(stage) { if(stage==="completed") return "ok"; if(stage==="review_pending") return "warn"; if(stage==="system_failed"||stage==="cancelled") return "bad"; if(["uploading","queued","media_analysis","initial_review","secondary_review","flash_review","plus_review"].includes(stage)) return "active"; return "idle"; }
    function evaluationStatusLabel(value) { return evaluationStatusLabels[value]||"未知状态"; }
    function reasonLabel(value) { return reasonLabels[value]||String(value||"未命名问题"); }
    function severityLabel(value) { return severityLabels[value]||"未分级"; }
    function userText(value) { return String(value||"").replace(/\bD1\b/gu,"第一人称与构图").replace(/\bD2\b/gu,"手部、前臂与对象完整性").replace(/\bD3\b/gu,"视频与画面质量").replace(/\bD4\b/gu,"任务真实性与完整度").replace(/\bD5\b/gu,"平台需求与稀缺度"); }
    function addMetric(grid,label,value) { const box=node("div"); box.append(node("span","",label),node("strong","",value)); grid.append(box); }
    function dimensionScore(label,score,max) { const safe=Math.max(0,Math.min(max,Number(score)||0)); const container=node("div","dimension-score"); const track=node("span","dimension-score-track"); track.setAttribute("role","progressbar"); track.setAttribute("aria-label",label+" "+Number(score||0).toFixed(1)+" / "+max); track.setAttribute("aria-valuemin","0"); track.setAttribute("aria-valuemax",String(max)); track.setAttribute("aria-valuenow",String(safe)); const fill=node("i"); fill.style.width=(max?safe/max*100:0)+"%"; track.append(fill); container.append(track,node("span","dimension-score-label",Number(score||0).toFixed(1)+" / "+max)); return container; }
    function issueDimension(issue) { const value=issue.dimension||""; return dimensionAliases[value]||value; }
    function pointsText(issue) { const points=Number(issue.deducted_points); if(Number.isFinite(points)&&points>0) return "−"+points.toFixed(1)+" 分"; return "未额外扣分"; }
    function evidenceText(issue) { const evidence=(issue.evidence_timestamps_ms||[]).map(formatDuration).join("、"); return "规则 "+(issue.rule_id||issue.reason_code||"OTHER.OBSERVATION")+" · "+formatDuration(issue.start_ms)+"–"+formatDuration(issue.end_ms)+(evidence?" · 证据 "+evidence:""); }
    function renderDeduction(issue) { const charged=Number(issue.deducted_points)>0; const box=node("div","deduction"+(charged?"":" no-charge")); const top=node("div","deduction-top"); top.append(node("strong","",userText(subcriterionLabels[issue.subcriterion]||issue.subcriterion||reasonLabel(issue.reason_code))),node("span","deduction-points",pointsText(issue))); box.append(top,node("p","",userText(issue.observed_value||issue.description||"暂无观察说明")),node("div","deduction-meta",evidenceText(issue))); if(issue.recommendation) box.append(node("div","suggestion","建议："+userText(issue.recommendation))); return box; }
    function inferredScores(result) { const dimensions=result.dimensions||{}; const raw=result.qualityRawScore===undefined?qualityDimensionKeys.reduce((sum,key)=>sum+Number(dimensions[key]&&dimensions[key].score||0),0):Number(result.qualityRawScore); const quality=result.qualityScore===undefined?raw:Number(result.qualityScore); const demand=result.demandCoefficient===undefined?Number(dimensions.task_value_uniqueness&&dimensions.task_value_uniqueness.coefficient||1):Number(result.demandCoefficient); return { raw,quality,demand }; }
    function addFiles(files) { for(const file of files) { const lower=file.name.toLowerCase(); if(!lower.endsWith(".mp4")&&!lower.endsWith(".mov")) continue; state.queue.push({ localId:crypto.randomUUID(), file, fileName:file.name, sizeBytes:file.size, stage:"waiting", jobId:null, result:null, error:null, diagnostics:[], controller:null }); } render(); void runQueue(); }
    function exportEntry(entry) { return { taskId:entry.jobId, batchId:entry.batchId, fileName:entry.fileName, sizeBytes:entry.sizeBytes, stage:entry.stage, createdAt:entry.createdAt, updatedAt:entry.updatedAt, error:entry.error, diagnostics:entry.diagnostics, result:entry.result }; }
    function applyJob(entry,job) { entry.jobId=job.id; entry.batchId=job.batchId; entry.fileName=job.fileName; entry.sizeBytes=job.sizeBytes; entry.stage=job.stage; entry.createdAt=job.createdAt; entry.updatedAt=job.updatedAt; entry.result=job.result||null; entry.error=job.error||null; entry.diagnostics=job.diagnostics||[]; entry.demandStatus=job.demandStatus; entry.demandCoefficient=job.demandCoefficient; }

    function renderQueue() {
      queueList.replaceChildren();
      if(state.queue.length===0) { queueList.append(node("div","queue-empty","尚未添加视频")); return; }
      for(const entry of state.queue) {
        const item=node("article","queue-item"); const heading=node("div");
        heading.append(node("strong","",entry.fileName),node("div","task-id",entry.jobId?"任务 ID · "+entry.jobId:"任务 ID · 上传后生成")); item.append(heading);
        const badge=node("span","status "+statusTone(entry.stage),stageLabels[entry.stage]||entry.stage); const meta=node("div","queue-meta"); meta.append(node("span","",formatBytes(entry.sizeBytes)),badge); item.append(meta);
        if(!terminalStages.has(entry.stage)) { const cancel=node("button","mini-button",entry.stage==="waiting"?"移除":"取消"); cancel.type="button"; cancel.addEventListener("click",()=>void cancelEntry(entry)); item.append(cancel); }
        item.dataset.localId=entry.localId; queueList.append(item);
      }
    }

    function renderResults() {
      resultsList.replaceChildren(); const completed=state.queue.filter((entry)=>terminalStages.has(entry.stage)); state.results=completed.map(exportEntry); downloadAll.disabled=state.results.length===0;
      if(completed.length===0) { resultsList.append(node("div","result-empty","结果会在每个视频处理结束后显示")); return; }
      for(const entry of completed) {
        const card=node("article","result-card"); const title=node("div","result-title"); const copy=node("div");
        copy.append(node("h3","",entry.fileName),node("div","task-id","任务 ID · "+(entry.jobId||"未生成")),node("p","",userText(entry.error||(entry.result?entry.result.summary:(stageLabels[entry.stage]||entry.stage))))); title.append(copy);
        if(entry.result) { const score=node("div","score",String(entry.result.finalScore)); score.append(node("small",""," / 100")); title.append(score); } card.append(title);
        if(entry.result) {
          const result=entry.result; const scores=inferredScores(result); const metrics=node("div","summary-grid"); addMetric(metrics,"评估状态",evaluationStatusLabel(result.evaluationStatus)); addMetric(metrics,"质量总分",scores.quality.toFixed(1)+" / 100"); addMetric(metrics,"平台需求",(result.demandStatus||"紧缺")+" ×"+scores.demand.toFixed(2)); addMetric(metrics,"结算比例",result.settlementRatio===null?"暂不结算":Math.round(result.settlementRatio*100)+"%"); addMetric(metrics,"有效计费时长",formatDuration(result.billableDurationMs)); addMetric(metrics,"无效时长",formatDuration(result.invalidDurationMs)); addMetric(metrics,"识别任务",result.detectedTask&&result.detectedTask.task_summary?result.detectedTask.task_summary:"未确定"); addMetric(metrics,"模型运行",String((result.modelRuns||[]).length)+" 次"); addMetric(metrics,"规则版本",result.ruleVersion||"历史规则"); card.append(metrics);
          const deductions=result.deductions||[]; const dimensionCards=node("div","dimension-cards"); const isCurrentRule=result.ruleVersion==="video_qc_v2_traceable"; const usesTwentyFivePointDimensions=isCurrentRule||result.ruleVersion==="video_qc_v2_25point"||qualityDimensionKeys.some((key)=>Number(result.dimensions&&result.dimensions[key]&&result.dimensions[key].score||0)>20); const dimensionMax=usesTwentyFivePointDimensions?25:20;
          for(const key of qualityDimensionKeys) { const value=(result.dimensions||{})[key]||{score:0,coefficient:0}; const dimensionCard=node("section","dimension-card"); const head=node("div","dimension-head"); head.append(node("strong","",dimensionLabels[key]),dimensionScore(dimensionLabels[key],Number(value.score||0),dimensionMax)); dimensionCard.append(head); const relevant=deductions.filter((issue)=>issueDimension(issue)===key); if(relevant.length) { const list=node("div","deduction-list"); relevant.forEach((issue,index)=>{ const displayIssue=issue.deducted_points===undefined?Object.assign({},issue,{deducted_points:index===0?Math.max(0,dimensionMax-Number(value.score||0)):0,points_after:Number(value.score||0),is_controlling:index===0}):issue; list.append(renderDeduction(displayIssue)); }); dimensionCard.append(list); } else if(Number(value.score||0)<dimensionMax) { const missing=node("div","deduction missing"); const top=node("div","deduction-top"); top.append(node("strong","","扣分依据缺失"),node("span","deduction-points","−"+(dimensionMax-Number(value.score||0)).toFixed(1)+" 分待核实")); missing.append(top,node("p","",isCurrentRule?"模型返回了低于满分的结果，但没有返回对应扣分原因和证据。本结果不具备结算条件，已进入复核。":"这条历史记录没有保存可复算的扣分原因；不能根据分差反推原因，请重新检测。")); dimensionCard.append(missing); } else dimensionCard.append(node("p","dimension-note","未发现该维度的明确扣分点。")); dimensionCards.append(dimensionCard); }
          const demandCard=node("section","dimension-card"); const demandHead=node("div","dimension-head"); demandHead.append(node("strong","",dimensionLabels.task_value_uniqueness),node("span","",(result.demandStatus||entry.demandStatus||"未分配")+" ×"+scores.demand.toFixed(2))); demandCard.append(demandHead,node("p","dimension-note",isCurrentRule?"质量总分 "+scores.quality.toFixed(1)+" × 需求系数 "+scores.demand.toFixed(2)+" = 最终综合分 "+Number(result.finalScore).toFixed(1)+"。实验页从三个固定需求档位中随机抽取，并在本次任务内冻结。":"此记录由历史规则生成，保留原始最终分 "+Number(result.finalScore).toFixed(1)+"；重新检测后才会按当前需求乘数公式计算。")); const demandIssues=deductions.filter((issue)=>issueDimension(issue)==="task_value_uniqueness"); if(demandIssues.length) { const list=node("div","deduction-list"); for(const issue of demandIssues) list.append(renderDeduction(issue)); demandCard.append(list); } dimensionCards.append(demandCard); card.append(dimensionCards);
          const others=deductions.filter((issue)=>!qualityDimensionKeys.includes(issueDimension(issue))&&issueDimension(issue)!=="task_value_uniqueness"); if(others.length) { const other=node("section","other-problems"); other.append(node("h4","","其他问题")); for(const issue of others) other.append(node("p","dimension-note",reasonLabel(issue.reason_code)+" · "+(issue.description||"暂无说明"))); card.append(other); }
          const hasSevere=deductions.some((issue)=>issue.severity==="major"||issue.severity==="critical"); const showQualityAdvice=scores.quality<80||hasSevere; const recommendations=(result.recommendations||[]).filter((item)=>showQualityAdvice||/饱和|紧缺|需求|任务/u.test(item)); const recommendationSection=node("section","recommendation-section"); recommendationSection.append(node("h4","","建议")); if(recommendations.length) { const list=node("ul","recommendations"); for(const recommendation of recommendations) list.append(node("li","",userText(recommendation))); recommendationSection.append(list); } else recommendationSection.append(node("p","dimension-note","当前视频无需质量改进。")); card.append(recommendationSection);
        }
        const details=node("details"); details.append(node("summary","","查看调用诊断与完整结果")); details.append(node("pre","",JSON.stringify({ taskId:entry.jobId, diagnostics:entry.diagnostics, result:entry.result },null,2))); card.append(details);
        const actions=node("div","result-actions");
        if(entry.jobId) { const copyId=node("button","download","复制任务 ID"); copyId.type="button"; copyId.addEventListener("click",()=>void navigator.clipboard.writeText(entry.jobId)); actions.append(copyId); }
        const download=node("button","download","下载此项 JSON"); download.type="button"; download.addEventListener("click",()=>downloadJson(entry.fileName.replace(/\.[^.]+$/u,"")+"-video-qc.json",exportEntry(entry))); actions.append(download);
        if(entry.jobId) { const remove=node("button","download danger","删除记录"); remove.type="button"; remove.addEventListener("click",()=>void deleteEntry(entry)); actions.append(remove); }
        card.append(actions); resultsList.append(card);
      }
    }

    function render() { renderQueue(); renderResults(); }
    function downloadJson(fileName,value) { const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"})); const anchor=document.createElement("a"); anchor.href=url; anchor.download=fileName; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(()=>URL.revokeObjectURL(url),0); }
    async function readError(response) { try { const body=await response.json(); return body.error||("HTTP "+response.status); } catch { return "HTTP "+response.status; } }
    async function watchEntry(entry) { while(entry.jobId&&!terminalStages.has(entry.stage)) { await new Promise((resolve)=>setTimeout(resolve,1000)); const response=await fetch("/api/jobs/"+encodeURIComponent(entry.jobId),{signal:entry.controller?entry.controller.signal:undefined}); if(!response.ok) throw new Error(await readError(response)); applyJob(entry,await response.json()); render(); } }
    async function watchHistory() { while(state.queue.some((entry)=>entry.jobId&&!terminalStages.has(entry.stage))) { await new Promise((resolve)=>setTimeout(resolve,1000)); const response=await fetch("/api/jobs"); if(!response.ok) throw new Error(await readError(response)); const body=await response.json(); const jobsById=new Map((body.jobs||[]).map((job)=>[job.id,job])); for(const entry of state.queue) { if(entry.jobId&&jobsById.has(entry.jobId)) applyJob(entry,jobsById.get(entry.jobId)); } render(); } }
    async function processEntry(entry) { entry.stage="uploading"; entry.controller=new AbortController(); render(); const form=new FormData(); form.append("batchId",state.batchId); form.append("video",entry.file); const created=await fetch("/api/jobs",{method:"POST",body:form,signal:entry.controller.signal}); if(!created.ok) throw new Error(await readError(created)); const body=await created.json(); entry.jobId=body.jobId; entry.stage="queued"; render(); await watchEntry(entry); }
    function runQueue() { while(state.running<2) { const entry=state.queue.find((item)=>item.stage==="waiting"); if(!entry) return; state.running+=1; entry.stage="uploading"; void processEntry(entry).catch((error)=>{ if(entry.stage!=="cancelled") { entry.stage="system_failed"; entry.error=error&&error.message?error.message:"处理失败"; } }).finally(()=>{ entry.controller=null; state.running-=1; render(); runQueue(); }); } }
    async function cancelEntry(entry) { if(entry.stage==="waiting") { state.queue=state.queue.filter((item)=>item!==entry); render(); return; } entry.stage="cancelled"; entry.controller?.abort(); if(entry.jobId) { try { await fetch("/api/jobs/"+encodeURIComponent(entry.jobId),{method:"DELETE"}); } catch {} } render(); }
    async function deleteEntry(entry) { if(!entry.jobId) return; const response=await fetch("/api/jobs/"+encodeURIComponent(entry.jobId),{method:"DELETE"}); if(!response.ok&&response.status!==404) throw new Error(await readError(response)); state.queue=state.queue.filter((item)=>item!==entry); render(); }
    async function loadHistory() { const response=await fetch("/api/jobs"); if(!response.ok) throw new Error(await readError(response)); const body=await response.json(); state.retentionDays=body.retentionDays||30; const local=state.queue.filter((entry)=>!entry.jobId); const restored=(body.jobs||[]).map((job)=>({ localId:job.id, file:null, fileName:job.fileName, sizeBytes:job.sizeBytes, stage:job.stage, jobId:job.id, batchId:job.batchId, createdAt:job.createdAt, updatedAt:job.updatedAt, result:job.result||null, error:job.error||null, diagnostics:job.diagnostics||[], demandStatus:job.demandStatus, demandCoefficient:job.demandCoefficient, controller:null })); state.queue=[...local,...restored]; render(); const active=state.queue.filter((entry)=>entry.jobId&&!terminalStages.has(entry.stage)); if(active.length) { void watchHistory().catch((error)=>{ for(const entry of active) { if(!terminalStages.has(entry.stage)) { entry.stage="system_failed"; entry.error=error&&error.message?error.message:"状态读取失败"; } } }).finally(()=>{ render(); runQueue(); }); } else { runQueue(); } }

    document.getElementById("choose-button").addEventListener("click",()=>input.click()); input.addEventListener("change",()=>{ addFiles(input.files||[]); input.value=""; });
    for(const eventName of ["dragenter","dragover"]) dropZone.addEventListener(eventName,(event)=>{ event.preventDefault(); dropZone.classList.add("dragging"); });
    for(const eventName of ["dragleave","drop"]) dropZone.addEventListener(eventName,(event)=>{ event.preventDefault(); dropZone.classList.remove("dragging"); });
    dropZone.addEventListener("drop",(event)=>addFiles(event.dataTransfer.files)); dropZone.addEventListener("keydown",(event)=>{ if(event.key==="Enter"||event.key===" ") input.click(); });
    downloadAll.addEventListener("click",()=>downloadJson("video-quality-history.json",{ retentionDays:state.retentionDays, exportedAt:new Date().toISOString(), items:state.results }));
    void fetch("/api/health").then((response)=>response.json()).then((health)=>{ const element=document.getElementById("health"); element.classList.toggle("ready",health.modelStatus==="configured"); element.querySelector("span").textContent=health.modelStatus==="configured"?"模型已配置 · "+health.initialModel:"模型未配置"; }).catch(()=>{ document.querySelector("#health span").textContent="服务状态读取失败"; });
    render();
    void loadHistory().catch(()=>undefined);
  </script>
</body>
</html>`;
}
