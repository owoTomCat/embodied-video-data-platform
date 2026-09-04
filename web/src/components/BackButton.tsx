"use client";

import { ArrowLeft } from "lucide-react";

/**
 * 返回上一个界面的通用按钮。
 *
 * 默认使用浏览器后退（history.back()），以回到「上一个界面」；
 * 若当前标签页没有可后退的历史（例如直接打开链接进入），
 * 则回退到 fallbackPath。可传入 onBack 完全自定义行为。
 */
export function BackButton({
  label = "返回上一页",
  fallbackPath,
  navigate,
  onBack,
  className = "",
}: {
  label?: string;
  fallbackPath?: string;
  navigate?: (path: string) => void;
  onBack?: () => void;
  className?: string;
}) {
  function goBack() {
    if (onBack) {
      onBack();
      return;
    }
    if (window.history.length > 1) {
      window.history.back();
    } else if (fallbackPath && navigate) {
      navigate(fallbackPath);
    }
  }

  return (
    <button
      type="button"
      className={`button back-nav${className ? ` ${className}` : ""}`}
      onClick={goBack}
    >
      <ArrowLeft size={14} />
      {label}
    </button>
  );
}
