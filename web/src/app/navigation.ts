import {
  Archive,
  BadgeCheck,
  BarChart3,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  Compass,
  Cpu,
  Database,
  Files,
  Globe,
  LayoutDashboard,
  Receipt,
  ScrollText,
  ShieldCheck,
  Tags,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "../domain/types";

export type NavigationItem = {
  label: string;
  path: string;
  icon: LucideIcon;
  badge?: string;
};

export type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};

export const roleHome: Record<Role, string> = {
  collector: "/collector",
  leader: "/team",
  admin: "/admin",
};

export const navigationByRole: Record<Role, NavigationGroup[]> = {
  collector: [
    {
      label: "工作台",
      items: [
        { label: "我的工作台", path: "/collector", icon: LayoutDashboard },
      ],
    },
    {
      label: "任务",
      items: [
        { label: "任务大厅", path: "/collector/tasks", icon: ClipboardList },
        { label: "上传视频", path: "/collector/upload", icon: Upload },
      ],
    },
    {
      label: "数据",
      items: [
        { label: "我的数据", path: "/collector/submissions", icon: Files },
        { label: "质检结果", path: "/collector/quality", icon: BadgeCheck },
      ],
    },
    {
      label: "结算",
      items: [
        { label: "积分明细", path: "/collector/earnings", icon: CircleDollarSign },
      ],
    },
    {
      label: "帮助",
      items: [
        { label: "采集指南", path: "/collector/guide", icon: Compass },
      ],
    },
  ],
  leader: [
    {
      label: "工作台",
      items: [
        { label: "团队工作台", path: "/team", icon: LayoutDashboard },
      ],
    },
    {
      label: "团队",
      items: [
        { label: "成员管理", path: "/team/members", icon: Users },
        { label: "团队数据", path: "/team/submissions", icon: Database },
      ],
    },
    {
      label: "质检",
      items: [
        { label: "质检结果", path: "/team/review", icon: ClipboardCheck },
      ],
    },
    {
      label: "数据",
      items: [
        { label: "团队分析", path: "/team/analytics", icon: BarChart3 },
        { label: "团队积分", path: "/team/income", icon: CircleDollarSign },
      ],
    },
  ],
  admin: [
    {
      label: "工作台",
      items: [
        { label: "运营总览", path: "/admin", icon: LayoutDashboard },
      ],
    },
    {
      label: "任务",
      items: [
        { label: "任务管理", path: "/admin/tasks", icon: ClipboardList },
      ],
    },
    {
      label: "数据",
      items: [
        { label: "数据提交", path: "/admin/submissions", icon: Database },
        { label: "数据资产", path: "/admin/assets", icon: Archive },
      ],
    },
    {
      label: "质检",
      items: [
        { label: "AI 任务", path: "/admin/ai", icon: Cpu },
        { label: "质量复核", path: "/admin/review", icon: ShieldCheck },
      ],
    },
    {
      label: "配置",
      items: [
        { label: "用户与团队", path: "/admin/people", icon: Users },
        { label: "标签与规则", path: "/admin/rules", icon: Tags },
        { label: "积分规则", path: "/admin/settlements", icon: Receipt },
        { label: "公开数据配置", path: "/admin/public", icon: Globe },
      ],
    },
    {
      label: "审计",
      items: [
        { label: "操作日志", path: "/admin/audit", icon: ScrollText },
      ],
    },
  ],
};
