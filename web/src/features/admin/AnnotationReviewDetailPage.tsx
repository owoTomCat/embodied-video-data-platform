"use client";

import { FileVideo } from "lucide-react";
import { useEffect, useState } from "react";

import { ReviewDrawer } from "../../components/ReviewDrawer";
import type { Submission } from "../../domain/types";
import {
  getAnnotationRun,
  getSubmission,
} from "../../submissions/client/submissionApi";
import type { BackendAnnotationRun } from "../../submissions/contracts";
import { backendSubmissionToDomain } from "../../submissions/submissionMapper";

export function AnnotationReviewDetailPage({
  runId,
  navigate,
}: {
  runId: string;
  navigate(path: string): void;
}) {
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [run, setRun] = useState<BackendAnnotationRun | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    let active = true;
    getAnnotationRun(runId)
      .then(async (loadedRun) => ({
        run: loadedRun,
        submission: await getSubmission(loadedRun.submissionId),
      }))
      .then((loaded) => {
        if (!active) return;
        setRun(loaded.run);
        setSubmission(backendSubmissionToDomain(loaded.submission));
        setState("ready");
      })
      .catch(() => {
        if (active) setState("missing");
      });
    return () => {
      active = false;
    };
  }, [runId]);

  if (state === "loading") {
    return <div className="empty-state"><FileVideo size={28} /><strong>正在读取指定标注 Run</strong><span>{runId}</span></div>;
  }
  if (!submission || !run) {
    return (
      <div className="empty-state">
        <FileVideo size={28} />
        <strong>找不到这条标注 Run</strong>
        <button className="text-button" onClick={() => navigate("/admin/ai")}>返回 AI 标注</button>
      </div>
    );
  }

  const reviewable =
    run.executionStatus === "succeeded" &&
    run.reviewStatus === "pending" &&
    run.publicationStatus === "candidate_only";
  return (
    <ReviewDrawer
      submission={submission}
      annotationOnly
      annotationRunId={runId}
      readOnly={!reviewable}
      onAnnotationReviewed={() => navigate("/admin/ai")}
      onClose={() => navigate("/admin/ai")}
      variant="page"
    />
  );
}
