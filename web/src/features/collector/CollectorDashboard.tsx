import { BadgeCheck, Clock3, FileVideo, Wallet } from "lucide-react";
import { MetricCard } from "../../components/MetricCard";
import { SubmissionTable } from "../../components/SubmissionTable";
import { useDemoStore } from "../../data/DemoStoreContext";

export function CollectorDashboard({ navigate, title = false }: { navigate(path: string): void; title?: boolean }) {
  const { currentUser, state } = useDemoStore();
  const recentSubmissions = state.submissions
    .filter((submission) => submission.ownerId === currentUser.id)
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 4);
  return (
    <div className="page-stack">
      <div className="page-heading"><div><p className="page-kicker">今天也是好数据的一天</p><h1>{title ? "我的工作台" : `早上好，${currentUser.name}`}</h1><span>你本周的数据通过率高于平台平均 4.2%</span></div><button className="button button-primary" onClick={() => navigate("/collector/upload")}>上传新视频</button></div>
      <div className="metric-grid">
        <MetricCard label="本月上传" value="128 条" detail="较上月 +18.5%" icon={FileVideo} />
        <MetricCard label="有效时长" value="5.8 小时" detail="已通过数据" icon={Clock3} tone="violet" />
        <MetricCard label="质量通过率" value="92.6%" detail="平台平均 88.4%" icon={BadgeCheck} tone="green" />
        <MetricCard label="待结算收入" value="¥328.60" detail="预计明日入账" icon={Wallet} tone="amber" />
      </div>
      <div className="dashboard-grid"><section className="content-card content-card-wide"><div className="card-heading"><div><h2>最近数据</h2><p>跟踪你的视频处理和质检进度</p></div><button className="text-button" onClick={() => navigate("/collector/submissions")}>查看全部</button></div><div className="dashboard-recent-table"><SubmissionTable submissions={recentSubmissions} onAction={(submission) => navigate(`/collector/submissions/${submission.id}`)} /></div></section><aside className="content-card"><div className="card-heading"><div><h2>今日采集建议</h2><p>优先补充紧缺场景</p></div></div><div className="recommend-list"><div><em>01</em><span><strong>工作台组装</strong><small>紧缺度 92%</small></span></div><div><em>02</em><span><strong>户外园艺</strong><small>紧缺度 87%</small></span></div><div><em>03</em><span><strong>家庭收纳</strong><small>紧缺度 78%</small></span></div></div></aside></div>
    </div>
  );
}
