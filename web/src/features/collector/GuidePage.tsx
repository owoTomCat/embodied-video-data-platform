import { Ban, CircleCheck, Compass, Flame, Lightbulb } from "lucide-react";

const guides = [
  { rank: "优先", title: "工作台组装", detail: "使用螺丝刀完成 3 步以上的部件组装", reward: "具体激励以单价规则为准", tone: "hot" },
  { rank: "优先", title: "户外园艺", detail: "浇水、修剪或移栽，保留完整准备和收尾", reward: "具体激励以单价规则为准", tone: "hot" },
  { rank: "建议", title: "家庭收纳", detail: "衣物折叠、物品分类、容器归位等连续动作", reward: "具体激励以单价规则为准", tone: "normal" },
];

export function GuidePage() {
  return <div className="page-stack"><div className="page-heading"><div><p className="page-kicker">高质量采集参考</p><h1>采集指南</h1><span>以下为通用拍摄建议，实时任务要求以运营通知和单价规则为准</span></div><span className="live-pill"><i />长期有效</span></div><section className="guide-hero content-card"><div><span><Compass size={18} />推荐采集方向</span><h2>真实家庭与轻量工具操作</h2><p>重点补充需要双手协调、对象状态变化明显、动作步骤完整的视频。</p></div><div className="guide-score"><small>参考优先级</small><strong>高</strong><span>以当前任务要求为准</span></div></section><div className="guide-grid">{guides.map((item) => <article className="content-card guide-card" key={item.title}><span className={`guide-rank guide-rank-${item.tone}`}><Flame size={13} />{item.rank}</span><h3>{item.title}</h3><p>{item.detail}</p><footer><strong>{item.reward}</strong></footer></article>)}</div><div className="dashboard-grid"><section className="content-card"><div className="card-heading"><div><h2>拍摄要点</h2><p>开始采集前快速确认</p></div><Lightbulb size={18} /></div><ul className="policy-list"><li><CircleCheck size={16} /><span><strong>相机固定在头部或胸前</strong><small>优先 1080P 及以上，保持双手完整可见</small></span></li><li><CircleCheck size={16} /><span><strong>保留完整任务链路</strong><small>从拿取工具到物品最终归位不要中断</small></span></li></ul></section><aside className="content-card"><div className="card-heading"><div><h2>低价值示例</h2><p>通常不建议单独采集</p></div><Ban size={18} /></div><div className="saturated-tags"><span>简单开关灯</span><span>空手走动</span><span>单次拿杯子</span><span>静态室内巡视</span></div></aside></div></div>;
}
