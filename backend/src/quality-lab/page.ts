import type { QualityLabMode } from "./environment.js";

export function renderQualityLabPage(mode: QualityLabMode = "quality"): string {
  const fused = mode === "fused";
  const pageTitle = fused ? "融合 AI 标注实验页" : "原业务 AI 质检实验页";
  const pageDescription = fused
    ? "同一视频并行运行原业务 D1–D5 质检与证据约束的结构化语义标注。队列最多双并发，两部分结果独立展示，不写正式数据库，也不影响结算。"
    : "独立运行原业务 D1–D5 质检、条件复核和服务端规则复算。队列最多双并发，用于建立融合方案的业务基线。";
  return String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${pageTitle}</title>
  <style>
    :root { color-scheme:light; --ink:#162033; --muted:#748197; --line:#e4eaf2; --blue:#3868f5; --navy:#0d1729; --green:#16885d; --amber:#b77716; --red:#c84f4a; --canvas:#f4f7fb; }
    * { box-sizing:border-box; }
    body { margin:0; color:var(--ink); background:var(--canvas); font-family:Inter,"PingFang SC","Microsoft YaHei",system-ui,sans-serif; }
    button,input,textarea { font:inherit; } button { cursor:pointer; }
    .shell { width:min(1180px,calc(100% - 36px)); margin:0 auto; padding:32px 0 64px; }
    .hero { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; padding:30px; color:#fff; background:radial-gradient(circle at 80% 10%,#244b9c 0,transparent 35%),linear-gradient(135deg,#0d1729,#152847); border-radius:22px; box-shadow:0 22px 60px rgb(16 35 73 / 18%); }
    .eyebrow { color:#81a6ff; font-size:12px; font-weight:750; letter-spacing:.08em; }
    h1 { margin:10px 0 8px; font-size:clamp(28px,4vw,43px); letter-spacing:-.04em; }
    .hero p { max-width:700px; margin:0; color:#a8b6cb; font-size:13px; line-height:1.8; }
    .lab-nav { display:flex; margin-top:18px; flex-wrap:wrap; gap:8px; }
    .lab-nav a { padding:8px 11px; color:#b9c8de; text-decoration:none; background:rgb(255 255 255 / 6%); border:1px solid rgb(255 255 255 / 12%); border-radius:9px; font-size:10px; font-weight:700; }
    .lab-nav a.active { color:#fff; background:#3868f5; border-color:#6289f7; }
    .health { display:flex; min-width:max-content; align-items:center; gap:9px; padding:10px 13px; color:#c4d2e7; background:rgb(255 255 255 / 7%); border:1px solid rgb(255 255 255 / 12%); border-radius:999px; font-size:11px; }
    .health i { width:8px; height:8px; background:#e3a342; border-radius:50%; box-shadow:0 0 0 5px rgb(227 163 66 / 12%); }
    .health.ready i { background:#58d29a; box-shadow:0 0 0 5px rgb(88 210 154 / 12%); }
    .grid { display:grid; margin-top:18px; grid-template-columns:minmax(300px,.78fr) minmax(0,1.22fr); gap:18px; align-items:start; }
    .panel { min-width:0; padding:22px; background:#fff; border:1px solid var(--line); border-radius:17px; box-shadow:0 10px 35px rgb(20 44 84 / 5%); }
    .panel h2 { margin:0; font-size:16px; }
    .panel-head { display:flex; min-width:0; align-items:center; justify-content:space-between; gap:16px; }
    .panel-head > div { min-width:0; }
    .panel-head p { margin:6px 0 0; color:var(--muted); font-size:11px; }
    .prompt-panel { margin-top:20px; }
    .prompt-meta { display:flex; margin-top:14px; flex-wrap:wrap; gap:8px; color:var(--muted); font-size:9px; }
    .prompt-meta span { padding:6px 9px; background:#f3f6fb; border-radius:999px; }
    .prompt-editor { width:100%; min-height:250px; margin-top:12px; padding:14px; color:#26344b; background:#f8fafe; border:1px solid var(--line); border-radius:11px; outline:0; font:10px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace; resize:vertical; }
    .prompt-editor:focus { border-color:#8ca9f5; box-shadow:0 0 0 3px rgb(56 104 245 / 9%); }
    .prompt-footer { display:flex; align-items:center; justify-content:space-between; gap:16px; }
    .prompt-footer p { margin:10px 0 0; color:#8995a7; font-size:9px; line-height:1.6; }
    .prompt-message { color:#3159c4; font-weight:700; }
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
    .queue-item { display:grid; padding:13px; cursor:pointer; background:#fafbfe; border:1px solid #edf0f5; border-radius:11px; grid-template-columns:minmax(0,1fr) auto; gap:7px 12px; transition:.15s ease; }
    .queue-item:hover { border-color:#bdcae0; transform:translateY(-1px); }
    .queue-item.selected { background:#f0f4ff; border-color:#7f9ef2; box-shadow:0 0 0 3px rgb(56 104 245 / 7%); }
    .queue-item:focus-visible { outline:3px solid rgb(56 104 245 / 20%); outline-offset:2px; }
    .queue-item strong { display:block; overflow:hidden; font-size:11px; text-overflow:ellipsis; white-space:nowrap; }
    .queue-meta { display:flex; align-items:center; gap:8px; color:var(--muted); font-size:9px; }
    .queue-upload-time { grid-column:1; color:#8995a7; font-size:9px; }
    .queue-score { grid-row:1 / 4; grid-column:2; align-self:center; min-width:46px; color:var(--blue); text-align:right; font-size:16px; font-weight:800; }
    .queue-score small { display:block; margin-top:2px; color:#98a3b4; font-size:8px; font-weight:600; }
    .task-id { margin-top:4px; color:#3159c4; font:9px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; overflow-wrap:anywhere; }
    .status { display:inline-flex; padding:4px 7px; border-radius:999px; font-size:9px; font-weight:700; }
    .status.active { color:#315fd2; background:#eaf0ff; } .status.ok { color:var(--green); background:#e7f7ef; } .status.warn { color:var(--amber); background:#fff3df; } .status.bad { color:var(--red); background:#fdeaea; } .status.idle { color:#68758a; background:#eef1f5; }
    .mini-button { margin-left:auto; padding:5px 7px; color:#7b8799; background:#fff; border:1px solid var(--line); border-radius:7px; font-size:8px; }
    .result-card { padding:19px; border:1px solid var(--line); border-radius:14px; }
    .result-title { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; }
    .result-title h3 { max-width:560px; margin:0; overflow:hidden; font-size:13px; text-overflow:ellipsis; white-space:nowrap; }
    .result-title p { margin:6px 0 0; color:var(--muted); font-size:10px; }
    .result-upload-time { margin-top:6px; color:#8995a7; font-size:9px; }
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
    .issues { display:grid; margin-top:14px; gap:7px; }
    .issue { padding:10px; background:#fff8ed; border-left:3px solid #e8a744; border-radius:7px; color:#6f5a39; font-size:10px; line-height:1.6; }
    .recommendations { margin:13px 0 0; padding-left:18px; color:#5e6e83; font-size:10px; line-height:1.8; }
    .annotation-card { margin-top:16px; padding:15px; background:#f6f8ff; border:1px solid #dce4fb; border-radius:11px; }
    .annotation-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
    .annotation-head h4 { margin:0; font-size:12px; }
    .annotation-head p { margin:5px 0 0; color:var(--muted); font-size:9px; line-height:1.6; }
    .annotation-tasks { display:grid; margin-top:12px; gap:8px; }
    .annotation-task { padding:11px; background:#fff; border:1px solid #e5eafa; border-radius:9px; }
    .annotation-task strong { display:block; font-size:10px; }
    .annotation-task p { margin:5px 0 0; color:#68758a; font-size:9px; line-height:1.65; }
    .annotation-labels { display:flex; margin-top:11px; flex-wrap:wrap; gap:6px; }
    .annotation-label { padding:5px 7px; color:#53627a; background:#fff; border:1px solid #e1e7f5; border-radius:999px; font-size:8px; }
    .annotation-alerts { display:grid; margin-top:11px; gap:6px; }
    .annotation-alert { padding:8px 9px; color:#775a2d; background:#fff6e7; border-radius:7px; font-size:9px; line-height:1.55; }
    .annotation-alert.error { color:#8e3d3a; background:#fdecec; }
    .annotation-meta { margin-top:10px; color:#64728a; font-size:9px; line-height:1.6; }
    .readonly-note { margin:10px 0 0; color:#748197; font-size:9px; line-height:1.6; }
    details { margin-top:13px; padding-top:12px; border-top:1px solid #edf0f5; }
    summary { color:#65748a; cursor:pointer; font-size:10px; font-weight:700; }
    pre { max-height:360px; margin:10px 0 0; padding:12px; overflow:auto; color:#c8d5ed; background:var(--navy); border-radius:9px; font:10px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace; }
    .result-actions { display:flex; justify-content:flex-end; gap:8px; }
    .download { margin-top:11px; padding:7px 10px; color:#3159c4; background:#edf2ff; border:0; border-radius:8px; font-size:9px; font-weight:700; }
    .download.danger { color:var(--red); background:#fdeaea; }
    @media (max-width:960px) { .grid{grid-template-columns:1fr}.hero{align-items:flex-start;flex-direction:column}.health{min-width:0}.summary-grid{grid-template-columns:1fr}.dimension{grid-template-columns:115px 1fr 30px}.shell{width:min(100% - 22px,1180px);padding-top:12px}.prompt-footer{align-items:stretch;flex-direction:column}.prompt-footer .button{width:100%} }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div><span class="eyebrow">${fused ? "LOCAL FUSED LAB · QC + ANNOTATION" : "LOCAL BASELINE LAB · VIDEO_QC_V2"}</span><h1>${pageTitle}</h1><p>${pageDescription}</p><nav class="lab-nav" aria-label="实验页面切换"><a href="http://127.0.0.1:4010/"${fused ? "" : ' class="active"'}>4010 · 原业务质检</a><a href="http://127.0.0.1:4011/"${fused ? ' class="active"' : ""}>4011 · 融合标注</a></nav></div>
      <div id="health" class="health"><i></i><span>正在读取模型状态</span></div>
    </section>
    <section class="panel prompt-panel">
      <div class="panel-head"><div><h2>${fused ? "链路 1 · 原业务质检 Prompt" : "原业务质检 Prompt"}</h2><p>${fused ? "与 4010 相同，负责 D1–D5、硬性否决、条件复核和服务端规则复算" : "融合前业务版本使用的 D1–D5 判断规则"}</p></div><span id="prompt-message" class="prompt-message"></span></div>
      <div id="prompt-meta" class="prompt-meta"><span>正在读取当前版本</span></div>
      <label for="prompt-editor" class="privacy">AI 系统提示词</label>
      <textarea id="prompt-editor" class="prompt-editor" spellcheck="false" disabled></textarea>
      <div class="prompt-footer"><p>保存会创建新版本，只影响保存后新开始的任务；已上传、排队中和历史任务继续使用各自锁定的版本。</p><button id="save-prompt" class="button" type="button" disabled>保存新版本</button></div>
    </section>
    ${fused ? `<section class="panel prompt-panel">
      <div class="panel-head"><div><h2>链路 2 · 现有融合标注 Prompt</h2><p>当前 feature/ai-annotation 分支实际运行的证据约束语义标注链路，负责场景、任务、动作、对象、结果和证据时间戳</p></div></div>
      <div id="annotation-meta" class="prompt-meta"><span>正在读取融合标注版本</span></div>
      <label for="annotation-prompt-editor" class="privacy">融合结构化标注系统提示词</label>
      <textarea id="annotation-prompt-editor" class="prompt-editor" spellcheck="false" readonly></textarea>
      <p class="readonly-note">该 Prompt 来自仓库版本化资产，实验页只读，避免页面编辑后偏离当前融合版本。</p>
    </section>` : ""}
    <div class="grid">
      <section class="panel">
        <div class="panel-head"><div><h2>视频与历史任务</h2><p>点击任务，在右侧查看对应评分详情</p></div></div>
        <div id="drop-zone" class="drop-zone" tabindex="0" role="button"><div><strong>拖放 MP4 / MOV 到这里</strong><span>单文件最大 1 GB，不会写入正式数据库</span><button id="choose-button" class="button" type="button">选择视频</button></div></div>
        <input id="file-input" type="file" accept="video/mp4,video/quicktime,.mp4,.mov" multiple hidden />
        <p class="privacy">视频完成、失败或取消后会删除原视频和抽帧；任务结果与脱敏调用诊断保留 30 天，刷新页面不会丢失。百炼调用可能产生模型费用。</p>
        <div id="queue-list" class="queue"></div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>${fused ? "质检与标注详情" : "评分详情"}</h2><p>右侧仅显示当前选中的任务</p></div><button id="download-all" class="button secondary" type="button" disabled>下载整批 JSON</button></div>
        <div id="results-list" class="results"></div>
      </section>
    </div>
  </main>
  <script>
    const labMode = ${JSON.stringify(mode)};
    const state = { batchId:crypto.randomUUID(), queue:[], running:0, results:[], retentionDays:30, selectedId:null, prompt:null };
    const terminalStages = new Set(["completed","review_pending","system_failed","cancelled"]);
    const stageLabels = { waiting:"等待中", uploading:"上传中", queued:"排队中", media_analysis:"媒体分析", initial_review:"初审", secondary_review:"复核", flash_review:"初审（历史）", plus_review:"复核（历史）", completed:"已完成", review_pending:"待复核", system_failed:"系统失败", cancelled:"已取消" };
    const dimensionLabels = { first_person_and_composition:"第一人称与构图", hand_forearm_object_integrity:"手部、前臂与对象", frame_and_video_quality:"视频与帧质量", task_authenticity_completeness:"任务真实性与完整度", task_value_uniqueness:"任务价值与独特性" };
    const evaluationStatusLabels = { scored:"已评分", hard_reject:"硬性否决", incomplete_input:"输入不完整", review_pending:"待复核", system_failed:"系统失败" };
    const severityLabels = { minor:"轻微", moderate:"中等", major:"较重", critical:"严重" };
    const reasonLabels = { BROKEN_UNPLAYABLE:"视频损坏或无法播放", EXACT_DUPLICATE:"完全重复视频", FAKE_OR_NON_TASK:"虚假或非任务内容", NON_FIRST_PERSON:"不符合第一人称视角", NO_HAND_OR_OBJECT:"手部或操作对象不可见", UNRELATED_CONTENT:"存在无关内容", PRIVACY_OR_SAFETY:"隐私、安全或合规风险", BLACK_SCREEN:"黑屏", FREEZE:"画面冻结", BLUR:"画面模糊", EXPOSURE:"曝光异常", SHAKE:"画面抖动", HAND_CROPPED:"手部被裁切", OBJECT_NOT_VISIBLE:"操作对象不可见", TASK_INCOMPLETE:"任务未完成", REPETITIVE:"操作重复", LOW_VALUE:"任务信息价值较低", INVENTORY_SATURATED:"任务库存已饱和", HIGH_SIMILARITY:"与已有视频高度相似" };
    const annotationStatusLabels = { candidate:"候选可用", review_required:"待人工确认", system_failed:"标注链路失败" };
    const completionLabels = { complete:"完成", incomplete:"未完成", partial:"部分完成", uncertain:"无法确认" };
    const resultStatusLabels = { success:"成功", failure:"失败", partial:"部分成功", not_applicable:"不适用", unknown:"未知" };
    const input = document.getElementById("file-input");
    const dropZone = document.getElementById("drop-zone");
    const queueList = document.getElementById("queue-list");
    const resultsList = document.getElementById("results-list");
    const downloadAll = document.getElementById("download-all");
    const promptEditor = document.getElementById("prompt-editor");
    const promptMeta = document.getElementById("prompt-meta");
    const promptMessage = document.getElementById("prompt-message");
    const savePrompt = document.getElementById("save-prompt");
    const annotationMeta = document.getElementById("annotation-meta");
    const annotationPromptEditor = document.getElementById("annotation-prompt-editor");

    function node(tag,className,text) { const element=document.createElement(tag); if(className) element.className=className; if(text!==undefined) element.textContent=text; return element; }
    function formatBytes(value) { if(value>=1073741824) return (value/1073741824).toFixed(2)+" GB"; if(value>=1048576) return (value/1048576).toFixed(1)+" MB"; return (value/1024).toFixed(1)+" KB"; }
    function formatDuration(ms) { const seconds=Math.max(0,Math.round((ms||0)/1000)); return String(Math.floor(seconds/3600)).padStart(2,"0")+":"+String(Math.floor((seconds%3600)/60)).padStart(2,"0")+":"+String(seconds%60).padStart(2,"0"); }
    function formatDateTime(value) { if(!value) return "上传完成后生成"; const date=new Date(value); if(Number.isNaN(date.getTime())) return "—"; return new Intl.DateTimeFormat("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).format(date).replaceAll("/","-"); }
    function statusTone(stage) { if(stage==="completed") return "ok"; if(stage==="review_pending") return "warn"; if(stage==="system_failed"||stage==="cancelled") return "bad"; if(["uploading","queued","media_analysis","initial_review","secondary_review","flash_review","plus_review"].includes(stage)) return "active"; return "idle"; }
    function evaluationStatusLabel(value) { return evaluationStatusLabels[value]||"未知状态"; }
    function reasonLabel(value) { return reasonLabels[value]||"其他质量问题"; }
    function severityLabel(value) { return severityLabels[value]||"未分级"; }
    function addMetric(grid,label,value) { const box=node("div"); box.append(node("span","",label),node("strong","",value)); grid.append(box); }
    function addFiles(files) { let first=null; for(const file of files) { const lower=file.name.toLowerCase(); if(!lower.endsWith(".mp4")&&!lower.endsWith(".mov")) continue; const entry={ localId:crypto.randomUUID(), file, fileName:file.name, sizeBytes:file.size, stage:"waiting", jobId:null, result:null, error:null, diagnostics:[], controller:null }; state.queue.push(entry); if(!first) first=entry; } if(first) state.selectedId=first.localId; render(); void runQueue(); }
    function exportEntry(entry) { return { taskId:entry.jobId, batchId:entry.batchId, fileName:entry.fileName, sizeBytes:entry.sizeBytes, stage:entry.stage, createdAt:entry.createdAt, updatedAt:entry.updatedAt, error:entry.error, diagnostics:entry.diagnostics, result:entry.result }; }
    function applyJob(entry,job) { entry.jobId=job.id; entry.batchId=job.batchId; entry.fileName=job.fileName; entry.sizeBytes=job.sizeBytes; entry.stage=job.stage; entry.createdAt=job.createdAt; entry.updatedAt=job.updatedAt; entry.promptRevision=job.promptRevision; entry.promptContentSha256=job.promptContentSha256; entry.result=job.result||null; entry.error=job.error||null; entry.diagnostics=job.diagnostics||[]; }
    function selectedEntry() { return state.queue.find((entry)=>entry.localId===state.selectedId)||null; }
    function selectEntry(entry) { state.selectedId=entry.localId; render(); }
    function confidenceLabel(value) { return typeof value==="number"?Math.round(value*100)+"%":"—"; }

    function renderAnnotation(card,result) {
      if(labMode!=="fused") return;
      const section=node("section","annotation-card");
      const annotation=result.candidateAnnotation;
      const head=node("div","annotation-head");
      const copy=node("div");
      copy.append(node("h4","","融合结构化标注"),node("p","","任务盲候选结果，只用于对照实验，不参与上方质检分数或结算"));
      const badge=node("span","status "+(!annotation||annotation.status==="system_failed"?"bad":annotation.status==="review_required"?"warn":"ok"),annotation?annotationStatusLabels[annotation.status]||annotation.status:"未生成");
      head.append(copy,badge); section.append(head);
      if(!annotation) {
        section.append(node("div","annotation-alert error","该结果没有结构化标注产物，可能来自旧历史或融合 Provider 未启用。"));
        card.append(section); return;
      }
      if(annotation.status==="system_failed") {
        section.append(node("div","annotation-alert error",annotation.error||"候选标注模型调用失败"));
        section.append(node("div","annotation-meta","Schema "+annotation.schemaVersion+" · Prompt "+annotation.promptVersion+" · Model "+annotation.model));
        card.append(section); return;
      }
      const effective=annotation.effective;
      const scene=effective&&effective.scene?(effective.scene.fine_label||effective.scene.coarse_label||"未识别"):"未识别";
      const metrics=node("div","summary-grid");
      addMetric(metrics,"场景",scene);
      addMetric(metrics,"场景置信度",confidenceLabel(effective?.scene?.confidence));
      addMetric(metrics,"时间结构",effective?.temporal_structure_type||"unclear");
      addMetric(metrics,"任务数量",String((effective?.tasks||[]).length));
      addMetric(metrics,"证据帧",String(annotation.frameCount||0));
      addMetric(metrics,"可判定性",effective?.model_assessability==="assessable"?"可判定":"需要复核");
      addMetric(metrics,"模型 Token",annotation.usage?.totalTokens==null?"—":String(annotation.usage.totalTokens));
      addMetric(metrics,"标注耗时",typeof annotation.durationMs==="number"?(annotation.durationMs/1000).toFixed(1)+"s":"—");
      section.append(metrics);
      if(effective?.assessability_reason) section.append(node("div","annotation-alert","可判定性说明："+effective.assessability_reason));
      const tasks=node("div","annotation-tasks");
      if((effective?.tasks||[]).length===0) tasks.append(node("div","annotation-task","未识别到可见任务"));
      for(const task of effective?.tasks||[]) {
        const item=node("article","annotation-task");
        item.append(node("strong","",task.task_label+" · "+formatDuration(task.start_ms)+"–"+formatDuration(task.end_ms)));
        item.append(node("p","","动词 "+task.task_verb+" · 对象 "+(task.task_object||"未确定")+" · 置信度 "+confidenceLabel(task.confidence)));
        item.append(node("p","","完成度 "+(completionLabels[task.effective_completion]||task.effective_completion)+" · 结果 "+(resultStatusLabels[task.effective_result_status]||task.effective_result_status)+" · 证据 "+((task.evidence_timestamps_ms||[]).map(formatDuration).join("、")||"无")));
        if(task.execution_pattern) item.append(node("p","","执行模式 "+task.execution_pattern+" · 原子步骤 "+((task.atomic_action_sequence||[]).map((action)=>action.verb).join(" → ")||"无充分证据")));
        if((task.effective_complexity_signals||[]).length) item.append(node("p","","复杂度信号："+task.effective_complexity_signals.join("、")));
        if(task.visible_postcondition) item.append(node("p","","可见后状态："+task.visible_postcondition));
        if((task.policy_reasons||[]).length) item.append(node("p","","证据策略："+task.policy_reasons.join("；")));
        tasks.append(item);
      }
      section.append(tasks);
      if((annotation.labelMappings||[]).length) {
        const labels=node("div","annotation-labels");
        for(const mapping of annotation.labelMappings) labels.append(node("span","annotation-label",mapping.type+" · "+mapping.sourceText+" · "+(mapping.status==="matched"?"已匹配":"候选新标签")));
        section.append(labels);
      }
      const alerts=node("div","annotation-alerts");
      for(const value of annotation.validation?.errors||[]) alerts.append(node("div","annotation-alert error","校验错误："+value));
      for(const value of annotation.validation?.warnings||[]) alerts.append(node("div","annotation-alert","校验提示："+value));
      for(const value of annotation.reviewReasons||[]) alerts.append(node("div","annotation-alert","复核原因："+value));
      if((effective?.uncertain_fields||[]).length) alerts.append(node("div","annotation-alert","不确定字段："+effective.uncertain_fields.join("、")));
      if(alerts.childNodes.length) section.append(alerts);
      section.append(node("div","annotation-meta","Schema "+annotation.schemaVersion+" · Policy "+annotation.policyVersion+" · Prompt "+annotation.promptVersion+" · Model "+annotation.model));
      card.append(section);
    }

    function renderQueue() {
      queueList.replaceChildren();
      if(state.queue.length===0) { queueList.append(node("div","queue-empty","尚未添加视频")); return; }
      for(const entry of state.queue) {
        const item=node("article","queue-item"+(entry.localId===state.selectedId?" selected":"")); const heading=node("div");
        heading.append(node("strong","",entry.fileName),node("div","task-id",entry.jobId?"任务 ID · "+entry.jobId:"任务 ID · 上传后生成")); item.append(heading);
        const badge=node("span","status "+statusTone(entry.stage),stageLabels[entry.stage]||entry.stage); const meta=node("div","queue-meta"); meta.append(node("span","",formatBytes(entry.sizeBytes)),badge); if(entry.promptRevision) meta.append(node("span","","提示词 V"+entry.promptRevision));
        if(!terminalStages.has(entry.stage)) { const cancel=node("button","mini-button",entry.stage==="waiting"?"移除":"取消"); cancel.type="button"; cancel.addEventListener("click",(event)=>{ event.stopPropagation(); void cancelEntry(entry); }); meta.append(cancel); } item.append(meta);
        item.append(node("div","queue-upload-time","上传时间 · "+formatDateTime(entry.createdAt)));
        const queueScore=node("div","queue-score",entry.result?String(entry.result.finalScore):"—"); queueScore.append(node("small","",entry.result?"总分 / 100":"暂无总分")); item.append(queueScore);
        item.dataset.localId=entry.localId; item.tabIndex=0; item.setAttribute("role","button"); item.setAttribute("aria-pressed",String(entry.localId===state.selectedId)); item.addEventListener("click",()=>selectEntry(entry)); item.addEventListener("keydown",(event)=>{ if(event.key==="Enter"||event.key===" ") { event.preventDefault(); selectEntry(entry); } }); queueList.append(item);
      }
    }

    function renderResults() {
      resultsList.replaceChildren(); const completed=state.queue.filter((entry)=>terminalStages.has(entry.stage)); state.results=completed.map(exportEntry); downloadAll.disabled=state.results.length===0; const selected=selectedEntry();
      if(!selected) { resultsList.append(node("div","result-empty","请从左侧选择一个任务")); return; }
      const entry=selected;
        const card=node("article","result-card"); const title=node("div","result-title"); const copy=node("div");
        copy.append(node("h3","",entry.fileName),node("div","task-id","任务 ID · "+(entry.jobId||"未生成")),node("div","result-upload-time","上传时间 · "+formatDateTime(entry.createdAt)),node("p","",entry.error||(entry.result?entry.result.summary:(stageLabels[entry.stage]||entry.stage)))); title.append(copy);
        if(entry.result) { const score=node("div","score",String(entry.result.finalScore)); score.append(node("small",""," / 100")); title.append(score); } card.append(title);
        if(entry.result) {
          const result=entry.result; const metrics=node("div","summary-grid"); addMetric(metrics,"评估状态",evaluationStatusLabel(result.evaluationStatus)); addMetric(metrics,"结算比例",result.settlementRatio===null?"暂不结算":Math.round(result.settlementRatio*100)+"%"); addMetric(metrics,"有效计费时长",formatDuration(result.billableDurationMs)); addMetric(metrics,"无效时长",formatDuration(result.invalidDurationMs)); addMetric(metrics,"识别任务",result.detectedTask&&result.detectedTask.task_summary?result.detectedTask.task_summary:"未确定"); addMetric(metrics,"模型运行",String((result.modelRuns||[]).length)+" 次"); card.append(metrics);
          const dimensions=node("div","dimensions"); for(const [key,value] of Object.entries(result.dimensions||{})) { const row=node("div","dimension"); row.append(node("span","",dimensionLabels[key]||key)); const bar=node("div","bar"); const fill=node("i"); fill.style.width=Math.max(0,Math.min(100,(value.score||0)*5))+"%"; bar.append(fill); row.append(bar,node("strong","",String(value.score))); dimensions.append(row); } card.append(dimensions);
          if((result.deductions||[]).length) { const issues=node("div","issues"); for(const issue of result.deductions) issues.append(node("div","issue",reasonLabel(issue.reason_code)+" · "+formatDuration(issue.start_ms)+"–"+formatDuration(issue.end_ms)+" · "+severityLabel(issue.severity)+" · "+(issue.description||"暂无说明"))); card.append(issues); }
          if((result.recommendations||[]).length) { const list=node("ul","recommendations"); for(const recommendation of result.recommendations) list.append(node("li","",recommendation)); card.append(list); }
          renderAnnotation(card,result);
        }
        const details=node("details"); details.append(node("summary","","查看调用诊断与完整结果")); details.append(node("pre","",JSON.stringify({ taskId:entry.jobId, diagnostics:entry.diagnostics, result:entry.result },null,2))); card.append(details);
        const actions=node("div","result-actions");
        if(entry.jobId) { const copyId=node("button","download","复制任务 ID"); copyId.type="button"; copyId.addEventListener("click",()=>void navigator.clipboard.writeText(entry.jobId)); actions.append(copyId); }
        const download=node("button","download","下载此项 JSON"); download.type="button"; download.addEventListener("click",()=>downloadJson(entry.fileName.replace(/\.[^.]+$/u,"")+(labMode==="fused"?"-fused-annotation.json":"-video-qc.json"),exportEntry(entry))); actions.append(download);
        if(entry.jobId) { const remove=node("button","download danger","删除记录"); remove.type="button"; remove.addEventListener("click",()=>void deleteEntry(entry)); actions.append(remove); }
        card.append(actions); resultsList.append(card);
    }

    function render() { renderQueue(); renderResults(); }
    function downloadJson(fileName,value) { const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"})); const anchor=document.createElement("a"); anchor.href=url; anchor.download=fileName; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(()=>URL.revokeObjectURL(url),0); }
    async function readError(response) { try { const body=await response.json(); return body.error||("HTTP "+response.status); } catch { return "HTTP "+response.status; } }
    async function watchEntry(entry) { while(entry.jobId&&!terminalStages.has(entry.stage)) { await new Promise((resolve)=>setTimeout(resolve,1000)); const response=await fetch("/api/jobs/"+encodeURIComponent(entry.jobId),{signal:entry.controller?entry.controller.signal:undefined}); if(!response.ok) throw new Error(await readError(response)); applyJob(entry,await response.json()); render(); } }
    async function watchHistory() { while(state.queue.some((entry)=>entry.jobId&&!terminalStages.has(entry.stage))) { await new Promise((resolve)=>setTimeout(resolve,1000)); const response=await fetch("/api/jobs"); if(!response.ok) throw new Error(await readError(response)); const body=await response.json(); const jobsById=new Map((body.jobs||[]).map((job)=>[job.id,job])); for(const entry of state.queue) { if(entry.jobId&&jobsById.has(entry.jobId)) applyJob(entry,jobsById.get(entry.jobId)); } render(); } }
    async function processEntry(entry) { entry.stage="uploading"; entry.controller=new AbortController(); render(); const form=new FormData(); form.append("batchId",state.batchId); form.append("video",entry.file); const created=await fetch("/api/jobs",{method:"POST",body:form,signal:entry.controller.signal}); if(!created.ok) throw new Error(await readError(created)); const body=await created.json(); entry.jobId=body.jobId; entry.stage="queued"; render(); await watchEntry(entry); }
    function runQueue() { while(state.running<2) { const entry=state.queue.find((item)=>item.stage==="waiting"); if(!entry) return; state.running+=1; entry.stage="uploading"; void processEntry(entry).catch((error)=>{ if(entry.stage!=="cancelled") { entry.stage="system_failed"; entry.error=error&&error.message?error.message:"处理失败"; } }).finally(()=>{ entry.controller=null; state.running-=1; render(); runQueue(); }); } }
    function selectFallback() { if(!selectedEntry()) state.selectedId=state.queue[0]?.localId||null; }
    async function cancelEntry(entry) { if(entry.stage==="waiting") { state.queue=state.queue.filter((item)=>item!==entry); selectFallback(); render(); return; } entry.stage="cancelled"; entry.controller?.abort(); if(entry.jobId) { try { await fetch("/api/jobs/"+encodeURIComponent(entry.jobId),{method:"DELETE"}); } catch {} } render(); }
    async function deleteEntry(entry) { if(!entry.jobId) return; const response=await fetch("/api/jobs/"+encodeURIComponent(entry.jobId),{method:"DELETE"}); if(!response.ok&&response.status!==404) throw new Error(await readError(response)); state.queue=state.queue.filter((item)=>item!==entry); selectFallback(); render(); }
    async function loadHistory() { const response=await fetch("/api/jobs"); if(!response.ok) throw new Error(await readError(response)); const body=await response.json(); state.retentionDays=body.retentionDays||30; const local=state.queue.filter((entry)=>!entry.jobId); const restored=(body.jobs||[]).map((job)=>({ localId:job.id, file:null, fileName:job.fileName, sizeBytes:job.sizeBytes, stage:job.stage, jobId:job.id, batchId:job.batchId, createdAt:job.createdAt, updatedAt:job.updatedAt, promptRevision:job.promptRevision, promptContentSha256:job.promptContentSha256, result:job.result||null, error:job.error||null, diagnostics:job.diagnostics||[], controller:null })); state.queue=[...local,...restored]; selectFallback(); render(); const active=state.queue.filter((entry)=>entry.jobId&&!terminalStages.has(entry.stage)); if(active.length) { void watchHistory().catch((error)=>{ for(const entry of active) { if(!terminalStages.has(entry.stage)) { entry.stage="system_failed"; entry.error=error&&error.message?error.message:"状态读取失败"; } } }).finally(()=>{ render(); runQueue(); }); } else { runQueue(); } }
    function showPrompt(prompt) { state.prompt=prompt; promptEditor.value=prompt.systemPrompt; promptEditor.disabled=false; savePrompt.disabled=false; promptMeta.replaceChildren(); for(const value of ["当前 V"+prompt.revision,"初审 "+prompt.initialModel,"复核 "+prompt.reviewModel,"更新于 "+new Date(prompt.updatedAt).toLocaleString("zh-CN")]) promptMeta.append(node("span","",value)); }
    async function loadPrompt() { const response=await fetch("/api/prompt"); if(!response.ok) throw new Error(await readError(response)); const body=await response.json(); showPrompt(body.prompt); }
    async function loadAnnotationPrompt() { if(labMode!=="fused"||!annotationMeta||!annotationPromptEditor) return; const response=await fetch("/api/annotation-prompt"); if(!response.ok) throw new Error(await readError(response)); const body=await response.json(); annotationPromptEditor.value=body.prompt.systemPrompt; annotationMeta.replaceChildren(); for(const value of [body.prompt.promptVersion,body.prompt.model,body.prompt.outputSchema,"只读版本化资产"]) annotationMeta.append(node("span","",value)); }
    async function publishPrompt() { savePrompt.disabled=true; promptMessage.textContent="正在保存"; try { const response=await fetch("/api/prompt",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({systemPrompt:promptEditor.value})}); if(!response.ok) throw new Error(await readError(response)); const body=await response.json(); showPrompt(body.prompt); promptMessage.textContent="已发布 V"+body.prompt.revision; } catch(error) { promptMessage.textContent=error&&error.message?error.message:"保存失败"; } finally { savePrompt.disabled=false; } }

    document.getElementById("choose-button").addEventListener("click",()=>input.click()); input.addEventListener("change",()=>{ addFiles(input.files||[]); input.value=""; });
    for(const eventName of ["dragenter","dragover"]) dropZone.addEventListener(eventName,(event)=>{ event.preventDefault(); dropZone.classList.add("dragging"); });
    for(const eventName of ["dragleave","drop"]) dropZone.addEventListener(eventName,(event)=>{ event.preventDefault(); dropZone.classList.remove("dragging"); });
    dropZone.addEventListener("drop",(event)=>addFiles(event.dataTransfer.files)); dropZone.addEventListener("keydown",(event)=>{ if(event.key==="Enter"||event.key===" ") input.click(); });
    downloadAll.addEventListener("click",()=>downloadJson(labMode==="fused"?"fused-annotation-history.json":"video-quality-history.json",{ labMode, retentionDays:state.retentionDays, exportedAt:new Date().toISOString(), items:state.results }));
    savePrompt.addEventListener("click",()=>void publishPrompt());
    void fetch("/api/health").then((response)=>response.json()).then((health)=>{ const element=document.getElementById("health"); element.classList.toggle("ready",health.modelStatus==="configured"&&(!labMode||labMode!=="fused"||health.annotationEnabled)); element.querySelector("span").textContent=health.modelStatus==="configured"?(labMode==="fused"?"两条实际链路均已配置":"原业务模型已配置 · "+health.initialModel):"模型未配置"; }).catch(()=>{ document.querySelector("#health span").textContent="服务状态读取失败"; });
    render();
    void loadPrompt().catch((error)=>{ promptMessage.textContent=error&&error.message?error.message:"提示词读取失败"; });
    void loadAnnotationPrompt().catch((error)=>{ if(annotationMeta) annotationMeta.textContent=error&&error.message?error.message:"融合标注提示词读取失败"; });
    void loadHistory().catch(()=>undefined);
  </script>
</body>
</html>`;
}
