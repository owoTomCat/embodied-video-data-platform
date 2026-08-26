"use client";

import { useEffect, useState } from "react";

import type { BackendSubmissionTaskStat } from "../contracts";
import { fetchTaskStats } from "./submissionApi";

/**
 * 任务维度统计（范围与当前角色可见提交一致）：
 * 页面挂载时读取一次，用于「按任务汇总」展示与 taskId 筛选联动。
 */
export function useTaskStats() {
  const [stats, setStats] = useState<BackendSubmissionTaskStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchTaskStats()
      .then((result) => {
        if (!active) return;
        setStats(result);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setStats([]);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { stats, loading };
}
