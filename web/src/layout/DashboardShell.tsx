"use client";

import {
  Bell,
  ChevronDown,
  ChevronRight,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { navigationByRole, roleHome } from "../app/navigation";
import { BrandMark } from "../components/BrandMark";
import { NotificationPanel } from "../components/NotificationPanel";
import { useIdentity } from "../auth/client/IdentityContext";
import { useInteractions } from "../interactions/InteractionContext";
import { getOperationsStatus } from "../operations/client/operationsApi";

const roleLabel = {
  collector: "数采人员",
  leader: "团长",
  admin: "平台管理员",
};

type SystemStatus = "loading" | "healthy" | "attention" | "unavailable";

const systemStatusCopy: Record<SystemStatus, string> = {
  loading: "正在读取系统状态",
  healthy: "系统运行正常",
  attention: "系统有待处理异常",
  unavailable: "暂时无法读取状态",
};

function badgeLabel(count: number): string {
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}

export function DashboardShell({
  currentPath,
  navigate,
  onLogout,
  children,
}: {
  currentPath: string;
  navigate(path: string): void;
  onLogout(): Promise<void> | void;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("evdp-sidebar-collapsed") === "1";
  });
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>("loading");
  const loggingOutRef = useRef(false);
  const { currentAccount } = useIdentity();
  const { notify, unreadCount, navigationBadges, syncOperationsStatus, markPathVisited } =
    useInteractions();
  const badgeByPath = useMemo(
    () => new Map(navigationBadges.map((badge) => [badge.path, badge.label])),
    [navigationBadges],
  );
  const navigation = navigationByRole[currentAccount.role];
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(navigation.map((group) => group.label)),
  );

  useEffect(() => {
    let active = true;
    async function refreshOperationsStatus() {
      try {
        const status = await getOperationsStatus();
        if (!active) return;
        syncOperationsStatus(status);
        setSystemStatus(
          status.summary.failedSubmissions > 0 ||
            status.summary.failedJobs > 0 ||
            status.summary.workerAlerts > 0
            ? "attention"
            : "healthy",
        );
      } catch {
        if (active) setSystemStatus("unavailable");
      }
    }

    void refreshOperationsStatus();
    const timer = window.setInterval(() => {
      void refreshOperationsStatus();
    }, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [currentAccount.id, syncOperationsStatus]);

  function go(path: string) {
    setMobileOpen(false);
    setNotificationsOpen(false);
    setUserMenuOpen(false);
    markPathVisited(path);
    navigate(path);
  }

  useEffect(() => {
    if (!notificationsOpen) return;
    function closeOnOutside(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        !target.closest(".notification-panel, .notification-button")
      ) {
        setNotificationsOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setNotificationsOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [notificationsOpen]);

  useEffect(() => {
    if (!userMenuOpen) return;
    function closeOnOutside(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target && !target.closest(".user-menu")) {
        setUserMenuOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setUserMenuOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [userMenuOpen]);

  function toggleCollapsed() {
    setCollapsed((value) => {
      const next = !value;
      window.localStorage.setItem("evdp-sidebar-collapsed", next ? "1" : "0");
      return next;
    });
  }

  function toggleGroup(label: string) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  async function signOut() {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    setLoggingOut(true);
    setUserMenuOpen(false);
    try {
      await onLogout();
    } catch {
      notify("error", "退出登录失败，请稍后重试");
      loggingOutRef.current = false;
      setLoggingOut(false);
    }
  }

  function isActive(path: string): boolean {
    return (
      currentPath === path ||
      (path !== roleHome[currentAccount.role] &&
        currentPath.startsWith(`${path}/`))
    );
  }

  return (
    <div className={`dashboard-frame ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <BrandMark compact={collapsed} />
          <button
            className="icon-button sidebar-close"
            aria-label="关闭导航"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav className="sidebar-nav" aria-label="主导航">
          {navigation.map((group) => {
            const expanded = collapsed || expandedGroups.has(group.label);
            const groupActive = group.items.some((item) => isActive(item.path));
            return (
              <section className="nav-group" key={group.label}>
                <button
                  className={`nav-group-toggle ${groupActive ? "nav-group-active" : ""}`}
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => toggleGroup(group.label)}
                >
                  <span>{group.label}</span>
                  {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </button>
                {expanded &&
                  group.items.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.path);
                    const badge = badgeByPath.get(item.path) ?? item.badge;
                    return (
                      <a
                        key={item.path}
                        href={item.path}
                        className={`nav-link ${active ? "nav-link-active" : ""}`}
                        onClick={(event) => {
                          event.preventDefault();
                          go(item.path);
                        }}
                      >
                        <Icon size={19} />
                        <span>{item.label}</span>
                        {badge && <em>{badge}</em>}
                      </a>
                    );
                  })}
              </section>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div className={`system-pulse system-pulse-${systemStatus}`}>
            <span />
            {systemStatusCopy[systemStatus]}
          </div>
          <small>数据平台 v0.1.0</small>
        </div>
      </aside>

      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="关闭导航"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <section className="dashboard-main">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="打开导航"
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={21} />
          </button>
          <button
            className="icon-button sidebar-collapse-btn"
            aria-label={collapsed ? "展开导航" : "收起导航"}
            title={collapsed ? "展开导航" : "收起导航"}
            onClick={toggleCollapsed}
          >
            {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
          </button>
          <div className="topbar-context">
            <span>{roleLabel[currentAccount.role]}</span>
            <small>具身视频数据生产与质量运营</small>
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button notification-button"
              aria-label={unreadCount > 0 ? `通知，${unreadCount} 条未读` : "通知，无未读"}
              aria-expanded={notificationsOpen}
              aria-controls="operations-notifications"
              onClick={() => setNotificationsOpen((open) => !open)}
            >
              <Bell size={19} />
              {unreadCount > 0 && <span className="notification-count">{badgeLabel(unreadCount)}</span>}
            </button>
            {notificationsOpen && <NotificationPanel navigate={go} />}
            <div className="user-menu">
              <button
                className="user-chip user-menu-trigger"
                type="button"
                aria-label={`用户菜单，${currentAccount.displayName}`}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                onClick={() => setUserMenuOpen((open) => !open)}
              >
                <span>{currentAccount.displayName.slice(0, 1)}</span>
                <div>
                  <strong>{currentAccount.displayName}</strong>
                  <small>{roleLabel[currentAccount.role]}</small>
                </div>
                <ChevronDown size={15} />
              </button>
              {userMenuOpen && (
                <div className="user-menu-dropdown">
                  <button type="button" onClick={() => go("/account/profile")}>
                    <UserRound size={15} />
                    个人资料
                  </button>
                  <button
                    type="button"
                    onClick={signOut}
                    disabled={loggingOut}
                  >
                    <LogOut size={15} />
                    {loggingOut ? "退出中…" : "退出登录"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="dashboard-content">{children}</main>
      </section>
    </div>
  );
}
