"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ToastViewport } from "../components/ToastViewport";
import type {
  BackendNavigationBadge,
  BackendOperationsStatus,
} from "../operations/contracts";

export type ToastTone = "success" | "error" | "info";
export type ToastItem = { id: number; tone: ToastTone; message: string };
export type DemoNotification = {
  id: string;
  title: string;
  detail: string;
  read: boolean;
  path?: string;
  tone?: "info" | "success" | "warning" | "danger";
};

type InteractionValue = {
  toasts: ToastItem[];
  notifications: DemoNotification[];
  unreadCount: number;
  navigationBadges: BackendNavigationBadge[];
  notify(tone: ToastTone, message: string): void;
  dismissToast(id: number): void;
  markAllRead(): void;
  markPathVisited(path: string): void;
  syncOperationsStatus(status: BackendOperationsStatus): void;
};

const InteractionContext = createContext<InteractionValue | null>(null);

const STORAGE_KEY = "evdp-notification-state";

type PersistedState = {
  seenCounts: Record<string, number>;
  readIds: string[];
};

function badgeLabel(count: number): string {
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}

function loadPersisted(): PersistedState {
  if (typeof window === "undefined") return { seenCounts: {}, readIds: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { seenCounts: {}, readIds: [] };
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      seenCounts:
        parsed.seenCounts && typeof parsed.seenCounts === "object"
          ? (parsed.seenCounts as Record<string, number>)
          : {},
      readIds: Array.isArray(parsed.readIds)
        ? parsed.readIds.filter((id) => typeof id === "string")
        : [],
    };
  } catch {
    return { seenCounts: {}, readIds: [] };
  }
}

function savePersisted(seenCounts: Map<string, number>, readIds: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        seenCounts: Object.fromEntries(seenCounts),
        readIds: [...readIds],
      }),
    );
  } catch {
    // 本地存储不可用时静默降级，不阻断通知展示。
  }
}

export function InteractionProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [notifications, setNotifications] = useState<DemoNotification[]>([]);
  const notificationsRef = useRef<DemoNotification[]>([]);
  const [navigationBadges, setNavigationBadges] = useState<
    BackendNavigationBadge[]
  >([]);
  const nextToastId = useRef(1);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const rawBadgesRef = useRef<BackendNavigationBadge[]>([]);
  const seenCountsRef = useRef<Map<string, number>>(
    new Map(Object.entries(loadPersisted().seenCounts)),
  );
  const readIdsRef = useRef<Set<string>>(new Set(loadPersisted().readIds));

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextToastId.current++;
      setToasts((current) => [...current, { id, tone, message }].slice(-3));
      if (tone !== "error") {
        const timer = setTimeout(() => {
          dismissToast(id);
          timers.current.delete(timer);
        }, 2800);
        timers.current.add(timer);
      }
    },
    [dismissToast],
  );

  const persist = useCallback(() => {
    savePersisted(seenCountsRef.current, readIdsRef.current);
  }, []);

  const recomputeBadges = useCallback(() => {
    const badges: BackendNavigationBadge[] = [];
    for (const badge of rawBadgesRef.current) {
      const seen = seenCountsRef.current.get(badge.path) ?? 0;
      // 原始计数回落时，同步下调已见计数，避免长期掩盖新告警。
      if (badge.count < seen) {
        seenCountsRef.current.set(badge.path, badge.count);
      }
      const effective = Math.max(0, badge.count - (seenCountsRef.current.get(badge.path) ?? 0));
      if (effective <= 0) continue;
      badges.push({ path: badge.path, count: effective, label: badgeLabel(effective) });
    }
    setNavigationBadges(badges);
  }, []);

  const markAllRead = useCallback(() => {
    const next = notificationsRef.current.map((notification) => {
      readIdsRef.current.add(notification.id);
      return { ...notification, read: true };
    });
    notificationsRef.current = next;
    setNotifications(next);
    persist();
  }, [persist]);

  const markPathVisited = useCallback(
    (path: string) => {
      const rawCount =
        rawBadgesRef.current.find((badge) => badge.path === path)?.count ?? 0;
      seenCountsRef.current.set(path, rawCount);
      const next = notificationsRef.current.map((notification) => {
        if (notification.path !== path) return notification;
        readIdsRef.current.add(notification.id);
        return { ...notification, read: true };
      });
      notificationsRef.current = next;
      setNotifications(next);
      recomputeBadges();
      persist();
    },
    [persist, recomputeBadges],
  );

  const syncOperationsStatus = useCallback(
    (status: BackendOperationsStatus) => {
      rawBadgesRef.current = status.navigationBadges;
      const readInMemory = new Set(
        notificationsRef.current
          .filter((notification) => notification.read)
          .map((notification) => notification.id),
      );
      const read = new Set<string>([
        ...readIdsRef.current,
        ...readInMemory,
      ]);
      const next = status.notifications.map((notification) => ({
        id: notification.id,
        title: notification.title,
        detail: notification.detail,
        path: notification.path,
        tone: notification.tone,
        read: read.has(notification.id),
      }));
      notificationsRef.current = next;
      setNotifications(next);
      recomputeBadges();
    },
    [recomputeBadges],
  );

  useEffect(
    () => () => {
      timers.current.forEach((timer) => clearTimeout(timer));
      timers.current.clear();
    },
    [],
  );

  const value = useMemo<InteractionValue>(
    () => ({
      toasts,
      notifications,
      navigationBadges,
      unreadCount: notifications.filter((notification) => !notification.read)
        .length,
      notify,
      dismissToast,
      markAllRead,
      markPathVisited,
      syncOperationsStatus,
    }),
    [
      dismissToast,
      markAllRead,
      markPathVisited,
      navigationBadges,
      notifications,
      notify,
      syncOperationsStatus,
      toasts,
    ],
  );

  return (
    <InteractionContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} dismissToast={dismissToast} />
    </InteractionContext.Provider>
  );
}

export function useInteractions(): InteractionValue {
  const value = useContext(InteractionContext);
  if (!value) {
    throw new Error("useInteractions must be used inside InteractionProvider");
  }
  return value;
}
