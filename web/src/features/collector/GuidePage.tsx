import { ArrowUpRight, Ban, CircleCheck, Compass, Flame, Lightbulb } from "lucide-react";

const guides = [
  { rank: "紧缺", title: "工作台组装", detail: "使用螺丝刀完成 3 步以上的部件组装", reward: "+20% 场景激励", tone: "hot" },
  { rank: "紧缺", title: "户外园艺", detail: "浇水、修剪或移栽，保留完整准备和收尾", reward: "+15% 场景激励", tone: "hot" },
  { rank: "推荐", title: "家庭收纳", detail: "衣物折叠、物品分类、容器归位等连续动作", reward: "标准单价", tone: "normal" },
];

export function GuidePage({ navigate }: { navigate(path: string): void }) {
  return <div className="page-stack"><div className="page-heading"><div><p className="page-kicker">需求动态每日更新</p><h1>采集指南</h1><span>优先采集紧缺场景，可获得更高通过率和场景激励</span></div><span className="live-pill"><i />今日已更新</span></div><section className="guide-hero content-card"><div><span><Compass size={18} />本周采集主题</span><h2>真实家庭与轻量工具操作</h2><p>重点补充需要双手协调、对象状态变化明显、动作步骤完整的视频。</p></div><div className="guide-score"><small>需求热度</small><strong>92</strong><span>较上周 +8</span></div></section><div className="guide-grid">{guides.map((item) => <button type="button" className="content-card guide-card" key={item.title} aria-label={`上传${item.title}视频`} onClick={() => navigate("/collector/upload")}><span className={`guide-rank guide-rank-${item.tone}`}><Flame size={13} />{item.rank}</span><h3>{item.title}</h3><p>{item.detail}</p><footer><strong>{item.reward}</strong><span>去上传 <ArrowUpRight size={16} /></span></footer></button>)}</div><div className="dashboard-grid"><section className="content-card"><div className="card-heading"><div><h2>拍摄要点</h2><p>开始采集前快速确认</p></div><Lightbulb size={18} /></div><ul className="policy-list"><li><CircleCheck size={16} /><span><strong>相机固定在头部或胸前</strong><small>优先 1080P 及以上，保持双手完整可见</small></span></li><li><CircleCheck size={16} /><span><strong>保留完整任务链路</strong><small>从拿取工具到物品最终归位不要中断</small></span></li></ul></section><aside className="content-card"><div className="card-heading"><div><h2>已饱和内容</h2><p>暂时不建议继续采集</p></div><Ban size={18} /></div><div className="saturated-tags"><span>简单开关灯</span><span>空手走动</span><span>单次拿杯子</span><span>静态室内巡视</span></div></aside></div></div>;
}
