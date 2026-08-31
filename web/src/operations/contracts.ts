export type BackendQueueJob = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  status: "pending" | "published";
  attempts: number;
  availableAt: number;
  publishedAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  ageMs: number;
  waitMs: number;
  queuedForMs: number;
  publishLatencyMs?: number;
};

export type BackendWorkerHeartbeat = {
  id: string;
  kind: "media" | "ai_quality" | "ai_annotation";
  hostName: string;
  processId: number;
  status: "idle" | "running" | "stopped";
  currentSubmissionId?: string;
  currentTaskStartedAt?: number;
  currentTaskAgeMs?: number;
  completedTaskCount: number;
  failedTaskCount: number;
  lastTaskDurationMs?: number;
  averageTaskDurationMs: number;
  maxTaskDurationMs: number;
  runningTooLong: boolean;
  taskTimeoutMs: number;
  lastError?: string;
  startedAt: number;
  lastSeenAt: number;
  stale: boolean;
};

export type BackendWorkerReclaimResult = {
  reclaimed: Array<{
    submissionId: string;
    previousStatus: string;
    nextStatus: string;
    eventType: string;
  }>;
  stuck: Array<{
    submissionId: string;
    previousStatus: string;
    reason: string;
  }>;
  annotationReclaimed?: Array<{
    runId: string;
    submissionId: string;
    previousStatus: string;
    nextStatus: string;
    eventType: string;
  }>;
  annotationStuck?: Array<{
    runId: string;
    submissionId: string;
    previousStatus: string;
    reason: string;
  }>;
};

export type BackendQueueSnapshot = {
  summary: {
    total: number;
    pending: number;
    published: number;
    failed: number;
    media: number;
    ai: number;
    annotation?: number;
    averagePublishLatencyMs: number;
  };
  jobs: BackendQueueJob[];
  workers: BackendWorkerHeartbeat[];
  inactive?: BackendWorkerHeartbeat[];
  inactiveCount?: number;
};

export type BackendOperationsNotification = {
  id: string;
  title: string;
  detail: string;
  tone: "info" | "success" | "warning" | "danger";
  path: string;
  count: number;
  createdAt: number;
};

export type BackendNavigationBadge = {
  path: string;
  label: string;
  count: number;
};

export type BackendOperationsStatus = {
  generatedAt: number;
  unreadCount: number;
  summary: {
    processingSubmissions: number;
    failedSubmissions: number;
    reviewPending: number;
    unsettledEligible: number;
    pendingJobs: number;
    failedJobs: number;
    workerAlerts: number;
    recentAudits: number;
  };
  navigationBadges: BackendNavigationBadge[];
  notifications: BackendOperationsNotification[];
};

export type AnnotationOperationsView =
  | "pending_review"
  | "audit_pending"
  | "auto_published"
  | "execution_failed"
  | "in_progress"
  | "resolved"
  | "all";

export type BackendAnnotationRunListItem = {
  id: string;
  submissionId: string;
  fileName: string;
  executionStatus: string;
  reviewStatus: string;
  publicationStatus: string;
  trigger: "initial" | "manual";
  pipelineVersion: string;
  schemaVersion: string;
  evidencePolicyVersion: string;
  model: string | null;
  promptVersion: string | null;
  attemptCount: number;
  fullModelAttempts: number;
  schemaRepairCalls: number;
  targetedRepairCalls: number;
  infrastructureRetryCount: number;
  providerCallCount: number;
  reviewRevision: number;
  autoEligibility: "not_evaluated" | "eligible" | "manual_required";
  autoGateVersion: string | null;
  wouldAutoAccept: boolean;
  autoAcceptEnabledSnapshot: boolean;
  autoGateEvaluatedAt: number | null;
  auditStatus: "not_selected" | "pending" | "completed";
  auditSelectedAt: number | null;
  blockingReasons: AnnotationGateIssue[];
  advisories: AnnotationGateIssue[];
  repairs: AnnotationGateIssue[];
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  queuedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type BackendAnnotationOperations = {
  calculatedAt: number;
  summary?: {
    runs: {
      historicalTotal: number;
      queued: number;
      running: number;
      retryScheduled: number;
      succeeded: number;
      systemFailed: number;
      stuck: number;
      cancelled: number;
    };
    reviews: {
      pending: number;
      acceptedUnchanged: number;
      acceptedCorrected: number;
      rejected: number;
      unableToJudge: number;
    };
    gate: {
      gateEvaluated: number;
      eligible: number;
      manualRequired: number;
      autoAccepted: number;
      auditPending: number;
      auditCompleted: number;
      publishedByAuto: number;
      publishedByHuman: number;
    };
    usage: {
      scope: "all_reported_model_calls";
      providerCalls: number;
      succeededCalls: number;
      failedCalls: number;
      callsWithReportedUsage: number;
      totalReportedInputTokens: number;
      totalReportedOutputTokens: number;
      totalReportedTokens: number;
      averageReportedModelLatencyMs: number | null;
      schemaRepairCalls: number;
      targetedRepairCalls: number;
      infrastructureRetries: number;
    };
  };
  coverage?: {
    eligibleSubmissions: number;
    submissionsWithAnyRun: number;
    submissionsWithSucceededRun: number;
    submissionsHumanVerified: number;
    anyRunRate: number | null;
    succeededRate: number | null;
    verifiedRate: number | null;
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  runs: BackendAnnotationRunListItem[];
};

export type AnnotationGateIssue = {
  code: string;
  level: "repairable" | "retryable" | "manual_review" | "advisory";
  fieldPath: string | null;
  taskIndex: number | null;
  message: string;
  evidenceTimestampsMs: number[];
  resolution: "repaired" | "retried" | "unresolved" | "not_applicable";
  previousValue?: unknown;
  nextValue?: unknown;
};
