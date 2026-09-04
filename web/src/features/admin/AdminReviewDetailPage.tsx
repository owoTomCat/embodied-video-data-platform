"use client";

import { FileVideo } from "lucide-react";
import { useEffect, useState } from "react";

import { BackButton } from "../../components/BackButton";
import { ReviewDrawer } from "../../components/ReviewDrawer";
import type { Submission } from "../../domain/types";
import {
  getSubmission,
} from "../../submissions/client/submissionApi";
import { backendSubmissionToDomain } from "../../submissions/submissionMapper";

export function AdminReviewDetailPage({
  id,
  navigate,
}: {
  id: string;
  navigate(path: string): void;
}) {
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    let active = true;
    getSubmission(id)
      .then((loaded) => {
        if (!active) return;
        setSubmission(backendSubmissionToDomain(loaded));
        setState("ready");
      })
      .catch(() => {
        if (active) setState("missing");
      });
    return () => {
      active = false;
    };
  }, [id]);

  if (state === "loading") {
    return (
      <div className="empty-state">
        <FileVideo size={28} />
        <strong>正在读取这条数据</strong>
        <span>请稍候</span>
      </div>
    );
  }
  if (!submission) {
    return (
      <div className="empty-state">
        <FileVideo size={28} />
        <strong>找不到这条数据</strong>
        <BackButton label="返回质量复核" fallbackPath="/admin/review" navigate={navigate} />
      </div>
    );
  }

  return (
    <ReviewDrawer
      submission={submission}
      onClose={() => navigate("/admin/review")}
      variant="page"
    />
  );
}
