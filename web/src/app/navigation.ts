import {
  Archive,
  BarChart3,
  CircleDollarSign,
  ClipboardCheck,
  Compass,
  Cpu,
  Database,
  Files,
  Globe,
  HandCoins,
  LayoutDashboard,
  Receipt,
  ScrollText,
  ShieldCheck,
  Tags,
  Upload,
  User,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "../domain/types";

export type NavigationItem = {
  label: string;
  path: string;
  icon: LucideIcon;
  badge?: string;
};

export const roleHome: Record<Role, string> = {
  collector: "/collector",
  leader: "/team",
  admin: "/admin",
};

export const navigationByRole: Record<Role, NavigationItem[]> = {
  collector: [
    { label: "我的工作台", path: "/collector", icon: LayoutDashboard },
    { label: "上传视频", path: "/collector/upload", icon: Upload },
    { label: "我的数据", path: "/collector/submissions", icon: Files },
    { label: "收入与提现", path: "/collector/earnings", icon: Wallet },
    { label: "采集指南", path: "/collector/guide", icon: Compass },
    { label: "个人资料", path: "/account/profile", icon: User },
  ],
  leader: [
    { label: "团队工作台", path: "/team", icon: LayoutDashboard },
    { label: "成员管理", path: "/team/members", icon: Users },
    { label: "团队数据", path: "/team/submissions", icon: Database },
    {
      label: "结算前复核",
      path: "/team/review",
      icon: ClipboardCheck,
      badge: "3",
    },
    { label: "团队分析", path: "/team/analytics", icon: BarChart3 },
    { label: "团队收入", path: "/team/income", icon: CircleDollarSign },
    { label: "个人资料", path: "/account/profile", icon: User },
  ],
  admin: [
    { label: "运营总览", path: "/admin", icon: LayoutDashboard },
    { label: "数据提交", path: "/admin/submissions", icon: Database },
    { label: "AI 任务", path: "/admin/ai", icon: Cpu },
    { label: "质量复核", path: "/admin/review", icon: ShieldCheck },
    { label: "数据资产", path: "/admin/assets", icon: Archive },
    { label: "用户与团队", path: "/admin/people", icon: Users },
    { label: "标签与规则", path: "/admin/rules", icon: Tags },
    { label: "价格与结算", path: "/admin/settlements", icon: Receipt },
    { label: "提现审核", path: "/admin/withdrawals", icon: HandCoins, badge: "5" },
    { label: "公开数据配置", path: "/admin/public", icon: Globe },
    { label: "操作日志", path: "/admin/audit", icon: ScrollText },
    { label: "个人资料", path: "/account/profile", icon: User },
  ],
};
